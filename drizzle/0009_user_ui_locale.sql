-- Per-user dashboard display language (EN/ES toggle in the manager UI).
-- Additive with an 'en' default, so every existing manager keeps today's
-- English dashboard until they flip the switch. This is a MANAGER preference
-- only: worker-facing WhatsApp content is governed by orgs.locale, and the
-- audit pack / transcript / certificate PDFs stay English for FARM evaluators
-- regardless of this setting.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ui_locale text NOT NULL DEFAULT 'en';
