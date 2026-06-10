# DECISIONS.md — implementation choices and trade-offs

Guiding rule from the spec: **when ambiguous, pick what's simpler for a
low-literacy worker on WhatsApp**, then write it down here.

## Architecture

- **Single package, single service.** One Fastify process serves the API, the
  built dashboard (`/app`), webhooks, media, and runs pg-boss. A 500–5,000-cow
  dairy SaaS at MVP scale does not need more moving parts.
- **tsx as the runtime (dev and prod).** No build step for the server; the
  Docker image runs `tsx src/server/index.ts`. Type safety is enforced by
  `pnpm typecheck` in CI/Docker build. Avoids the ESM `.js`-extension dance.
- **Hand-written SQL migrations + 30-line runner** instead of drizzle-kit
  journals. The migration is readable, reviewable, and owns the pgvector
  `CREATE EXTENSION` + HNSW index. Drizzle ORM is still used for all queries.
- **Raw `fetch` Twilio client + own signature validation** instead of the
  `twilio` SDK. We use exactly two endpoints (send message, fetch media); the
  documented HMAC-SHA1 algorithm is 15 lines and unit-tested against a pinned
  vector cross-checked with twilio-node's algorithm.

## Worker experience

- **One conversation per worker** (not per-day/session). Matches how WhatsApp
  actually looks to the worker and keeps the manager's Conversations view simple.
- **Check answers accept digits, ordinals ("la segunda"), and fuzzy option
  text** (voice transcripts like "creo que son treinta segundos"). Ambiguous
  ties are NOT graded — the message falls through to the Q&A pipeline rather
  than risking a wrong grade.
- **Incorrect check answers get the correct answer immediately, no re-quiz.**
  Per spec: confirmation touchpoint, not an exam. One gentle reminder if the
  check is unanswered for 24h, never more.
- **Any inbound message delivers modules stuck in `notified`** (not just
  literal "OK") — a worker replying "buenos dias" instead of OK must not hit
  a dead end. If the message was *only* an acknowledgement, we stop there;
  otherwise we also process it normally.
- **TTS reads the answer without the citation line** (the `📄 Fuente:` line is
  awkward aloud); the text message always carries the citation.
- **Hard pre-LLM guard for salary/legal/immigration/vet-dosing** topics in
  `services/guards.ts`, in addition to the prompt rules. Deterministic
  refusal + escalation in every mode, including keyless mock.

## Data model deltas (vs. the spec's table sketch)

- `module_deliveries.status` (`pending → notified → sent → answered`) was
  added: the template-handshake state machine needs an explicit state, and
  "notified" is meaningfully different from "sent".
- `audit_exports.error_text` and `sop_documents.error_text` surface job
  failures in the dashboard instead of burying them in logs.
- Sessions are **signed cookies, no table** (argon2 + HMAC-signed cookie +
  CSRF double-submit). Revocation = rotate `SESSION_SECRET`. Right-sized for
  an MVP with two roles.

## RAG

- Chunks are embedded as `heading_path + "\n" + content` (the heading context
  measurably helps retrieval of step-specific questions); the stored `content`
  stays clean for display/answering.
- **Similarity floor** defaults: 0.25 (real embeddings) / 0.02 (hash stub),
  overridable via `RETRIEVAL_MIN_SIMILARITY`. The stub floor is intentionally
  forgiving — its job is exercising plumbing, not quality; the eval scorecard
  says so explicitly when stubs are active.
- **Citation enforcement in code**: if Claude forgets the `📄 Fuente:` line on
  a grounded answer, the backend appends it from the top chunk. Refusals never
  carry citations.
- PDFs ingest as flat text (no heading reconstruction); citations then show
  the document title only. Photographed SOPs (Claude vision OCR) and
  Markdown/DOCX preserve headings. Heading heuristics for PDFs were cut as
  too error-prone for a compliance-adjacent feature.

## Keyless mock behavior (explicit degradations)

- No `OPENAI_API_KEY` → deterministic hash-based pseudo-embeddings (bag of
  words + char trigrams, L2-normalized) and **silent placeholder** audio files
  for TTS so the voice code path still runs end-to-end.
- No `ANTHROPIC_API_KEY` → answers are the top retrieved chunk verbatim with a
  `[STUB]` prefix and a real citation; topic classification falls back to a
  keyword taxonomy; **image OCR ingestion fails cleanly** with a clear error
  (PDF/DOCX/MD still ingest) — pretending to OCR would poison retrieval.
- `pnpm eval` falls back to the committed 26-case starter set + heuristic
  grader so the harness always runs; `pnpm generate-eval` requires the key.

## Operational simplifications (single-process assumptions)

- **In-memory rate limiter** (20 msgs/5 min/worker) and unknown-number
  reply-once cache. Multi-machine deployments would need these in
  Postgres/Redis — fine at MVP scale with `min_machines_running = 1`.
- Drip cron granularity is 15 min (`DRIP_CRON`); `send_hour_local` is an hour,
  so worst-case delivery is hh:00–hh:15. Manual trigger exists for demos/tests.
- Deleting an SOP cascades its chunks (answers stop immediately); the original
  uploaded file stays on disk for audit purposes.
- `users` management UI was cut: the owner account is created at setup;
  additional managers can be added via the API. (Schema and auth support both
  roles already.)

## Billing

- Feature-flagged off (`ENABLE_BILLING=false`). Stripe Checkout (base fee +
  per-cow quantity) and a signature-verified webhook are implemented with raw
  `fetch` — no SDK — and never required for the product to run.

## Eval targets

- ≥85% grounded-correct / ≥90% correct-refusal / 0 fabricated citations, as
  specified. "Fabricated citation" is measured mechanically: a cited document
  title that does not exist in the org. The committed starter set pins the
  numeric facts (30 s pre-dip, 4 L colostrum, 22% Brix, 71–77 °C…) so prompt
  regressions surface as failed facts, not vibes.
