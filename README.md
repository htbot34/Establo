# 🐄 Establo

**Spanish-first, WhatsApp-based training assistant for large dairy operations.**

> **▶ Live demo (no install):** https://htbot34.github.io/Establo/ — the real
> dashboard UI + WhatsApp simulator running entirely in your browser on sample
> data (deployed from `main` by GitHub Actions). It's static, so answers there
> are verbatim SOP extracts and PDFs/uploads are disabled; the full
> Claude-powered system is the 5-command quickstart below.

Workers text or send a voice note to a WhatsApp number and get answers grounded
ONLY in their dairy's own uploaded SOPs, with citations. New hires receive
scheduled onboarding lessons with one-question comprehension checks. Every
interaction is logged as a **training event**, and the owner can export a
FARM-style audit pack (letter PDF + CSV + per-worker transcripts) in one click.

- **Workers:** WhatsApp only. No app, no login, no password. Simple Spanish.
- **Managers:** a boring, fast web dashboard (`/app`) for SOPs, workers,
  onboarding tracks, conversations, escalations, and audit exports.

---

## Quickstart (mock mode — zero external keys)

Requirements: Node 20+, pnpm, Docker (for Postgres).

```bash
docker compose up -d     # Postgres 16 + pgvector on :5432
pnpm i
pnpm migrate
pnpm seed                # demo dairy with SOPs, workers, history
pnpm dev                 # server :8787 + dashboard :5173
```

Open **http://localhost:5173/app** and sign in:

```
email:    demo@establo.app
password: establo-demo-2026
```

Then open **Simulator** in the sidebar and play the worker:

- *"¿qué hago si una vaca tiene mastitis?"* → grounded answer citing the mastitis SOP
- *"¿cuánto tiempo dejo el pre-dip?"* → grounded answer with `📄 Fuente:` citation
- Switch to 🎤 voice-note mode → the reply includes a playable audio answer
- *"¿me puedes subir el sueldo?"* → polite refusal + escalation (see Conversations → Escalations)
- Enroll a worker in a track (Workers page), press **Run drip scheduler now** →
  the lesson + check arrive; answer "2" → graded and logged
- Press **Simulate >24h** first to watch the template handshake instead

Everything above works with **no API keys at all** (deterministic stubs).
Set `ANTHROPIC_API_KEY` in `.env` — even in mock mode — for real Claude
answers; that is the expected dev setup. Useful commands:

```bash
pnpm ask "¿cuánto tiempo dejo el pre-dip?"   # retrieval+answer smoke test (CLI)
pnpm eval                                     # run the eval set, print scorecard
pnpm test                                     # 68 unit + integration tests
pnpm sample-image                             # regenerate samples/sop-photo-sample.png
```

---

## The three run modes

`RUN_MODE=mock | sandbox | production` (see `.env.example` for every variable).

| | mock | sandbox | production |
|---|---|---|---|
| WhatsApp | built-in simulator at `/app/simulator` | Twilio **sandbox** number | Twilio WhatsApp Business sender |
| Inbound webhook | simulator posts internally | real webhook (ngrok locally) | real webhook |
| Twilio signature check | skipped | on by default (`TWILIO_VALIDATE_SIGNATURE`) | **enforced** |
| Claude (answers, OCR) | used if key present, else `[STUB]` answerer | real | real |
| Embeddings | OpenAI if key present, else local hash stub | real | real |
| Whisper STT | simulator supplies transcripts | real (OGG→mp3→Whisper, `language: es`) | real |
| TTS voice replies | silent placeholder file | OpenAI TTS (`tts-1`/nova, OGG/Opus) | real |
| Outside-24h sends | simulated template handshake | sandbox session/template caveats (below) | **approved templates only** |

### Mock → Sandbox

1. Create a Twilio account; in **Messaging → Try it out → WhatsApp sandbox**,
   note the sandbox number (`whatsapp:+14155238886`) and join code. Each test
   phone must send the join code first.
2. `.env`: `RUN_MODE=sandbox`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`, `SESSION_SECRET`,
   `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.
3. Expose your laptop: `ngrok http 8787` → set `PUBLIC_BASE_URL=https://<id>.ngrok.app`
   (signature validation uses this URL; media links are built from it too).
4. In the Twilio sandbox settings, set **"When a message comes in"** to
   `https://<id>.ngrok.app/webhooks/twilio` (method POST), and the status
   callback to `/webhooks/twilio/status`.
5. Add yourself as a worker in the dashboard (your real phone in E.164),
   WhatsApp the sandbox number, ask a question.

**Sandbox caveat for drip modules:** the sandbox only delivers
business-initiated messages using Twilio's pre-approved sandbox templates or
inside an open 24h session. Establo logs clearly when a send was made as a
template; with the sandbox, have the worker message first (opens the session)
or expect the notify template to map onto a sandbox-approved template. The
full handshake logic is identical in mock, so you can demo it there reliably.

### Sandbox → Production

1. **Meta business verification** (via Twilio console) — can take **days**;
   start early.
