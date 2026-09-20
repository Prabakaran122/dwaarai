-- The selfie an attendant takes when a shift begins.
--
-- The BRD asks for face verification at this point and its reference build
-- treats any captured photo as verified. We store the photo and record that
-- no recognition ran, because an audit trail claiming a check happened is
-- worse than one admitting it did not. Wiring a real service later changes
-- the response, not this schema.
ALTER TABLE residents ADD COLUMN IF NOT EXISTS shift_photo_key  TEXT;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS shift_started_at TIMESTAMPTZ;
