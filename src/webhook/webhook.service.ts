import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { SupabaseService } from '../common/supabase.service';
import { DebtorsService } from '../debtors/debtors.service';

interface BolnaWebhookPayload {
  execution_id: string;
  agent_id: string;
  call_status: string;
  recording_url?: string;
  transcript: string;
  call_duration: number;
  to_number: string;
  extracted_data?: Record<string, unknown>;
}

interface ClaudeExtraction {
  call_outcome:
    | 'committed'
    | 'refused'
    | 'no_answer'
    | 'callback_requested'
    | 'partial_commitment';
  committed_amount: number | null;
  payment_date: string | null;
  objection_type: 'cash_flow' | 'disputes_invoice' | 'wrong_contact' | 'other' | null;
  sentiment: 'positive' | 'neutral' | 'negative';
  summary: string;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private supabase: SupabaseService,
    private debtors: DebtorsService,
    private config: ConfigService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.getOrThrow('ANTHROPIC_API_KEY'),
    });
  }

  async handleBolnaWebhook(payload: BolnaWebhookPayload): Promise<void> {
    const { to_number, transcript, call_duration, recording_url, call_status } =
      payload;

    const debtor = await this.debtors.findByPhone(to_number);
    if (!debtor) {
      this.logger.warn(`No debtor found for phone: ${to_number}`);
      return;
    }

    if (call_status !== 'completed' || !transcript) {
      await this.debtors.update(debtor.id, { status: 'no_answer', call_duration });
      return;
    }

    const extraction = await this.parseTranscript(transcript);

    const statusMap: Record<ClaudeExtraction['call_outcome'], string> = {
      committed: 'committed',
      refused: 'refused',
      no_answer: 'no_answer',
      callback_requested: 'called',
      partial_commitment: 'committed',
    };

    await this.debtors.update(debtor.id, {
      status: statusMap[extraction.call_outcome] as any,
      committed_amount: extraction.committed_amount,
      payment_date: extraction.payment_date,
      objection_type: extraction.objection_type,
      call_duration,
      transcript,
    });

    if (debtor.campaign_id && extraction.committed_amount) {
      await this.incrementCampaignCommitted(
        debtor.campaign_id,
        extraction.committed_amount,
      );
    }

    this.logger.log(
      `Webhook processed: debtor=${debtor.id}, outcome=${extraction.call_outcome}`,
    );
  }

  private async parseTranscript(transcript: string): Promise<ClaudeExtraction> {
    const prompt = `Parse this voice call transcript from a B2B invoice collection call.
Return JSON only, no other text:
{
  "call_outcome": "committed | refused | no_answer | callback_requested | partial_commitment",
  "committed_amount": number or null,
  "payment_date": "YYYY-MM-DD" or null,
  "objection_type": "cash_flow | disputes_invoice | wrong_contact | other" or null,
  "sentiment": "positive | neutral | negative",
  "summary": "one sentence summary in english"
}
Transcript: ${transcript}`;

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      message.content[0].type === 'text' ? message.content[0].text : '{}';

    try {
      return JSON.parse(text) as ClaudeExtraction;
    } catch {
      this.logger.error('Failed to parse Claude response', text);
      return {
        call_outcome: 'no_answer',
        committed_amount: null,
        payment_date: null,
        objection_type: null,
        sentiment: 'neutral',
        summary: 'Unable to parse transcript.',
      };
    }
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
