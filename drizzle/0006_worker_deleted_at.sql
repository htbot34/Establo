-- Worker data deletion (BORRAR MIS DATOS): deleted_at marks an irreversibly
-- redacted worker record (name/phone tombstoned, message + training-event
-- text nulled); deletion_requested_at holds the pending-confirmation state
-- (same pattern as the pending cow-care-agreement columns). deletion_log
-- records only THAT a deletion happened — timestamp + org, deliberately
-- nothing identifying — so the dashboard can explain a drop in training
-- counts without letting a manager work out which worker asked.

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

CREATE TABLE IF NOT EXISTS deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deletion_log_org_idx ON deletion_log (org_id, created_at);
