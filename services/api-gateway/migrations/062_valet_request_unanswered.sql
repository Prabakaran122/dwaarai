-- A request no attendant ever accepted.
--
-- The counterpart to collection_overdue. That one fires when a guest does not
-- come for an arrived car; this one fires when nobody set off to fetch it.
--
-- It exists because the device can be the failing part: a guest's request goes
-- from their phone to this server and never touches the attendant's handset,
-- which learns about it by polling. An app with no signal polls nothing, so
-- the request lands, the guest is told a valet is coming, and nobody moves.
--
-- Added to the CHECK rather than assumed: migration 059 exists because five
-- event types were written by code the constraint rejected, and every one of
-- those failures looked like an unrelated 500 at the stand.

ALTER TABLE valet_ticket_events
  DROP CONSTRAINT IF EXISTS valet_ticket_events_type_check;

ALTER TABLE valet_ticket_events
  ADD CONSTRAINT valet_ticket_events_type_check CHECK (event_type IN (
    'created', 'photo_captured', 'requested', 'accepted', 'arrived',
    'scan_success', 'scan_failed', 'closed_pickup', 'final_closed',
    'expired', 'discount_optin', 'condition_captured', 'disputed',
    'intake_started', 'accepted_for_parking', 'logged_at_desk',
    'whatsapp_bound', 'collection_overdue', 'request_unanswered'
  ));
