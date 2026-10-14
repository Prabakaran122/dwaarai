-- The event POST /guard/tickets/:token/returned writes when a multi-day guest
-- brings the car back (see 070). 070 widened the ticket status check and not
-- this one, so every check-in 500'd at the audit insert -- after the status
-- had already moved, leaving a ticket parked with no record of how.

BEGIN;

ALTER TABLE valet_ticket_events
  DROP CONSTRAINT IF EXISTS valet_ticket_events_type_check;

ALTER TABLE valet_ticket_events
  ADD CONSTRAINT valet_ticket_events_type_check CHECK (event_type IN (
    'created', 'photo_captured', 'requested', 'accepted', 'arrived',
    'scan_success', 'scan_failed', 'closed_pickup', 'final_closed',
    'expired', 'discount_optin', 'condition_captured', 'disputed',
    'intake_started', 'accepted_for_parking', 'logged_at_desk',
    'whatsapp_bound', 'collection_overdue', 'request_unanswered',
    'returned_by_guest'
  ));

COMMIT;
