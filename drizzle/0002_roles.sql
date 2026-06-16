-- Role-scoped onboarding: a worker's job role + per-module role targeting.
-- Both columns are nullable with no default, so this applies cleanly on top of
-- existing rows: every current worker stays unassigned (universal-only) and
-- every current module stays universal (applies_to_roles IS NULL) until a
-- manager sets them. No destructive changes.

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS job_role text;

ALTER TABLE modules
  ADD COLUMN IF NOT EXISTS applies_to_roles jsonb;
