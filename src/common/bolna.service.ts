import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BolnaExecution {
  id: string;
  agent_id: string;
  batch_id: string | null;
  conversation_time: number;
  total_cost: number;
  status: string;
  error_message: string | null;
  answered_by_voice_mail: boolean;
  transcript: string | null;
  created_at: string;
  updated_at: string;
  extracted_data: Record<string, unknown> | null;
  context_details: Record<string, unknown> | null;
  telephony_data: {
    duration: string;
    to_number: string;
    from_number: string;
    recording_url: string | null;
    hosted_telephony: boolean;
    call_type: string;
    provider: string;
    hangup_by: string;
    hangup_reason: string;
    ring_duration: number;
  } | null;
  cost_breakdown: {
    llm: number;
    network: number;
    platform: number;
    synthesizer: number;
    transcriber: number;
  } | null;
}

export interface BolnaExecutionsResponse {
  page_number: number;
  page_size: number;
  total: number;
  has_more: boolean;
  data: BolnaExecution[];
}

@Injectable()
export class BolnaService {
  private readonly logger = new Logger(BolnaService.name);
  private readonly baseUrl = 'https://api.bolna.ai';

  constructor(private config: ConfigService) {}

  private get apiKey(): string {
    return this.config.getOrThrow('BOLNA_API_KEY');
  }

  private get agentId(): string {
    return this.config.getOrThrow('BOLNA_AGENT_ID');
  }

  /**
   * Fetch all executions for the configured agent.
   * Automatically paginates to get all results.
   */
  async getAllExecutions(status?: string): Promise<BolnaExecution[]> {
    const all: BolnaExecution[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        page_number: String(page),
        page_size: '50',
      });
      if (status) params.set('status', status);

      const url = `${this.baseUrl}/v2/agent/${this.agentId}/executions?${params}`;

      this.logger.log(`Fetching executions page ${page}…`);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`Bolna API error: HTTP ${res.status} — ${errText}`);
        throw new Error(`Bolna API error: HTTP ${res.status}`);
      }

      const body: BolnaExecutionsResponse = await res.json();
      all.push(...body.data);
      hasMore = body.has_more;
      page++;
    }

    this.logger.log(`Fetched ${all.length} total executions from Bolna`);
    return all;
  }

  /**
   * Fetch a single execution by ID.
   */
  async getExecution(executionId: string): Promise<BolnaExecution> {
    const url = `${this.baseUrl}/executions/${executionId}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Bolna API error: HTTP ${res.status} — ${errText}`);
    }

    return res.json();
  }
}
