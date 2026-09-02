-- Plate search matches anywhere in the plate, not just the start.
--
-- 044 indexed plate_normalized with varchar_pattern_ops, which only serves
-- LIKE 'KA03%'. That was the wrong shape for how the search is actually used:
-- a guest at the desk says "it's the white Swift, 0435" far more often than
-- they recite the state code, and the valet app's own client-side filter on
-- the loaded queue already matched anywhere. The two disagreed — typing 0435
-- narrowed the visible queue but the server-side search that covers closed
-- tickets returned nothing.
--
-- A leading wildcard cannot use a b-tree prefix index at all, so that index is
-- replaced rather than supplemented. pg_trgm is already enabled (001_core) and
-- its GIN index does serve LIKE '%0435%'.
CREATE INDEX IF NOT EXISTS idx_valet_tickets_plate_trgm
  ON valet_tickets USING GIN (plate_normalized gin_trgm_ops);

DROP INDEX IF EXISTS idx_valet_tickets_plate_prefix;