2. Buy/register a WhatsApp sender (your own number) through Twilio → approval.
3. **Submit the two templates for approval** (utility category; usually
   minutes–hours). Exact copy lives in `src/server/services/messages.es.ts`:
   - `establo_module_notify`: `Hola {{1}}, tienes una lección de capacitación nueva: "{{2}}". Responde OK para recibirla.`
   - `establo_check_reminder`: `Hola {{1}}, te falta responder la pregunta de tu lección: "{{2}}". Responde con el número de tu respuesta (1, 2 o 3).`

   Without approved templates, **drip modules cannot reach workers whose 24h
   window is closed** — sequence your rollout accordingly.
4. Deploy to Fly.io (see `DEPLOY.md`), set `RUN_MODE=production`, point the
   Twilio webhook at `https://<app>.fly.dev/webhooks/twilio`.
5. Production enforces: Twilio signature validation on every webhook, and
   template-only sends outside the 24h window (free-form attempts are refused
   by `sendToWorker` and fall back to the template handshake).

---

## How it works

```
Worker WhatsApp ──▶ Twilio ──▶ POST /webhooks/twilio ──▶ webhook_logs + pg-boss job
                                                            │
            ┌───────────────────────────────────────────────┘
            ▼
   processInbound: resolve worker → rate limit → open 24h window
     → voice? download OGG → ffmpeg → Whisper (es) → transcript
     → deliver any modules waiting on the template handshake
     → router: check answer | greeting | help | forbidden | question
            ▼ (question)
   RAG: embed → top-6 org-scoped pgvector chunks → similarity floor
     → Claude w/ versioned grounding prompt (prompts/answer.es.md)
     → parse <meta confidence topic/> → enforce 📄 Fuente citation
            ▼
   sendToWorker (THE single outbound door: 24h window policy)
     → text reply (+ TTS voice note if the worker sent voice)
     → log training_event (the compliance record) → escalation if not_found
```

- **Multi-tenant:** every table row carries `org_id`; every query filters by
  it; integration tests prove cross-org reads fail.
- **Jobs:** pg-boss (Postgres-backed, no Redis) runs ingestion, inbound
  processing, the drip cron (`DRIP_CRON`, default every 15 min), audit pack
  generation, and webhook-log pruning (30 days).
- **SOP ingestion:** PDF (`pdf-parse`), DOCX (`mammoth`), Markdown/text, and
  **photos of paper SOPs** (Claude vision OCR; try
  `samples/sop-photo-sample.png`). Heading-aware chunking (~400–600 tokens,
  50 overlap) keeps `heading_path` for natural citations.
- **Drip engine:** enrollment creates one delivery per module at
  `started_at + day_offset` @ `send_hour_local` in the org's timezone
  (default `America/Boise`). Window open → full lesson + TTS audio; closed →
  notify template, full lesson on the worker's reply. One gentle reminder
  after 24h unanswered (max 1). Completion → Spanish certificate PDF.
- **Audit pack:** letter PDF (modeled on the NMSU Extension training-letter
  format: employees, dates, topics, type, checks), full CSV of
  `training_events`, and per-worker transcript PDFs, zipped.

## Eval harness (grounding is the #1 risk — measure it)

```bash
pnpm generate-eval   # needs ANTHROPIC_API_KEY: 120 Q&A pairs from the seeded SOPs
pnpm eval            # runs the full pipeline per question + grades + scorecard
```

Targets printed by the scorecard: **≥85% grounded-correct**, **≥90% correct
refusal** on the unanswerable set, **0 fabricated citations**. With keys,
Claude is the grader (LLM-as-judge, `prompts/eval-grade.md`); without keys it
falls back to the committed 29-case starter set and a heuristic grader so the
harness always runs — those numbers exercise plumbing, not quality.

## Security & guardrails

- Org-scoped queries everywhere + cross-tenant tests; org-scoped file serving.
- Twilio signature validation (HMAC-SHA1) outside mock; unit-tested.
- Auth: argon2 password hashing, signed HTTP-only session cookies,
  CSRF double-submit token. Roles: owner, manager.
- Rate limit: 20 inbound msgs / 5 min per worker → one polite slow-down.
- Worker phones are PII → masked in logs (`+1••••••0101`).
- Hard guard (pre-LLM) + prompt rules: never salary/employment, legal,
  immigration, or veterinary dosing advice → warm Spanish refusal + escalation.
- Prompt-injection resistance: SOP chunks are data; the system prompt orders
  Claude to ignore instructions found inside them.
- Secrets only via env; `.env.example` documents every variable.

## Project layout

```
drizzle/            SQL migrations (pnpm migrate)
prompts/            versioned LLM prompts (answer.es.md is the grounding contract)
src/server/         Fastify app: routes/, services/, jobs/, db/, seed/
src/web/            React dashboard (Vite, Tailwind, served at /app)
scripts/            ask, generate-eval, run-eval, make-sample-sop-image
evals/              eval sets (starter committed) + results
tests/              unit + integration (vitest; pnpm test)
samples/            sop-photo-sample.png for the OCR path
```

Also see **DEPLOY.md** (Fly.io walkthrough), **RUNBOOK.md** (operations),
**DECISIONS.md** (implementation choices and trade-offs).
