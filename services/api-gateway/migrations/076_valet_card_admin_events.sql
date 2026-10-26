-- Two things a manager can now do to a card from the cards page, recorded on
-- the ticket's audit trail like everything else that happens to it:
--
--   card_returned  "Mark as returned": the card is back at the stand while its
--                  car is still with us -- picked up at the door, or never
--                  collected at handover. The ticket keeps running on its
--                  claim code and WhatsApp; only the card is freed.
--   ticket_resent  "Resend ticket to guest": the WhatsApp ticket sent again.
--
-- The list must keep every type 073 allowed.
ALTER TABLE valet_ticket_events
  DROP CONSTRAINT IF EXISTS valet_ticket_events_type_check;

ALTER TABLE valet_ticket_events
  ADD CONSTRAINT valet_ticket_events_type_check CHECK (event_type IN (
    'created', 'photo_captured', 'requested', 'accepted', 'arrived',
    'scan_success', 'scan_failed', 'closed_pickup', 'final_closed',
    'expired', 'discount_optin', 'condition_captured', 'disputed',
    'intake_started', 'accepted_for_parking', 'logged_at_desk',
    'whatsapp_bound', 'collection_overdue', 'request_unanswered',
    'returned_by_guest', 'intake_cancelled', 'intake_abandoned',
    'card_returned', 'ticket_resent'
  ));
