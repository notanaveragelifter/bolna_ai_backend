import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { DebtorsService } from '../debtors/debtors.service';
import { TranscriptParserService } from '../common/transcript-parser.service';
import { BolnaService, BolnaExecution } from '../common/bolna.service';

const POLL_INTERVAL_MS = 30_000;

type DebtorStatus = 'pending' | 'called' | 'committed' | 'refused' | 'no_answer';

const OUTCOME_TO_STATUS: Record<string, DebtorStatus> = {
  committed:          'committed',
  refused:            'refused',
  no_answer:          'no_answer',
  callback_requested: 'called',
  partial_commitment: 'committed',
};

@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookService.name);
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private supabase: SupabaseService,
    private debtors: DebtorsService,
    private transcriptParser: TranscriptParserService,
    private bolna: BolnaService,
  ) {}

  onModuleInit() {
    this.logger.log(`Auto-polling Bolna every ${POLL_INTERVAL_MS / 1000}s`);
    this.pollTimer = setInterval(() => this.syncFromBolna(), POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  // Called by POST /webhook/bolna — Bolna pushes this when a call ends
  async handleBolnaWebhook(payload: any): Promise<void> {
    this.logger.log(`WEBHOOK payload: ${JSON.stringify(payload, null, 2)}`);
    await this.processExecution(payload as BolnaExecution);
  }

  // Called by POST /webhook/bolna/sync — pulls all completed executions from Bolna API
  async syncFromBolna(): Promise<{ processed: number; skipped: number; errors: number }> {
    this.logger.log('Starting Bolna sync...');
    const executions = await this.bolna.getAllExecutions('completed');
    this.logger.log(`Fetched ${executions.length} completed executions`);

    let processed = 0, skipped = 0, errors = 0;

    for (const exec of executions) {
      try {
        const updated = await this.processExecution(exec);
        if (updated) processed++; else skipped++;
      } catch (err) {
        this.logger.error(`Failed to process execution ${exec.id}: ${(err as Error).message}`);
        errors++;
      }
    }

    this.logger.log(`Sync done: processed=${processed} skipped=${skipped} errors=${errors}`);
    return { processed, skipped, errors };
  }

  private async processExecution(exec: BolnaExecution): Promise<boolean> {
    const phone: string =
      (exec as any).user_number ??
      exec.telephony_data?.to_number ??
      (exec.context_details as any)?.recipient_phone_number ??
      '';

    const call_status  = exec.status ?? '';
    const call_duration = Number(exec.telephony_data?.duration ?? 0);
    const transcript   = exec.transcript ?? '';

    this.logger.log(
      `Execution ${exec.id} | phone=${phone} | status=${call_status} | duration=${call_duration}s | transcript=${transcript.length} chars`,
    );

    // Find debtor — prefer debtor_id baked into context_details
    const debtor_id: string | undefined =
      (exec.context_details as any)?.recipient_data?.debtor_id ??
      (exec.context_details as any)?.user_data?.debtor_id;

    const debtor = debtor_id
      ? await this.debtors.findOne(debtor_id).catch(() => null)
      : await this.debtors.findByPhone(phone);

    if (!debtor) {
      this.logger.warn(`No debtor found — debtor_id=${debtor_id} phone=${phone}`);
      return false;
    }

    // Skip only if transcript AND AI extraction are both already done
    if (debtor.transcript && debtor.status !== 'called') {
      this.logger.log(`Debtor ${debtor.id} already fully processed, skipping`);
      return false;
    }

    if (call_status !== 'completed' || !transcript) {
      await this.debtors.update(debtor.id, { status: 'no_answer', call_duration });
      this.logger.log(`Marked debtor ${debtor.id} as no_answer`);
      return true;
    }

    // Step 1: store raw transcript immediately so it's never lost
    await this.debtors.update(debtor.id, { transcript, call_duration });
    this.logger.log(`Transcript stored for debtor ${debtor.id} (${transcript.length} chars)`);

    // Step 2: AI extraction
    let ext: Record<string, any> = exec.extracted_data ?? {};
    this.logger.log(`extracted_data: ${JSON.stringify(ext)}`);

    if (!ext.call_outcome) {
      this.logger.log(`No call_outcome — parsing transcript with AI for debtor ${debtor.id}`);
      try {
        ext = await this.transcriptParser.parse(transcript);
        this.logger.log(`AI result: ${JSON.stringify(ext)}`);
      } catch (err) {
        this.logger.error(`AI transcript parsing failed: ${(err as Error).message}`);
      }
    }

    const outcome          = (ext.call_outcome ?? 'no_answer') as string;
    const status           = OUTCOME_TO_STATUS[outcome] ?? 'called';
    // Fall back to invoice_amount when debtor committed but transcript had unsubstituted template vars
    const committed_amount = ext.committed_amount
      ? Number(ext.committed_amount)
      : ['committed', 'partial_commitment'].includes(outcome) ? debtor.invoice_amount : null;
    const payment_date     = ext.payment_date ?? null;
    const objection_type   = ext.objection_type ?? null;

    // Step 3: save AI-extracted fields
    await this.debtors.update(debtor.id, {
      status:           status as any,
      committed_amount,
      payment_date,
      objection_type,
    });

    if (debtor.campaign_id && committed_amount) {
      await this.incrementCampaignCommitted(debtor.campaign_id, committed_amount);
    }

    this.logger.log(
      `Saved: debtor=${debtor.id} | outcome=${outcome} | committed=₹${committed_amount} | payment=${payment_date}`,
    );
    return true;
  }

  private async incrementCampaignCommitted(campaignId: string, amount: number): Promise<void> {
    const { data } = await this.supabase.db
      .from('campaigns')
      .select('total_committed')
      .eq('id', campaignId)
      .single();

    if (data) {
      await this.supabase.db
        .from('campaigns')
        .update({ total_committed: (data.total_committed ?? 0) + amount })
        .eq('id', campaignId);
    }
  }
}
