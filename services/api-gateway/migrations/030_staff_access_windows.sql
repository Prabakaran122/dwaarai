-- Staff RFID cards gain an optional DAILY access window (e.g. a maid allowed
-- 09:00–18:00) plus a holder name. The edge pushes these to the C3 as a time
-- zone + a windowed card, so out-of-hours taps are denied locally on the panel.
ALTER TABLE rfid_cards ADD COLUMN IF NOT EXISTS holder_name  VARCHAR(200);
ALTER TABLE rfid_cards ADD COLUMN IF NOT EXISTS access_start TIME;   -- daily allow-from
ALTER TABLE rfid_cards ADD COLUMN IF NOT EXISTS access_end   TIME;   -- daily allow-until
