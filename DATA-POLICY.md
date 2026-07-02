# Establo Data Policy

Establo is a WhatsApp-based training assistant for dairy operations, built by
Irrigant. Its users are dairy workers — a workforce that is overwhelmingly
foreign-born — and its core product is an employer-visible record of training
activity. That combination imposes obligations this document spells out in
plain English. Every commitment here corresponds to shipped, tested code; the
pointers name the enforcing mechanism.

## 1. What we collect — and what we never collect

**Collected, per worker:**

- Name, phone number, job role, hire date, and any notes a manager adds.
- WhatsApp messages with the assistant: text, and the text transcripts of
  voice notes (voice audio is transcribed; the raw audio file is stored
  temporarily and expires per section 2).
- Training events: which lessons were delivered, comprehension-check results,
  what topics were asked about, timestamps.

**Never collected or inferred:**

- Photos of people, biometrics, or location data. (Workers can't send photos
  to the assistant at all; photo upload exists only for managers digitizing
  paper SOPs.)
- Immigration status, work authorization, or anything adjacent. This is
  enforced in code, not just policy: a deterministic guard
  (`src/server/services/guards.ts`) refuses immigration, legal, wage, and
  veterinary-dosing questions before any AI model sees them, and for
  immigration and legal topics the worker's exact words are **never stored in
  any employer-visible record** — only a category marker ("Tema restringido:
  migración") reaches the escalation log and exports
  (`src/server/services/inbound.ts`).

## 2. Retention

| Data | Kept for | Mechanism |
| --- | --- | --- |
| Raw message bodies, voice transcripts, stored audio files, and the question/answer text on training events | **180 days** (`RAW_CONTENT_RETENTION_DAYS`, configurable) | Nightly prune job nulls the content and deletes audio files from disk (`src/server/services/retention.ts`) |
| Inbound webhook logs (raw delivery payloads) | 30 days | Nightly prune job (`prune-webhook-logs`) |
| Derived training events: topic, FARM area, check result, timestamps | Retained | This is the farm's training documentation — the product's purpose |
| Consent records (ALTA/BAJA), cow-care-agreement signatures, supervisor sign-offs | Retained | Compliance records of the farm |

The short raw-content window is deliberate: **data no longer held cannot be
produced to anyone** — see section 4.

## 3. Worker rights

Any worker can permanently delete their data, at any time, by messaging
**BORRAR MIS DATOS** to the assistant and confirming with **SI BORRAR**. No
manager approval is required or requested, and the right is honored even
mid-pilot. What happens (`src/server/services/workerDeletion.ts`):

- Their name and phone number are irreversibly replaced with a tombstone.
- Every message body, voice transcript, and audio file is erased.
- The verbatim text of anything they ever asked is erased everywhere,
  including escalation records.
- What remains: non-identifying training-event stubs (topic, check result,
  timestamp) and an anonymous "a deletion happened on this date" notice. The
  dashboard notice deliberately does not say — and the database does not
  record — which worker asked.
- They are excluded from all future exports and messages.

Workers also control message consent directly (BAJA stops everything, ALTA
re-joins; a manager cannot override a worker's BAJA), and receive a
plain-Spanish disclosure of all of this on first contact.

## 4. Legal requests

Irrigant does not voluntarily disclose worker data to any third party,
including government agencies. Our posture:

- Data is produced only in response to valid, compulsory legal process (e.g.
  a court order or enforceable subpoena).
- We notify the affected farm unless legally barred from doing so.
- We produce only the minimum data responsive to the demand.
- The 180-day raw-content retention limit (section 2) is a deliberate
  consequence of this posture: message content past its retention window has
  been destroyed and cannot be produced, by us or by anyone who compels us.

## 5. Subprocessors

| Provider | Used for | Notes |
| --- | --- | --- |
| Anthropic | Answer generation, OCR of photographed SOPs | API traffic is not used for model training under Anthropic's commercial API terms |
| OpenAI | Embeddings, Whisper voice transcription, TTS voice replies | API traffic is not used for model training under OpenAI's API terms |
| Twilio | WhatsApp message delivery | Per the WhatsApp Business Solution Terms, Business Solution Data is never used to train or improve any AI model |

As a standing commitment of our own: Establo's evaluation sets are generated
from seeded/sample SOPs only — never from real worker conversations (see
POLICY-SCOPE.md, "Operating commitments").

## Worker-facing summary

A plain-Spanish summary of this policy, at the same reading level as the
in-chat disclosure, lives in [`POLITICA-DE-DATOS.es.md`](POLITICA-DE-DATOS.es.md).
Workers can also ask their supervisor for "la política de datos" — the
supervisor should hand them that document.
