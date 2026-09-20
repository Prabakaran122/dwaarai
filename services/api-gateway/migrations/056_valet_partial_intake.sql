-- A ticket that exists before its details do.
--
-- plate, vehicle_make and stay_end_at were NOT NULL because a ticket could
-- only ever be born finished. A job that starts when the guard scans the card
-- has none of them yet -- they are what the next ninety seconds are for.
--
-- The alternative was placeholders, and a ticket carrying plate 'PENDING' is a
-- row that lies to every report that reads it.

BEGIN;

ALTER TABLE valet_tickets ALTER COLUMN plate            DROP NOT NULL;
ALTER TABLE valet_tickets ALTER COLUMN plate_normalized DROP NOT NULL;
ALTER TABLE valet_tickets ALTER COLUMN vehicle_make     DROP NOT NULL;
ALTER TABLE valet_tickets ALTER COLUMN stay_end_at      DROP NOT NULL;

-- Relaxed for the intake states only. Past parked, the details are mandatory
-- again -- enforced here rather than in a route, because a half-finished
-- ticket claiming to be parked is the one state that must be impossible
-- regardless of which code path put it there.
ALTER TABLE valet_tickets
  DROP CONSTRAINT IF EXISTS valet_tickets_complete_once_parked;
ALTER TABLE valet_tickets
  ADD CONSTRAINT valet_tickets_complete_once_parked CHECK (
    status IN ('requested', 'accepted', 'parking_in_progress')
    OR (plate IS NOT NULL AND plate_normalized IS NOT NULL
        AND vehicle_make IS NOT NULL AND stay_end_at IS NOT NULL)
  );

COMMIT;
