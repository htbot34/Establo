-- Compliance hardening: worker consent, first-contact disclosure, cow care
-- agreements, FARM topic taxonomy, supervisor sign-off, template-failure pause.

-- ── Worker opt-in / opt-out + disclosure + pending agreement state ───────────
ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS consent_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_method text,
  ADD COLUMN IF NOT EXISTS consent_attested_by text,
  ADD COLUMN IF NOT EXISTS disclosure_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_agreement_id uuid,
  ADD COLUMN IF NOT EXISTS pending_agreement_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_agreement_nudges integer NOT NULL DEFAULT 0;

-- Backfill: a worker who has already messaged the number chose to start the
-- conversation themselves — that inbound message is the opt-in signal, so
-- mark them opted_in with method 'imported'. Workers who never wrote stay
-- 'pending' and receive nothing business-initiated until they opt in.
UPDATE workers
SET consent_status = 'opted_in',
    consented_at = last_inbound_at,
    consent_method = 'imported'
WHERE last_inbound_at IS NOT NULL AND consent_status = 'pending';

CREATE INDEX IF NOT EXISTS workers_consent_idx ON workers (org_id, consent_status);

-- ── FARM Animal Care v5 topic taxonomy ───────────────────────────────────────
-- stockmanship_general | preweaned_calf | non_ambulatory | euthanasia |
-- fitness_to_transport | safety_other | none
ALTER TABLE modules
  ADD COLUMN IF NOT EXISTS farm_topic text NOT NULL DEFAULT 'none';
ALTER TABLE training_events
  ADD COLUMN IF NOT EXISTS farm_topic text NOT NULL DEFAULT 'none';
-- Existing rows backfill to 'none' via the column default; make it explicit
-- for any row inserted between ALTER and app deploy.
UPDATE training_events SET farm_topic = 'none' WHERE farm_topic IS NULL;
UPDATE modules SET farm_topic = 'none' WHERE farm_topic IS NULL;
CREATE INDEX IF NOT EXISTS training_events_farm_topic_idx
  ON training_events (org_id, farm_topic, occurred_at);

-- ── Supervisor sign-off on completed onboarding tracks ───────────────────────
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS signed_off_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_off_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signed_off_name text,
  ADD COLUMN IF NOT EXISTS signed_off_role text;

-- ── Cow care agreements (versioned per org) + per-worker signatures ─────────
CREATE TABLE IF NOT EXISTS agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'cow_care',
  version integer NOT NULL DEFAULT 1,
  text_es text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agreements_org_type_version_uq
  ON agreements (org_id, type, version);
CREATE INDEX IF NOT EXISTS agreements_org_idx ON agreements (org_id);

CREATE TABLE IF NOT EXISTS agreement_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  agreement_version integer NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL,
  attested_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agreement_signatures_org_idx ON agreement_signatures (org_id);
CREATE INDEX IF NOT EXISTS agreement_signatures_worker_idx
  ON agreement_signatures (worker_id, signed_at);

ALTER TABLE workers
  ADD CONSTRAINT workers_pending_agreement_fk
  FOREIGN KEY (pending_agreement_id) REFERENCES agreements(id) ON DELETE SET NULL;

-- ── Template delivery health: persist error codes, org-wide pause ────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS template_sends_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS template_pause_reason text;
