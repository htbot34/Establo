# Establo Runbook

Operational guide for whoever is on the hook when something looks off.

## Daily signals worth a glance

- **Dashboard → Overview:** open knowledge gaps (escalations) should be
  triaged within a day — they are workers who hit a dead end.
- **SOPs page:** any document stuck in `processing` or `failed`.
- `fly logs` (production): `[pg-boss]` errors or `[job ...] failed` lines.

## Common situations

### A worker says "no me contesta"
1. Conversations page → find the worker → is the inbound arriving at all?
2. Not arriving → Twilio Console → Monitor → Messaging logs. Webhook errors
   mean `PUBLIC_BASE_URL`/webhook URL drift (signature validation fails with
   403) — fix the Twilio webhook URL or the secret.
3. Arriving but no reply → check `webhook_logs.error_text`
   (`SELECT error_text FROM webhook_logs WHERE processed = false ORDER BY created_at DESC LIMIT 20;`)
   and `fly logs` for the job error. Anthropic/OpenAI outages degrade to
   errors here; the worker can be answered manually meanwhile.
4. Unknown number? Workers must exist (active, exact E.164) before Establo
   responds. Check the Workers page for typos (+1 vs +52 prefixes).

### Drip modules aren't going out
1. Simulator (mock) or `POST /api/admin/run-drip` (any mode, owner session)
   forces a tick; the response says delivered/notified/reminded.
2. `notified` but never delivered → the worker never replied to the template.
   That's expected behavior (24h window). The lesson goes out the moment they
   write anything.
3. Template sends failing in production → check the template approval status
   in Twilio; the exact body text must match the approved template.
4. Machine asleep? `auto_stop_machines` must be `off` — the cron lives in the
   web process.

### SOP upload failed
- `failed` status shows the reason in the SOPs table:
  - *OCR requires ANTHROPIC_API_KEY* — set the key; photos need Claude vision.
  - *No text could be extracted* — scanned PDF with no text layer: re-upload
    the pages as photos instead (OCR path), or export a text PDF.
- Fix the cause then press **Retry** (re-ingests in place).

### Eval scores dropped after editing prompts/SOPs
```bash
pnpm eval                      # uses evals/establo-eval-v1.jsonl when present
pnpm generate-eval             # regenerate the set after large SOP changes
```
Treat `prompts/answer.es.md` as a versioned contract — re-run the eval after
ANY edit to it and compare `evals/results-*.json`.

### Rotating credentials
- `fly secrets set ANTHROPIC_API_KEY=... OPENAI_API_KEY=...` → automatic restart.
- Twilio auth token rotation: update `TWILIO_AUTH_TOKEN` immediately —
  signature validation breaks (403s on every webhook) until they match.
- `SESSION_SECRET` rotation signs everyone out (sessions are cookie-signed).

### Database
- Migrations run on deploy (`release_command`). Manually: `fly ssh console -C "pnpm migrate"`.
- The compliance source of truth is `training_events` — treat it as
  append-only. Audit packs are regenerated from it at any time, for any range.

## Twilio / Meta checklist (kept here because it gates launches)

1. Meta business verification (days) → 2. WhatsApp sender approval →
3. Template approval for `establo_module_notify` + `establo_check_reminder`
(minutes–hours; utility category) → 4. Point webhooks → 5. Send a real
voice-note question end-to-end before onboarding a dairy.

## Local dev quirks

- `pnpm dev` runs server (8787) + Vite (5173); the dashboard proxies API calls,
  so use http://localhost:5173/app.
- Sandbox webhooks locally: `ngrok http 8787`, set `PUBLIC_BASE_URL` to the
  ngrok URL (signature validation depends on it), update the Twilio webhook.
- Tests want Postgres on :5432 (`docker compose up -d`); they create and wipe
  their own `establo_test` database.
