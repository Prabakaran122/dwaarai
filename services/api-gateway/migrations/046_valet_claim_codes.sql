-- A code the guest can carry away without holding anything.
--
-- Without a printed card, the only way into a ticket was scanning the QR off
-- the guard's screen at that exact moment. Photographing it barely helps — the
-- guest would need a second device to read the picture back — so a guest who
-- walked away had no route to their own vehicle. This is the cloakroom ticket
-- number: short enough to say out loud, write on a bill, or relay by phone.
--
-- Globally unique, unlike a card code, because the guest types it with no
-- venue context: /valet and a code is all they have.
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS claim_code VARCHAR(12);

-- Unique only among tickets that are still open. Codes are short, so they must
-- be recyclable — a venue running for years would otherwise exhaust the space
-- and start colliding. A closed ticket's code is free again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_claim_code_open
  ON valet_tickets(claim_code)
  WHERE claim_code IS NOT NULL
    AND status NOT IN ('final_closed', 'expired');

-- Resolving a typed code is the guest's hot path.
CREATE INDEX IF NOT EXISTS idx_valet_claim_code_lookup
  ON valet_tickets(claim_code) WHERE claim_code IS NOT NULL;
