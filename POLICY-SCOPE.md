# POLICY-SCOPE.md — Establo is a purpose-restricted business assistant

This document records, with pointers to the enforcing code, why Establo is
**not a general-purpose AI chatbot** under the WhatsApp Business Solution
Terms (provisions restricting general-purpose AI chatbots on the platform,
effective January 15, 2026). It exists so that scope can be demonstrated to
Meta, a BSP (Twilio), or a customer's counsel without reading the whole
codebase.

## What Establo is

A purpose-restricted **business-function assistant** for a specific dairy
operation: employer-provided workforce training and the compliance
documentation of that training (FARM Animal Care v5 continuing-education
records). Every conversation happens between an employer's enrolled worker
and that employer's own procedures.

## The four scope restrictions, and where each is enforced

### 1. Grounded ONLY in the org's own SOPs — never open-domain

Establo answers from retrieved chunks of the employer's uploaded documents,
or it refuses. It does not answer from model knowledge.

- `prompts/answer.es.md` — the versioned grounding contract: "Responde SOLO
  con lo que dicen los fragmentos. No uses conocimiento general. No adivines
  NUNCA," plus the instruction to emit `confidence="not_found"` when the
  fragments don't contain the answer.
- `src/server/services/answer.ts` — `answerQuestion()`: org-scoped retrieval
  (`retrieveChunks` filters by `org_id`), then the **similarity floor**
  (`retrievalMinSimilarity()`, default 0.25 with real embeddings,
  `RETRIEVAL_MIN_SIMILARITY` to override): questions whose best match falls
  below the floor are refused *before any LLM call*. Refusals never carry a
  citation; grounded answers always do (`ensureCitation`).
- `src/server/services/retrieval.ts` — every query is `WHERE org_id = …`;
  cross-tenant reads are covered by integration tests.

### 2. Hard refusal of salary / legal / immigration / vet-dosing topics

- `src/server/services/guards.ts` — `matchForbiddenTopic()`: a deterministic,
  pre-LLM keyword guard that fires in **every mode including keyless mock**.
  Matches return a warm Spanish refusal (`ES.forbidden`) and never reach
  retrieval or the model.
- `prompts/answer.es.md` — the same prohibition is restated to the model as a
  maximum-priority rule (defense in depth).
- `src/server/services/inbound.ts` — forbidden matches create an escalation
  row (`Tema restringido…`) so a human follows up.

### 3. Escalation to a human instead of improvising

- `src/server/services/inbound.ts` — `not_found` answers and forbidden topics
  insert into `escalations` and notify the worker that their supervisor was
  told; explicit help requests (`router.ts` `help` route) escalate directly.
- The dashboard surfaces open escalations on the Overview page; they are part
  of the manager's daily loop (see `RUNBOOK.md`).

### 4. Closed user group, not a public bot

- Only phone numbers a manager registered AND that opted in are served:
  unknown numbers get one "not registered" notice per day and are ignored
  (`inbound.ts` unknown-number path); workers control opt-in/opt-out with
  ALTA/BAJA (`src/server/services/consent.ts`, gate in
  `src/server/services/sendToWorker.ts`).
- First contact carries a disclosure that this is the employer's training
  assistant, that conversations are logged for the employer, and how to stop
  messages (`ES.disclosure` in `src/server/services/messages.es.ts`).

## The test that pins open-domain refusal

`tests/integration/compliance.test.ts` ("scope: refuses open-domain
questions") asserts that a clearly open-domain question — *"¿quién ganó el
mundial?"* — is refused via the similarity floor rather than answered from
model knowledge, and that the refusal carries no citation. The eval harness
(`pnpm eval`) additionally tracks correct-refusal rate (target ≥ 90%) on the
unanswerable set, including out-of-scope questions.

## Operating commitments

- New capabilities must stay within the training/compliance function; any
  feature that would answer from outside the org's documents requires a
  revision of this document first.
- `prompts/answer.es.md` is treated as a versioned contract: every edit
  requires re-running `pnpm eval` (see `RUNBOOK.md`).
