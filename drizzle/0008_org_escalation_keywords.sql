-- Org-configurable forced-escalation keywords: a manager lists farm-specific
-- words (a chemical name, a machine, a sensitive topic) and any question
-- containing one — accent-stripped, case-insensitive, whole-word — always
-- creates an escalation, WITHOUT blocking the grounded answer (the
-- supervisor wants visibility, not a gag; same coexistence pattern as the
-- not_found escalations next to their qa_interaction log). Additive with an
-- empty default, so existing orgs are unaffected until they configure a list
-- in Settings.

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS escalation_keywords jsonb NOT NULL DEFAULT '[]'::jsonb;
