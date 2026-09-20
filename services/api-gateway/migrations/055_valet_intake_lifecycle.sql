-- The front half of the job lifecycle.
--
-- Until now a valet ticket sprang into existence already parked: the guard
-- filled in plate, make, slot and four photos, submitted, and only then did a
-- record exist. Everything before that moment was invisible to the system.
--
-- That gap had a cost we were already paying. The guard scans a card to
-- *start* intake and hands it straight to the guest, who scans it and messages
-- us -- usually before the ticket exists. We solved that by parking the
-- guest's number on the card (049) and claiming it later. With a job that
-- exists from the scan, the race simply does not happen.
--
--   requested            a job exists, no attendant yet
--   accepted             an attendant has taken it
--   parking_in_progress  intake underway: plate, slot, photos
--   parked               done
--
-- One rename is unavoidable. Our 'requested' means the guest wants their car
-- *back*; the BRD's means a job is waiting to be parked. Two opposite meanings
-- cannot share a name inside a status constraint, so ours becomes
-- 'retrieval_requested' -- which is also what it always should have been,
-- since 'requested' never said what was requested.
--
-- en_route and final_closed stay as they are. They map to the BRD's
-- assigned_for_delivery and delivered, they are unambiguous, and renaming them
-- would buy risk and no clarity.

BEGIN;

ALTER TABLE valet_tickets DROP CONSTRAINT IF EXISTS valet_tickets_status_check;

-- Existing rows move first, inside the same transaction as the constraint, so
-- there is never an instant where a live ticket violates it.
UPDATE valet_tickets SET status = 'retrieval_requested' WHERE status = 'requested';

ALTER TABLE valet_tickets ADD CONSTRAINT valet_tickets_status_check CHECK (status IN (
  'requested', 'accepted', 'parking_in_progress',
  'parked',
  'retrieval_requested', 'en_route', 'arrived',
  'parked_again', 'final_closed', 'expired'
));

-- The queue reads these constantly and they are now three values, not one.
CREATE INDEX IF NOT EXISTS idx_valet_tickets_intake
  ON valet_tickets(community_id, status)
  WHERE status IN ('requested', 'accepted', 'parking_in_progress');

COMMIT;
