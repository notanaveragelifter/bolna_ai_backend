#!/usr/bin/env node
/**
 * Test AI transcript extraction for a specific debtor.
 * Usage:
 *   node -r dotenv/config test-extraction.js           # dry run (no save)
 *   node -r dotenv/config test-extraction.js --save    # save to Supabase
 */
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk').default;
const OpenAI = require('openai').default;
const { createClient } = require('@supabase/supabase-js');

const DEBTOR_ID  = 'f385d333-04e2-4dec-9408-9c8c6ab73338';
const AGENT_ID   = process.env.BOLNA_AGENT_ID;
const BOLNA_KEY  = process.env.BOLNA_API_KEY;
const SAVE       = process.argv.includes('--save');

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai     = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TODAY = new Date().toISOString().slice(0, 10);
const SYSTEM_PROMPT = `You are a debt recovery call analyst. Today's date is ${TODAY}.
Given a call transcript, extract:
- call_outcome: one of committed, refused, no_answer, callback_requested, partial_commitment
- committed_amount: numeric amount the debtor agreed to pay (null if none or unclear)
- payment_date: ISO date string (YYYY-MM-DD) when they said they'd pay — use today's year if only a date is mentioned (null if none)
- objection_type: short label for why they refused (e.g. "financial_hardship", "disputes_debt", null if not refused)

Respond ONLY with valid JSON matching this schema. No explanation.`;

async function parseWithAnthropic(transcript) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Transcript:\n${transcript}` }],
  });
  const text = msg.content[0].text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in Anthropic response');
  return JSON.parse(match[0]);
}

async function parseWithOpenAI(transcript) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 256,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Transcript:\n${transcript}` },
    ],
  });
  const text = res.choices[0]?.message?.content ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in OpenAI response');
  return JSON.parse(match[0]);
}

async function parseTranscript(transcript) {
  try {
    console.log('Trying Anthropic...');
    const result = await parseWithAnthropic(transcript);
    console.log('Anthropic succeeded');
    return result;
  } catch (e) {
    console.warn(`Anthropic failed: ${e.message} — falling back to OpenAI`);
    const result = await parseWithOpenAI(transcript);
    console.log('OpenAI succeeded');
    return result;
  }
}

async function fetchLatestExecution(phone) {
  let page = 1, found = null;
  while (!found) {
    const url = `https://api.bolna.ai/v2/agent/${AGENT_ID}/executions?page_number=${page}&page_size=50&status=completed`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${BOLNA_KEY}` } });
    if (!res.ok) throw new Error(`Bolna API ${res.status}`);
    const body = await res.json();
    // match by debtor_id in context OR by phone
    found = body.data.find(e =>
      e.context_details?.recipient_data?.debtor_id === DEBTOR_ID ||
      e.context_details?.user_data?.debtor_id === DEBTOR_ID ||
      e.user_number === phone ||
      e.telephony_data?.to_number === phone
    );
    if (!body.has_more) break;
    page++;
  }
  return found ?? null;
}

async function main() {
  console.log(`\n=== Debtor: ${DEBTOR_ID} ===`);
  console.log(`Mode: ${SAVE ? 'SAVE to Supabase' : 'DRY RUN (pass --save to persist)'}\n`);

  // 1. Fetch debtor
  const { data: debtor, error: dErr } = await supabase
    .from('debtors').select('*').eq('id', DEBTOR_ID).single();
  if (dErr) { console.error('Debtor not found:', dErr.message); process.exit(1); }
  console.log(`Debtor: ${debtor.name} | phone: ${debtor.phone} | invoice: ₹${debtor.invoice_amount}`);

  // 2. Fetch Bolna execution
  console.log('\nFetching Bolna executions...');
  const exec = await fetchLatestExecution(debtor.phone);
  if (!exec) {
    console.error('No completed Bolna execution found for this debtor.');
    process.exit(1);
  }
  console.log(`Found execution: ${exec.id} | status: ${exec.status}`);
  console.log(`Duration: ${exec.telephony_data?.duration}s`);
  console.log(`\nTranscript (${exec.transcript?.length ?? 0} chars):\n`);
  console.log(exec.transcript ?? '(empty)');

  if (!exec.transcript) {
    console.error('\nNo transcript in this execution. Call may not have been answered.');
    process.exit(1);
  }

  // 3. Run AI extraction
  console.log('\n--- AI Extraction ---');
  const parsed = await parseTranscript(exec.transcript);
  console.log('\nExtracted:');
  console.log(JSON.stringify(parsed, null, 2));

  // 4. Save to Supabase
  if (SAVE) {
    const OUTCOME_TO_STATUS = {
      committed: 'committed', refused: 'refused', no_answer: 'no_answer',
      callback_requested: 'called', partial_commitment: 'committed',
    };
    const status = OUTCOME_TO_STATUS[parsed.call_outcome] ?? 'called';
    // If debtor committed but AI couldn't read the amount (template not substituted), use invoice_amount
    const committed_amount =
      parsed.committed_amount ??
      (['committed', 'partial_commitment'].includes(parsed.call_outcome) ? debtor.invoice_amount : null);
    const { error } = await supabase.from('debtors').update({
      status,
      committed_amount,
      payment_date: parsed.payment_date ?? null,
      objection_type: parsed.objection_type ?? null,
      call_duration: Number(exec.telephony_data?.duration ?? 0),
      transcript: exec.transcript,
    }).eq('id', DEBTOR_ID);
    if (error) { console.error('\nSupabase save failed:', error.message); process.exit(1); }
    console.log(`\nSaved to Supabase: status=${status} committed=₹${parsed.committed_amount} payment=${parsed.payment_date}`);
  } else {
    console.log('\n(Dry run — run with --save to persist to Supabase)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
