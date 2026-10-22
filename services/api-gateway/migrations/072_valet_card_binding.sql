-- Printed cards bind to the first phone that opens them, and a ticket issues
-- at most one discount code.
--
-- Card codes are sequential (A001, A002, ...) and printed, so they cannot be
-- made secret after the fact. GET /guest/cards/:community/:code used to hand
-- the open ticket's session token to anyone who typed a neighbouring code --
-- which is the whole credential for a guest's car, including asking for it to
-- be brought round. The first device to scan a card while a ticket is on it
-- now owns that ticket's link; any other device is told the card is open
-- elsewhere and pointed at the claim code instead.
--
-- On the ticket rather than the card, deliberately: the card is reused by the
-- next guest, and a binding that outlived the stay would lock them out of
-- their own car. A new ticket starts unbound.
--
-- Only a hash of the device id is stored. The raw id is a bearer value the
-- browser keeps, and a database read should not be enough to impersonate it.
--
-- No BEGIN/COMMIT: the runner wraps each file in its own transaction.

ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS card_device_hash TEXT NULL;
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS card_bound_at TIMESTAMPTZ NULL;

-- One discount code per ticket. The opt-in route already reuses an existing
-- code, but two taps racing each other both see "none yet" -- the index is
-- what makes the second insert fail rather than mint a second code.
--
-- Any duplicates already issued keep their row (it is the consent record for
-- that phone number) and only lose the ticket link, earliest one kept. Without
-- this the index could not be built on a database that has them, and the
-- deploy would stop here.
UPDATE valet_discount_optins d
   SET ticket_id = NULL
 WHERE d.ticket_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM valet_discount_optins e
      WHERE e.ticket_id = d.ticket_id
        AND (e.issued_at, e.id) < (d.issued_at, d.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_discount_one_per_ticket
  ON valet_discount_optins (ticket_id)
  WHERE ticket_id IS NOT NULL;
