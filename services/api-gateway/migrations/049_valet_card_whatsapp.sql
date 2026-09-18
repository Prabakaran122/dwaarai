-- A card that can start a WhatsApp conversation before it has a car.
--
-- The guard scans the card to *initiate* intake, then shows the same card to
-- the guest. Intake is not finished at that moment -- plate, make and the
-- four condition photos still have to happen -- so the guest very often
-- messages us before any ticket exists for that card.

-- The reference the guest carries into WhatsApp.
--
-- Not the card's printed code: that is UNIQUE (community_id, code), so four
-- properties can each own an "A047" and will, because every box of cards
-- starts at A001. A WhatsApp message carries no venue context at all, so the
-- reference in it has to stand on its own. Minted per card at registration,
-- from the same confusable-free alphabet as claim codes.
ALTER TABLE valet_cards ADD COLUMN IF NOT EXISTS wa_ref VARCHAR(12);

CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_card_wa_ref
  ON valet_cards(wa_ref) WHERE wa_ref IS NOT NULL;

-- Where a guest's number waits when they were faster than the guard.
--
-- Held on the card rather than the ticket precisely because the ticket does
-- not exist yet. When intake completes and binds this card, the number moves
-- onto the ticket and the welcome message goes out then -- so a guest who
-- scanned early gets "your car is with us" at the moment it becomes true,
-- instead of silence.
ALTER TABLE valet_cards ADD COLUMN IF NOT EXISTS pending_wa_phone VARCHAR(20);
ALTER TABLE valet_cards ADD COLUMN IF NOT EXISTS pending_wa_at    TIMESTAMPTZ;
