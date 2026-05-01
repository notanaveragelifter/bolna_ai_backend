import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../common/supabase.service';
import { DebtorsService } from '../debtors/debtors.service';
import { Campaign } from './campaign.types';

interface BolnaCallPayload {
  agent_id: string;
  recipient_phone_number: string;
  user_data?: Record<string, unknown>;
}

@Injectable()
export class CampaignsService {
  private readonly bolnaBase = 'https://api.bolna.ai';

  constructor(
    private supabase: SupabaseService,
    private debtors: DebtorsService,
    private config: ConfigService,
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

  async triggerCalls(campaignId: string): Promise<{ triggered: number }> {
    const campaign = await this.findOne(campaignId);
    if (!campaign) throw new NotFoundException('Campaign not found');

    const debtorList = await this.debtors.findAll(campaignId);
    const pending = debtorList.filter((d) => d.status === 'pending');

    const agentId = this.config.getOrThrow('BOLNA_AGENT_ID');
    const apiKey = this.config.getOrThrow('BOLNA_API_KEY');

    let triggered = 0;
    for (const debtor of pending) {
      const payload: BolnaCallPayload = {
        agent_id: agentId,
        recipient_phone_number: debtor.phone,
        user_data: {
          debtor_id: debtor.id,
          debtor_name: debtor.name,
          company: debtor.company,
          invoice_amount: debtor.invoice_amount,
          due_date: debtor.due_date,
        },
      };

      const res = await fetch(`${this.bolnaBase}/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await this.debtors.update(debtor.id, { status: 'called' });
        triggered++;
      }
    }

    await this.supabase.db
      .from('campaigns')
      .update({ calls_made: triggered })
      .eq('id', campaignId);

    return { triggered };
  }
}
