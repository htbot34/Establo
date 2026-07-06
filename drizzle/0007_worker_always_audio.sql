-- Per-worker "always send audio" toggle: attach a TTS voice note to Q&A
-- answers and comprehension-check feedback even when the worker wrote text
-- (low-literacy workers often type short questions but need to LISTEN to the
-- answer). Module deliveries already always carry audio, so they are not
-- gated by this. Additive with a default, so every existing worker keeps
-- today's behavior (voice reply only for voice notes) until a manager flips
-- the toggle on the worker detail page.

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS always_audio boolean NOT NULL DEFAULT false;
