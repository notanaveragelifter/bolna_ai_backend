# RecoverIQ Backend

NestJS backend for debt-recovery campaign operations:
- campaign management
- debtor ingestion and tracking
- Bolna outbound call triggering
- webhook/sync-based transcript ingestion
- AI transcript parsing with Anthropic primary and OpenAI fallback
- campaign and global recovery analytics

## Tech Stack

- Runtime: Node.js + TypeScript + NestJS
- DB: Supabase (PostgREST via `@supabase/supabase-js`)
- Calling provider: Bolna API
- AI parsing: Anthropic (`@anthropic-ai/sdk`) with OpenAI (`openai`) fallback
- Auth: static bearer token (`API_SECRET`)

## Project Structure

```text
src/
  campaigns/
    campaigns.controller.ts
    campaigns.service.ts
    campaigns.module.ts
  debtors/
    debtors.controller.ts
    debtors.service.ts
    debtors.module.ts
  webhook/
    webhook.controller.ts
    webhook.service.ts
    webhook.module.ts
  stats/
    stats.controller.ts
    stats.service.ts
    stats.module.ts
  common/
    auth.guard.ts
    supabase.service.ts
    bolna.service.ts
    transcript-parser.service.ts
  app.module.ts
  main.ts
```

## Environment Variables

Create `.env` in repo root.

```env
# Bolna
BOLNA_API_KEY=
BOLNA_AGENT_ID=

# Supabase (required by current code)
SUPABASE_URL=
SUPABASE_ANON_KEY=

# AI parsing
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# API auth for protected routes
API_SECRET=your-static-secret-here

# Server
PORT=3000
```

### Important Notes

- `SUPABASE_ANON_KEY` is what current code reads.
- `.env.example` may still mention `SUPABASE_SERVICE_KEY`; keep `.env` aligned with code.
- `TranscriptParserService` currently reads AI keys from `process.env` directly.

## Local Setup

```bash
npm install
npm run start:dev
```

Server defaults to `http://localhost:3000`.

## Authentication Model

Protected routes require:

```http
Authorization: Bearer <API_SECRET>
```

Guard behavior:
- Missing auth header -> `401`
- Header without `Bearer ` prefix -> `401`
- Invalid token -> `401`

Unprotected routes:
- `POST /webhook/bolna`
- `POST /webhook/bolna/sync`

## Data Model (runtime assumptions)

### Debtor fields used by backend

- `id`
- `name`
- `phone`
- `company`
- `invoice_amount`
- `due_date`
- `status` (`pending | called | committed | refused | no_answer`)
- `committed_amount`
- `payment_date`
- `objection_type`
- `call_duration`
- `transcript`
- `campaign_id`
- `created_at`

### Campaign fields used by backend

- `id`
- `name`
- `total_debtors`
- `calls_made`
- `total_committed`
- `status` (`active | completed | paused`)
- `created_at`

## End-to-End Flow

### 1) Campaign + Debtor Setup

1. Create campaign via `POST /campaigns`.
2. Upload debtor CSV via `POST /debtors/upload?campaign_id=<id>`.
3. Debtors are inserted with initial status `pending`.

### 2) Trigger Calling

1. `POST /campaigns/:id/trigger` loads debtors for campaign.
2. For each debtor, backend calls Bolna `POST /call`.
3. Debtor status is updated to `called`.
4. Backend schedules polling (`pollForCompletion`) for each returned execution ID.
5. Campaign `calls_made` is updated to number of successful trigger attempts.

### 3) Call Result Ingestion

Two parallel ingestion mechanisms exist:

- Push: Bolna webhook -> `POST /webhook/bolna`
- Pull: periodic sync (`setInterval`) and manual sync -> `POST /webhook/bolna/sync`

Webhook module auto-polls Bolna completed executions every `30s`.

### 4) Transcript Processing

For each completed execution:

1. Identify debtor by `debtor_id` in execution context, else by phone.
2. Save transcript and call duration immediately.
3. Use provider `extracted_data` if present.
4. If `call_outcome` missing, parse transcript via AI:
   - first Anthropic
   - if Anthropic fails, fallback to OpenAI
5. Map `call_outcome` to debtor status:
   - `committed` -> `committed`
   - `partial_commitment` -> `committed`
   - `refused` -> `refused`
   - `no_answer` -> `no_answer`
   - `callback_requested` -> `called`
6. Compute `committed_amount`:
   - use extracted amount when present
   - else fallback to `invoice_amount` for committed outcomes
7. Save extracted fields on debtor.
8. Increment campaign `total_committed` when applicable.

## AI Parsing Behavior

