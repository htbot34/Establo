-- Phone uniqueness becomes org-scoped: workers move between co-op-affiliated
-- dairies, and consultants demo with one phone across multiple org accounts,
-- so the same number may legitimately exist in two orgs. Within one org a
-- duplicate is still a data-entry mistake, so the composite unique index
-- keeps that guarantee. Lands before the worker-deletion feature (0006) so
-- the deletion tombstone is built against the final constraint shape.

DROP INDEX IF EXISTS workers_phone_uq;
CREATE UNIQUE INDEX IF NOT EXISTS workers_phone_org_uq ON workers (org_id, phone_e164);
