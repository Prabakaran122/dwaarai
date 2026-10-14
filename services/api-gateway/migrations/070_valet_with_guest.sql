-- A multi-day guest's car, out with the guest.
--
-- A handover that is not the final checkout used to set the ticket straight
-- back to 'parked_again'. The queue, the parking-slot count, "parked right
-- now" and the guest's own page ("Parked for 29 min") all then said the car
-- was on the lot while the guest was driving it, and nothing was checked when
-- it came back. 'with_guest' is that interval: open (the URL, card and claim
-- code keep working), holding no slot, and not requestable. A valet ends it by
-- checking the car back in with four fresh condition photos.

BEGIN;

ALTER TABLE valet_tickets DROP CONSTRAINT IF EXISTS valet_tickets_status_check;
ALTER TABLE valet_tickets ADD CONSTRAINT valet_tickets_status_check CHECK (status IN (
  'requested', 'accepted', 'parking_in_progress',
  'parked',
  'retrieval_requested', 'en_route', 'arrived',
  'parked_again', 'with_guest', 'final_closed', 'expired'
));

COMMIT;
