-- Consent for texting a guest their claim code.
--
-- valet_tickets.phone_number has existed since 043, reserved and unwritten.
-- What was missing is the reason we are allowed to hold it: under DPDP a
-- number taken to deliver a ticket is a different collection purpose from the
-- guest photo, from the discount opt-in, and from the guard's own badge. The
-- valet module keeps those timestamps separate on purpose and this is the
-- fourth -- merging it into any of the others would misrepresent what the
-- guest agreed to.
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS phone_consent_at TIMESTAMPTZ;

-- The number is deleted when the ticket closes: the purpose is delivering one
-- code for one stay, and it is fulfilled the moment the car leaves. This index
-- is what lets the retention sweep find the stragglers cheaply.
CREATE INDEX IF NOT EXISTS idx_valet_phone_to_forget
  ON valet_tickets(closed_at)
  WHERE phone_number IS NOT NULL;
