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
- `pnpm eval` falls back to the committed 29-case starter set + heuristic
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

## Static demo polish for industry review (June 2026)

- **Sixth seed SOP: "Detección y manejo de mastitis".** The most obvious
  dairy question ("¿qué hago si una vaca tiene mastitis?") used to land on
  "Rutina de ordeño > Secado". The new SOP contains **zero medication,
  antibiotic, or dosing content**: it teaches detect → mark → separate →
  tell the encargado, and states that treatment is decided by the encargado
  with the veterinario — reinforcing the vet-dosing guard instead of
  undermining it. Cross-checked mechanically: no `guards.ts` regex matches
  any line of the SOP.
- **No 7th onboarding module.** The induction track stays at 6 lessons;
  mastitis is showcased through live Q&A, which is what reviewers will
  exercise. Simpler than re-balancing the drip schedule for new hires.
- **The new SOP's wording is retrieval-aware.** "Señales de alerta" says
  "los primeros chorros" without the literal word "despunte" (that word
  stays in the intro), so "¿cuántos chorros saco en el despunte?" keeps
  resolving to "Rutina de ordeño > Despunte" rather than the mastitis
  signals chunk.
- **Demo retrieval scoring (in `demoApi.ts` only; the real pgvector
  pipeline is untouched).** Heading words now add +0.5 when a query token
  reaches them only through a shared 4-char stem ("lavar" → "Lavado"), and
  never for tokens the body text already matched. The guard matters: an
  unconditional heading bonus let "Equipo de protección personal (EPP)"
  outrank the CIP wash chunk for "¿a qué temperatura … lavar el equipo?"
  (the "equipo" homonym) and flipped the cloro+ácido answer away from the
  chemicals SOP. Also added `sale` to the demo stopword list — "¿qué hago
  si la leche sale con grumos?" was matching "el agua sale clara" in the
  CIP rinse chunk.
- **Silent TTS players become a labeled, non-interactive pill in the hosted
  demo** (`IS_DEMO` only): "🔊 respuesta de voz — silenciada en este demo
  (el sistema real envía audio TTS)". A pill rather than a relabeled player
  so no visitor can press play and hear silence. Mock/sandbox/production
  keep the real `<audio>` element.
- Fixture regenerated through the real pipeline (`migrate → seed →
  export-demo-fixture`) against a local Postgres 16 + pgvector instance
  (Docker was unavailable in the environment used for this change — same
  code path, no hand edits to `fixture.json`).


## Compliance hardening pass (June 2026)

### Baseline fix that preceded everything: day-0 scheduling

