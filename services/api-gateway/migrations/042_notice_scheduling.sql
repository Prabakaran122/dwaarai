-- Scheduled announcements (F-24) and per-post reply control (F-25).
--
-- scheduled_at NULL means "already published", which is what every existing
-- row is, so no backfill is needed and the resident-facing filter stays a
-- simple "NULL OR in the past".
ALTER TABLE notices ADD COLUMN IF NOT EXISTS scheduled_at    TIMESTAMPTZ;

-- Defaults TRUE so today's behaviour -- replies always allowed -- is preserved
-- for every existing notice and for any client that never sends the field.
ALTER TABLE notices ADD COLUMN IF NOT EXISTS replies_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Partial: only pending rows are ever swept, and they are a tiny minority.
CREATE INDEX IF NOT EXISTS idx_notices_scheduled
  ON notices(scheduled_at) WHERE scheduled_at IS NOT NULL;
