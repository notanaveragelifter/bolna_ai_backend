import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../common/supabase.service';
import { DebtorsService } from '../debtors/debtors.service';
import { BolnaService } from '../common/bolna.service';
import { TranscriptParserService } from '../common/transcript-parser.service';
import { Campaign } from './campaign.types';

const OUTCOME_TO_STATUS: Record<string, string> = {
  committed:          'committed',
  refused:            'refused',
  no_answer:          'no_answer',
  callback_requested: 'called',
  partial_commitment: 'committed',
};

const POLL_INTERVAL_MS = 15_000;
const POLL_MAX_ATTEMPTS = 16; // 16 × 15s = 4 minutes

interface BolnaCallPayload {
  agent_id: string;
  recipient_phone_number: string;
  variables?: Record<string, string | number>;
  user_data?: Record<string, unknown>;
}

@Injectable()
export class CampaignsService {
  private readonly bolnaBase = 'https://api.bolna.ai';
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private supabase: SupabaseService,
    private debtors: DebtorsService,
    private config: ConfigService,
    private bolna: BolnaService,
    private transcriptParser: TranscriptParserService,
  ) {}

  async create(name: string): Promise<Campaign> {
    const { data, error } = await this.supabase.db
      .from('campaigns')
      .insert({ name, status: 'active' })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data as Campaign;
  }

  async findAll(): Promise<Campaign[]> {
    const { data, error } = await this.supabase.db
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data as Campaign[];
  }

  async findOne(id: string): Promise<Campaign> {
    const { data, error } = await this.supabase.db
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new NotFoundException('Campaign not found');
    return data as Campaign;
  }

  async triggerCalls(
    campaignId: string,
  ): Promise<{ triggered: number; errors: { phone: string; error: string }[] }> {
    const campaign = await this.findOne(campaignId);
    if (!campaign) throw new NotFoundException('Campaign not found');

    const debtorList = await this.debtors.findAll(campaignId);

    const agentId = this.config.getOrThrow('BOLNA_AGENT_ID');
    const apiKey = this.config.getOrThrow('BOLNA_API_KEY');

    this.logger.log(
      `Triggering calls for campaign ${campaignId}: ${debtorList.length} debtors`,
    );
    this.logger.log(`Using agent_id: ${agentId}`);

    let triggered = 0;
    const errors: { phone: string; error: string }[] = [];

    for (const debtor of debtorList) {
      const payload: BolnaCallPayload = {
        agent_id: agentId,
        recipient_phone_number: debtor.phone,
        variables: {
          debtor_name: debtor.name,
          company: debtor.company,
          invoice_amount: debtor.invoice_amount,
          due_date: debtor.due_date,
        },
        user_data: {
          debtor_id: debtor.id,
        },
      };

      this.logger.log(`Calling ${debtor.phone} (debtor: ${debtor.name})`);

      const res = await fetch(`${this.bolnaBase}/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const body = await res.json();
        this.logger.log(`Call queued for ${debtor.phone}: ${JSON.stringify(body)}`);
        await this.debtors.update(debtor.id, { status: 'called' });
        triggered++;

        const executionId: string | undefined = body.execution_id ?? body.id;
        if (executionId) {
          this.pollForCompletion(executionId, debtor.id, debtor.invoice_amount);
        }
      } else {
        const errorText = await res.text();
        this.logger.error(
          `Bolna API error for ${debtor.phone}: HTTP ${res.status} — ${errorText}`,
        );
        errors.push({ phone: debtor.phone, error: `HTTP ${res.status}: ${errorText}` });
      }
    }

    await this.supabase.db
      .from('campaigns')
      .update({ calls_made: triggered })
      .eq('id', campaignId);

    this.logger.log(`Done: ${triggered} triggered, ${errors.length} errors`);
    return { triggered, errors };
  }

  private pollForCompletion(executionId: string, debtorId: string, invoiceAmount: number): void {
    let attempts = 0;

    const poll = async () => {
      attempts++;
      this.logger.log(`[Poll ${attempts}/${POLL_MAX_ATTEMPTS}] Checking execution ${executionId}...`);

      try {
        const exec = await this.bolna.getExecution(executionId);
        this.logger.log(`[Poll] status=${exec.status} transcript=${exec.transcript?.length ?? 0} chars`);

        if (exec.status !== 'completed') {
          if (attempts < POLL_MAX_ATTEMPTS) setTimeout(poll, POLL_INTERVAL_MS);
          else this.logger.warn(`[Poll] Gave up on execution ${executionId} after ${POLL_MAX_ATTEMPTS} attempts`);
          return;
        }

        const transcript = exec.transcript ?? '';
        if (!transcript) {
          await this.debtors.update(debtorId, { status: 'no_answer', call_duration: Number(exec.telephony_data?.duration ?? 0) });
          this.logger.log(`[Poll] No transcript — marked debtor ${debtorId} as no_answer`);
          return;
        }

        // Step 1: save raw transcript immediately
        await this.debtors.update(debtorId, {
          transcript,
          call_duration: Number(exec.telephony_data?.duration ?? 0),
        });
        this.logger.log(`[Poll] Transcript saved for debtor ${debtorId}`);

        // Step 2: AI extraction
        this.logger.log(`[Poll] Running AI extraction...`);
        let ext: Record<string, any> = exec.extracted_data ?? {};
        if (!ext.call_outcome) {
          try {
            ext = await this.transcriptParser.parse(transcript);
            this.logger.log(`[Poll] AI extracted: ${JSON.stringify(ext)}`);
          } catch (err) {
            this.logger.error(`[Poll] AI extraction failed: ${(err as Error).message}`);
          }
        }

        const outcome          = (ext.call_outcome ?? 'no_answer') as string;
        const status           = OUTCOME_TO_STATUS[outcome] ?? 'called';
        const committed_amount = ext.committed_amount
          ? Number(ext.committed_amount)
          : ['committed', 'partial_commitment'].includes(outcome) ? invoiceAmount : null;

        // Step 3: save AI results
        await this.debtors.update(debtorId, {
          status:           status as any,
          committed_amount,
          payment_date:     ext.payment_date ?? null,
          objection_type:   ext.objection_type ?? null,
        });
        this.logger.log(`[Poll] Done: debtor=${debtorId} outcome=${outcome} committed=₹${committed_amount}`);

      } catch (err) {
        this.logger.error(`[Poll] Error on attempt ${attempts}: ${(err as Error).message}`);
        if (attempts < POLL_MAX_ATTEMPTS) setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    setTimeout(poll, POLL_INTERVAL_MS);
  }
}