`computeScheduledFor` waited for `send_hour_local` even on day-0 modules,
contradicting its own docstring ("day-0 modules go out immediately after
enrollment") and making 5 tests + the README demo script fail for anyone
running before 7 AM Boise time. Day-0 modules now schedule at enrollment
time; later modules keep the send-hour behavior (don't text workers at 2 AM).

### Task 1 — opt-in/opt-out

- **`consented_at` records the latest consent transition** (opt-in OR
  opt-out), not only opt-ins — one timestamp column, unambiguous with
  `consent_status` next to it.
- **Migration backfill**: existing workers with `last_inbound_at` became
  `opted_in` with method `imported` — they had already chosen to message the
  number, which is exactly the opt-in signal; workers who never wrote stay
  `pending`. Backfilling everyone to `pending` would have silently stopped
  drips for live dairies.
- **Both WhatsApp opt-in paths record method `whatsapp_keyword`** (ALTA and
  any-first-message). The spec fixed the enum to three values; adding a fourth
  for "first message" wasn't worth deviating. The conversation log shows which
  message it was.
- **`sendToWorker` gate is fail-closed by send kind**: `business` (the
  default — drip lessons, reminders, templates, agreement requests) requires
  `opted_in`; `reply` (explicitly marked at each call site in the inbound
  pipeline) is allowed unless `opted_out`; `consent` (opt-out confirmation,
  disclosure, re-join confirmation) always goes — Meta requires opt-outs to be
  confirmed. Callers that forget to mark a reply get refusals, never leaks.
- **Text BAJA/ALTA bypasses the rate limiter** (an opt-out must never be
  dropped by flood control) but is processed after the message is recorded —
  the keyword message itself is the consent record.
- **Opted-out workers who write anything else** get one "estás dado de baja,
  escribe ALTA" reminder per 24h (in-memory cache, same pattern as the
  unknown-number reply) and otherwise silence. Full silence felt like a dead
  end for a worker who may not remember texting BAJA.
- **Paper consent can never override BAJA** (409): only the worker can rejoin.

### Task 2 — disclosure

One short paragraph (5 sentences), not legalese, sent before the normal reply
on the first-ever processed message and gated by `disclosure_sent_at`.
Existing seeded/live workers with history get it on their NEXT message —
backfilling the timestamp would have claimed we sent something we never sent.

### Task 3 — cow care agreement

- Versioning is append-only: editing the text in Settings creates version
  n+1 and deactivates the old row; signatures keep pointing at the exact
  version signed.
- "Send agreement" with a closed 24h window **queues** it
  (`pending_agreement_sent_at` stays null) and it goes out with the worker's
  next inbound message — there is no approved template for agreement text, so
  this mirrors the module notify/deliver pattern without a new template.
- Non-ACEPTO replies while an agreement is pending: first one gets the gentle
  clarification, the second escalates to the manager AND clears the pending
  state (the manager re-sends if appropriate) — workers are never nagged
  forever, and their actual question in that message still gets answered
  normally after the nudge.
- ACEPTO matching is strict (`acepto` / `sí acepto` / `lo acepto` / `acepto el
  acuerdo` as the whole message) — a signature should never fire on an
  incidental word inside a longer sentence.

### Task 4 — farm_topic + sign-off

- Q&A classification is a pure keyword table (`services/farmTopics.ts`):
  job-specific keyword pass over the question text first (caught: vaca caída,
  eutanasia, transporte, becerra/calostro), then the existing `<meta topic/>`
  taxonomy mapped via a fixed table, else `none`. No extra LLM call.
- Deliberate mapping call: **Ordeño/Higiene/Equipo/Reproducción → `none`** —
  milking-routine and milk-quality training is real training but not one of
  the FARM v5 animal-care CE areas; over-claiming would be worse in an
  evaluation than under-claiming. `Químicos y seguridad → safety_other`
  (shown in records, excluded from the five-area CE grouping).
- Sign-off stores `signed_off_name`/`signed_off_role` as text (plus the user
  FK with `ON DELETE SET NULL`) so the record survives staff turnover.
- `training_events.farm_topic` backfills to `none` (per spec) — historical
  rows are not retro-classified; the audit letter only claims what was
  classified at the time it happened.

### Task 5 — audit pack

- Letter language: "training records maintained to support your FARM Animal
  Care evaluation" + an explicit "does not constitute FARM program
  certification, enrollment, or evaluator approval" sentence; the old
  "supports FARM Program Workforce Development evaluation criteria" claim is
  gone. Tests pin all of this (including the absence of "Workforce
  Development").
- Per-employee CE detail gets its own page after the summary table: five
  fixed FARM areas per worker, with events/lessons/checks/Q&A counts and date
  ranges, and amber "No documented continuing education in: …" lines for the
  gaps — the owner sees holes before an evaluator does.
- Workers with no events in the window but with compliance records
  (signature/sign-off) still appear in the letter; consent/agreement/sign-off
  are point-in-time-of-export state, while events respect the date window.
- CSV keeps one row per event; the four compliance columns
  (consent/agreement/sign-off) repeat the worker-level state on each row —
  spreadsheet-filter-friendly beats normalized here.

### Task 6 — template health

- Detection keys off **error codes only** (never message strings):
  Twilio 63013/63016/63049 and Meta 131049/131050/132001/132015/132016,
  curated in `services/templateHealth.ts` with one comment per code. ErrorCode
  is persisted on the message row either way; only template-type failures with
  a policy code trip the pause.
- The pause is org-wide and **sticky until an owner acknowledges** (banner →
  RUNBOOK procedure). Drip deliveries stay `pending` during a pause and flow
  again after acknowledgement — nothing is lost, nothing silently retries.
- SMS fallback is exactly a seam: when paused and `SMS_FALLBACK_ENABLED`, the
  stub transport logs what WOULD be sent and the send still reports
  `templates_paused` — pretending a stub delivered would corrupt delivery
  accounting.
- Template categories live in code (`WHATSAPP_TEMPLATES`, `category:
  'utility'`) next to the exact bodies — they are what we submit to Meta, so
  they version with the copy, not with org data.

### Task 7 — POLICY-SCOPE.md

The scope test pins the similarity floor at the documented real-embeddings
default (0.25) via `RETRIEVAL_MIN_SIMILARITY` for one test: the keyless stub
floor (0.02) is deliberately forgiving and would "answer" open-domain
questions with an extract (bestSim ≈ 0.10 for "¿quién ganó el mundial?"),
which is a stub artifact, not product behavior. The test therefore exercises
the real enforcement mechanism at its production setting.

### Demo/seed

Seventh seed worker (Rosa, `pending`, enrolled) demos "awaiting opt-in" +
the live ALTA flow; Carlos is opted out; Pedro has a pending agreement so
ACEPTO can be tried in the simulator; María (signed long ago) shows the
11-month renewal flag; José's completed track is deliberately unconfirmed to
show the sign-off flag. The static demo mirrors consent/disclosure/ACEPTO
through the same pure modules (`consentKeywords.ts`, split from `consent.ts`
so the browser build never imports `pg`).

## Eval targets

- ≥85% grounded-correct / ≥90% correct-refusal / 0 fabricated citations, as
  specified. "Fabricated citation" is measured mechanically: a cited document
  title that does not exist in the org. The committed starter set pins the
  numeric facts (30 s pre-dip, 4 L colostrum, 22% Brix, 71–77 °C…) so prompt
  regressions surface as failed facts, not vibes.

## Reading level (3rd–5th grade)

Anabel and the IDA reviewer asked for a 3rd–5th-grade reading level for
low-literacy workers. The lever is the LLM-generated output, so the rule lives
in the prompts (`prompts/answer.es.md`, `prompts/modules.es.md`): 3.º–5.º grade,
~80–90 words, one idea per short sentence, everyday words, and any unavoidable
technical term explained in parentheses. The canned strings (`messages.es.ts`)
are already at this level by construction.

The static demo answers extractively — verbatim SOP excerpts with a citation,
no Claude — so its reading level is governed by the **SOP source text**, not by
this prompt. This guardrail primarily governs live (Claude) output. We did not
add a reading-level unit test: the eval harness pins facts/grounding, and a
brittle readability metric would fight the prompt rather than protect it.
