-- Physical valet cards.
--
-- A venue prints a fixed box of cards once (A001..A100). Each carries a QR
-- encoding /valet/c/<code>. At intake the guard scans the card, which binds it
-- to that ticket; when the ticket closes the card is free again for tomorrow's
-- guest. The card is the durable artefact — it survives a flat battery, a
-- closed tab, and being handed to whoever actually collects the car, none of
-- which the screen-QR flow survives.
--
-- The screen QR is NOT replaced. A venue with no card stock still works
-- exactly as before, and a bound card is simply a second way into the same
-- ticket. Both resolve to the same session_token.

CREATE TABLE IF NOT EXISTS valet_cards (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id  UUID NOT NULL REFERENCES communities(id),

  -- Printed on the card and encoded in its QR. Short and human-readable so a
  -- guest can read it out over the phone and a guard can type it if the
  -- camera will not focus.
  code          VARCHAR(20) NOT NULL,

  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Codes are unique per venue, not globally: two properties can both own a
  -- card "A001" without coordinating, which they will.
  UNIQUE (community_id, code)
);

CREATE INDEX IF NOT EXISTS idx_valet_cards_lookup ON valet_cards(community_id, code);

-- The binding itself lives on the ticket rather than on the card, because a
-- card outlives many tickets and a ticket has at most one card. Nullable
-- throughout: screen-QR tickets never get one.
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS card_id UUID REFERENCES valet_cards(id);
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS card_code VARCHAR(20);

-- Finding the ticket a card currently belongs to is the hot path — it happens
-- every time a guest scans their card — so index it.
CREATE INDEX IF NOT EXISTS idx_valet_tickets_card ON valet_tickets(card_id)
  WHERE card_id IS NOT NULL;

-- A card can be on at most ONE open ticket at a time. This is the constraint
-- that makes reuse safe: without it, handing out a card whose previous stay
-- was never closed would silently point two guests at different tickets, and
-- the second scan would show the first guest's car.
--
-- Partial, so a card is freed the moment its ticket reaches a closed state
-- rather than needing an explicit release step that someone will forget.
CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_card_one_open_ticket
  ON valet_tickets(card_id)
  WHERE card_id IS NOT NULL
    AND status NOT IN ('final_closed', 'expired');

-- Plate search from the valet app. The queue is filtered client-side, but
-- searching beyond the open queue hits the database, and a busy venue's
-- history is large enough that a sequential scan on every keystroke is not
-- acceptable.
CREATE INDEX IF NOT EXISTS idx_valet_tickets_plate_prefix
  ON valet_tickets(community_id, plate_normalized varchar_pattern_ops);
