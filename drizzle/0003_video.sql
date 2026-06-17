-- Optional per-module video: a LINK Establo sends to the worker (it unfurls in
-- WhatsApp) and embeds as a preview in the dashboard. Establo never hosts,
-- uploads, downloads, or clips video — link only. All columns nullable with no
-- default, so this applies cleanly on top of existing rows (every current
-- module simply has no video). No destructive changes.

ALTER TABLE modules
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS video_title_es text,
  ADD COLUMN IF NOT EXISTS video_provider text,
  ADD COLUMN IF NOT EXISTS video_langs jsonb;
