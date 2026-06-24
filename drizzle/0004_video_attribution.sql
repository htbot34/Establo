-- Required source credit for a module's video (the "proper acknowledgment" a
-- rights holder asks for when their video is reused). Carried end-to-end:
-- shown to the worker after the video line and kept on the training record.
-- Single nullable column, no default — applies cleanly on top of existing rows
-- (every current module simply has no attribution). No destructive changes.

ALTER TABLE modules ADD COLUMN IF NOT EXISTS video_attribution text;
