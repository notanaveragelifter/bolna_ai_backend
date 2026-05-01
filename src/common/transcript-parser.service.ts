import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface ParsedTranscript {
  call_outcome: 'committed' | 'refused' | 'no_answer' | 'callback_requested' | 'partial_commitment';
  committed_amount: number | null;
  payment_date: string | null;
  objection_type: string | null;
}

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a debt recovery call analyst. Today's date is ${today}.
Given a call transcript, extract:
- call_outcome: one of committed, refused, no_answer, callback_requested, partial_commitment
- committed_amount: numeric amount the debtor agreed to pay (null if none or unclear)
- payment_date: ISO date string (YYYY-MM-DD) when they said they'd pay — use today's year if only a date is mentioned (null if none)
- objection_type: short label for why they refused (e.g. "financial_hardship", "disputes_debt", null if not refused)

Respond ONLY with valid JSON matching this schema. No explanation.`;
}

function buildUserMessage(transcript: string): string {
  return `Transcript:\n${transcript}`;
}

function parseJson(raw: string): ParsedTranscript {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in response');
  return JSON.parse(match[0]) as ParsedTranscript;
}

@Injectable()
export class TranscriptParserService {
  private readonly logger = new Logger(TranscriptParserService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async parse(transcript: string): Promise<ParsedTranscript> {
    try {
      return await this.parseWithAnthropic(transcript);
    } catch (err) {
      this.logger.warn(`Anthropic failed (${(err as Error).message}), falling back to OpenAI`);
      return await this.parseWithOpenAI(transcript);
    }
  }

  private async parseWithAnthropic(transcript: string): Promise<ParsedTranscript> {
    const message = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildUserMessage(transcript) }],
    });

    const text = (message.content[0] as { type: string; text: string }).text;
    const parsed = parseJson(text);
    this.logger.log(`Anthropic parsed: ${JSON.stringify(parsed)}`);
    return parsed;
  }

  private async parseWithOpenAI(transcript: string): Promise<ParsedTranscript> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 256,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserMessage(transcript) },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const parsed = parseJson(text);
    this.logger.log(`OpenAI parsed: ${JSON.stringify(parsed)}`);
    return parsed;
  }
}
