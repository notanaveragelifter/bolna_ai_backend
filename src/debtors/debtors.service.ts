import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { Debtor } from './debtor.types';
import { parse } from 'csv-parse/sync';

interface CsvRow {
  name: string;
  phone: string;
  company: string;
  invoice_amount: string;
  due_date: string;
}

@Injectable()
export class DebtorsService {
  constructor(private supabase: SupabaseService) {}

  async uploadCsv(buffer: Buffer, campaignId?: string): Promise<Debtor[]> {
    const rows: CsvRow[] = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const required = ['name', 'phone', 'company', 'invoice_amount', 'due_date'];
    const cols = Object.keys(rows[0] ?? {});
    const missing = required.filter((r) => !cols.includes(r));
    if (missing.length) {
      throw new BadRequestException(`CSV missing columns: ${missing.join(', ')}`);
    }

    const records = rows.map((r) => ({
      name: r.name,
      phone: r.phone,
      company: r.company,
      invoice_amount: parseFloat(r.invoice_amount),
      due_date: r.due_date,
      status: 'pending' as const,
      campaign_id: campaignId ?? null,
    }));

    const { data, error } = await this.supabase.db
      .from('debtors')
      .insert(records)
      .select();

    if (error) throw new BadRequestException(error.message);
    return data as Debtor[];
  }

  async findAll(campaignId?: string): Promise<Debtor[]> {
    let query = this.supabase.db
      .from('debtors')
      .select('*')
      .order('created_at', { ascending: false });

    if (campaignId) query = query.eq('campaign_id', campaignId);

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data as Debtor[];
  }

  async findOne(id: string): Promise<Debtor> {
    const { data, error } = await this.supabase.db
      .from('debtors')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new BadRequestException(error.message);
    return data as Debtor;
  }

  async findByPhone(phone: string): Promise<Debtor | null> {
    const { data } = await this.supabase.db
      .from('debtors')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return data as Debtor | null;
  }

  async update(id: string, patch: Partial<Debtor>): Promise<Debtor> {
    const { data, error } = await this.supabase.db
      .from('debtors')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data as Debtor;
  }
}
