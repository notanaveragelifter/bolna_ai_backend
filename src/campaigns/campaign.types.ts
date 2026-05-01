export interface Campaign {
  id: string;
  name: string;
  total_debtors: number;
  calls_made: number;
  total_committed: number;
  status: 'active' | 'completed' | 'paused';
  created_at: string;
}
