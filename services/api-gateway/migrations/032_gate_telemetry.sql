-- Persist the edge telemetry the heartbeat already sends.
--
-- POST /heartbeat has always carried `queue_depth` (how many events the edge
-- has buffered while offline) and, since the C3 push work, a `panel` object
-- with door/relay/alarm state. Both were broadcast over the websocket and then
-- thrown away, so a dashboard could only ever show them to someone who happened
-- to be watching at the moment the beat arrived — nothing survived a page load.
--
-- Offline resilience is the edge-first architecture's main advantage over the
-- cloud-only competition, and it was the one thing the product could not show.

ALTER TABLE gates ADD COLUMN IF NOT EXISTS queue_depth   INT;
ALTER TABLE gates ADD COLUMN IF NOT EXISTS uptime_s      BIGINT;
ALTER TABLE gates ADD COLUMN IF NOT EXISTS panel         JSONB;
ALTER TABLE gates ADD COLUMN IF NOT EXISTS telemetry_at  TIMESTAMPTZ;
