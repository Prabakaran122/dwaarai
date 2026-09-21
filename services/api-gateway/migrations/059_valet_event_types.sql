-- The event types the code actually writes.
--
-- 043 fixed this list when the lifecycle was shorter. Five event types have
-- been added to the service since and none of them were added here, so every
-- flow that logged one hit the CHECK constraint and answered 500:
--
--   intake_started        -- the guard scans a card to begin intake
--   accepted_for_parking  -- an attendant takes a car logged at the desk
--   logged_at_desk        -- the desk records a car before a valet reaches it
--   whatsapp_bound        -- a guest's first WhatsApp message binds their number
--   collection_overdue    -- the sweep flags a car nobody has come back for
--
-- whatsapp_bound is the one that hurt most: it sits in the webhook's
-- first-bind path, so a guest messaging the venue for the first time got a
-- 500 and never heard back, while the card scan that starts intake failed
-- outright. Both are the ordinary way this product is used.
--
-- Dropped and recreated rather than altered: Postgres has no syntax for
-- adding a value to a CHECK, and the table is small enough that revalidating
-- it costs nothing.

ALTER TABLE valet_ticket_events
  DROP CONSTRAINT IF EXISTS valet_ticket_events_type_check;

ALTER TABLE valet_ticket_events
  ADD CONSTRAINT valet_ticket_events_type_check CHECK (event_type IN (
    -- 043, unchanged
    'created', 'photo_captured', 'requested', 'accepted', 'arrived',
    'scan_success', 'scan_failed', 'closed_pickup', 'final_closed',
    'expired', 'discount_optin', 'condition_captured', 'disputed',
    -- added since, and written by the service all along
    'intake_started', 'accepted_for_parking', 'logged_at_desk',
    'whatsapp_bound', 'collection_overdue'
  ));
