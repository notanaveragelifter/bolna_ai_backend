export type DebtorStatus =
  | 'pending'
  | 'called'
  | 'committed'
  | 'refused'
  | 'no_answer';

export interface Debtor {
  id: string;
  name: string;
  phone: string;
  company: string;
  invoice_amount: number;
  due_date: string;
  status: DebtorStatus;
  committed_amount: number | null;
  payment_date: string | null;
  objection_type: string | null;
  call_duration: number | null;
  transcript: string | null;
  campaign_id: string | null;
  created_at: string;
}
