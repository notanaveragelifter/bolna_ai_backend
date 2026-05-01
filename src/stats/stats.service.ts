import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

@Injectable()
export class StatsService {
  constructor(private supabase: SupabaseService) {}

  async getStats() {
    const { data, error } = await this.supabase.db
      .from('debtors')
      .select('status, invoice_amount, committed_amount, call_duration');

    if (error) throw new BadRequestException(error.message);

    const total_debtors = data.length;
    const calls_made = data.filter((d) => d.status !== 'pending').length;
    const committed = data.filter((d) => d.status === 'committed');
    const total_committed = committed.reduce(
      (sum, d) => sum + (d.committed_amount ?? 0),
      0,
    );
    const total_invoice = data.reduce(
      (sum, d) => sum + (d.invoice_amount ?? 0),
      0,
    );
    const recovery_rate =
      total_invoice > 0
        ? Math.round((total_committed / total_invoice) * 100)
        : 0;

    const durations = data
      .map((d) => d.call_duration)
      .filter((d): d is number => d !== null);
    const avg_call_duration =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    return {
      total_debtors,
      calls_made,
      total_committed,
      recovery_rate,
      avg_call_duration,
    };
  }
}
