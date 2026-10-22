-- Recovering intakes that never finished, and desk-logged arrivals.
--
-- 1. Two new audit events.
--    'intake_cancelled' -- POST /guard/tickets/:token/cancel-intake, a valet
--      closing a job that was started (card scanned, or desk job accepted) and
--      never completed. Without it, an app that died mid-intake left a ticket
--      in parking_in_progress forever, and the card answered card_in_use to
--      every guest after.
--    'intake_abandoned' -- the sweep doing the same once nobody has touched
--      such a ticket for VALET_STALE_INTAKE_HOURS.
--    Same full-list pattern as 071: an event type the code writes and the
--    CHECK does not list is a 500 at the audit insert, after the status has
--    already moved.
--
-- 2. created_by_guard_id becomes nullable. POST /admin/tickets/request (the
--    desk logging an arrival) wrote the admin's own id here, but the column
--    references residents(id) and admins are not residents, so every desk log
--    500'd on the foreign key. Nobody has driven the car yet at that point;
--    NULL is the truth, and the admin is recorded on the 'logged_at_desk'
--    event instead. An attendant accepting the job fills it in.
--
-- 3. valet_tickets_complete_once_parked (056) also lets 'expired' through with
--    no plate. It demanded the car's details for every status but the three
--    intake ones, so an intake closed before anyone typed a plate -- exactly
--    what cancel-intake and the stale-intake sweep do -- failed the CHECK and
--    could never be closed at all. Loosening it costs nothing: a ticket that
--    was ever parked already carries its details, and nothing clears them.
--
-- No BEGIN/COMMIT: the migration runner wraps each file in its own transaction.

ALTER TABLE valet_ticket_events
  DROP CONSTRAINT IF EXISTS valet_ticket_events_type_check;

ALTER TABLE valet_ticket_events
  ADD CONSTRAINT valet_ticket_events_type_check CHECK (event_type IN (
    'created', 'photo_captured', 'requested', 'accepted', 'arrived',
    'scan_success', 'scan_failed', 'closed_pickup', 'final_closed',
    'expired', 'discount_optin', 'condition_captured', 'disputed',
    'intake_started', 'accepted_for_parking', 'logged_at_desk',
    'whatsapp_bound', 'collection_overdue', 'request_unanswered',
    'returned_by_guest', 'intake_cancelled', 'intake_abandoned'
  ));

ALTER TABLE valet_tickets
  ALTER COLUMN created_by_guard_id DROP NOT NULL;

ALTER TABLE valet_tickets
  DROP CONSTRAINT IF EXISTS valet_tickets_complete_once_parked;
ALTER TABLE valet_tickets
  ADD CONSTRAINT valet_tickets_complete_once_parked CHECK (
    status IN ('requested', 'accepted', 'parking_in_progress', 'expired')
    OR (plate IS NOT NULL AND plate_normalized IS NOT NULL
        AND vehicle_make IS NOT NULL AND stay_end_at IS NOT NULL)
  );
