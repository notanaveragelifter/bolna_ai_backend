import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { DebtorsService } from '../debtors/debtors.service';

interface BolnaWebhookPayload {
  execution_id: string;
  agent_id: string;
  call_status: string;
  transcript: string;
  call_duration: number;
  to_number: string;
  extracted_data?: {
    call_outcome?: string;
    committed_amount?: number | string | null;
    payment_date?: string | null;
    objection_type?: string | null;
  };
}

type DebtorStatus = 'pending' | 'called' | 'committed' | 'refused' | 'no_answer';

const OUTCOME_TO_STATUS: Record<string, DebtorStatus> = {
  committed: 'committed',
  refused: 'refused',
  no_answer: 'no_answer',
  callback_requested: 'called',
  partial_commitment: 'committed',
};

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private supabase: SupabaseService,
    private debtors: DebtorsService,
  ) { }

  async handleBolnaWebhook(payload: BolnaWebhookPayload): Promise<void> {
    const { to_number, transcript, call_duration, call_status, extracted_data } = payload;

    this.logger.log(`Webhook received: phone=${to_number} status=${call_status}`);
    this.logger.log(`extracted_data: ${JSON.stringify(extracted_data)}`);

    const debtor = await this.debtors.findByPhone(to_number);
    if (!debtor) {
      this.logger.warn(`No debtor found for phone: ${to_number}`);
      return;
    }

    // Call didn't complete — mark no_answer
    if (call_status !== 'completed' || !transcript) {
      await this.debtors.update(debtor.id, { status: 'no_answer', call_duration });
      this.logger.log(`Marked debtor ${debtor.id} as no_answer`);
      return;
    }

    // Parse extracted_data from Bolna
    const outcome = extracted_data?.call_outcome ?? 'no_answer';
    const status: DebtorStatus = OUTCOME_TO_STATUS[outcome] ?? 'called';

    const committed_amount = extracted_data?.committed_amount
      ? Number(extracted_data.committed_amount)
      : null;

    const payment_date = extracted_data?.payment_date ?? null;
    const objection_type = extracted_data?.objection_type ?? null;

    await this.debtors.update(debtor.id, {
      status,
      committed_amount,
      payment_date,
      objection_type,
      call_duration,
      transcript,
    });

    // Update campaign committed total
    if (debtor.campaign_id && committed_amount) {
      await this.incrementCampaignCommitted(debtor.campaign_id, committed_amount);
    }

    this.logger.log(
      `Webhook processed: debtor=${debtor.id} outcome=${outcome} committed=${committed_amount}`,
    );
  }

  private async incrementCampaignCommitted(
    campaignId: string,
    amount: number,
  ): Promise<void> {
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