`TranscriptParserService` implements:

- `parse(transcript)`:
  - `parseWithAnthropic()`
  - catch error -> `parseWithOpenAI()`
- Both models are prompted to output strict JSON:
  - `call_outcome`
  - `committed_amount`
  - `payment_date`
  - `objection_type`

If both providers fail, processing still completes with default-safe behavior (`no_answer` fallback path in calling flow).

## API Reference

Base URL examples assume `http://localhost:3000`.

---

### Health/Test

#### `GET /`
Returns default hello message.

```bash
curl -s http://localhost:3000/
```

---

### Debtors (Protected)

#### `GET /debtors`
List all debtors (newest first).

```bash
curl -s http://localhost:3000/debtors \
  -H "Authorization: Bearer $API_SECRET"
```

#### `GET /debtors?campaign_id=<campaignId>`
List debtors for one campaign.

#### `GET /debtors/:id`
Get one debtor.

#### `POST /debtors/upload`
Upload CSV file; supports campaign id as query or body.

Expected CSV headers:
- `name`
- `phone`
- `company`
- `invoice_amount`
- `due_date`

Example:

```bash
curl -X POST "http://localhost:3000/debtors/upload?campaign_id=<campaignId>" \
  -H "Authorization: Bearer $API_SECRET" \
  -F "file=@./debtors.csv"
```

Validation:
- missing file -> `400`
- missing required columns -> `400`

---

### Campaigns (Protected)

#### `GET /campaigns`
List campaigns.

#### `GET /campaigns/:id`
Get one campaign.

#### `POST /campaigns`
Create campaign.

Body:

```json
{ "name": "April Recovery Batch" }
```

#### `POST /campaigns/:id/trigger`
Trigger outbound calls for all debtors in that campaign.

Response shape:

```json
{
  "triggered": 10,
  "errors": [
    { "phone": "+919999999999", "error": "HTTP 400: ..." }
  ]
}
```

---

### Stats (Protected)

#### `GET /stats`
Aggregated performance stats from debtors table:
- `total_debtors`
- `calls_made`
- `total_committed`
- `recovery_rate` (%)
- `avg_call_duration` (seconds)

#### `GET /stats/executions`
Fetch all Bolna executions (optional `?status=<value>`).

#### `GET /stats/executions/:executionId`
Fetch single Bolna execution detail.

---

### Webhooks / Sync (Unprotected)

#### `POST /webhook/bolna`
Entry point for Bolna webhook payload. Always returns `{ "ok": true }` on accepted processing path.

#### `POST /webhook/bolna/sync`
Manually pull completed Bolna executions and process them.

Response:

```json
{
  "processed": 12,
  "skipped": 8,
  "errors": 1
}
```

## Example Operational Sequence

1. `POST /campaigns` create campaign
2. `POST /debtors/upload?campaign_id=<id>` upload CSV
3. `POST /campaigns/:id/trigger` launch calls
4. Wait for:
   - Bolna webhook pushes, and/or
   - auto-sync every 30s, and/or
   - manual `POST /webhook/bolna/sync`
5. `GET /debtors?campaign_id=<id>` inspect statuses and extracted outcomes
6. `GET /stats` inspect recovery metrics

## NPM Scripts

```bash
npm run build
npm run start
npm run start:dev
npm run start:prod
npm run lint
npm run test
npm run test:e2e
```

## Troubleshooting

### Port already in use (`EADDRINUSE: 3000`)

```bash
lsof -ti :3000 | xargs kill -9
```

If multiple PIDs are attached, kill each PID.

### Anthropic returns credit error

If API responds with "credit balance is too low":
- verify billing in correct Anthropic workspace
- generate key from same workspace with credits
- use OpenAI fallback as configured (requires `OPENAI_API_KEY`)

### OpenAI auth fails

- verify key format starts with `sk-`
- test quickly:

```bash
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Debtor not found during execution processing

Execution may not include expected `debtor_id` or normalized phone format.
Check Bolna `context_details` and debtor `phone` formatting consistency.

## Security Recommendations

- Never commit real API keys.
- Rotate any key that has been pasted into chat/logs.
- Consider signing/validating webhook source if exposed publicly.
- Consider replacing static `API_SECRET` with JWT/auth provider for production.

## Known Design Notes

- `WebhookService` includes both push and pull ingestion, reducing missed updates.
- Campaign call trigger includes asynchronous poller and webhook/sync may also process outcomes; logic skips already processed debtors.
- AI extraction is best-effort and defaults to safe status mapping when data is missing.

## License

UNLICENSED (as configured in `package.json`).
