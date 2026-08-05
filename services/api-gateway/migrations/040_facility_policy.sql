-- Booking limits were hardcoded in routes/facilities.js. The BRD makes them
-- per-society settings, so they move onto the facility row with the previous
-- hardcoded values as defaults — every existing facility keeps behaving
-- exactly as it does today.
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS advance_days           INT NOT NULL DEFAULT 7;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS cancel_cutoff_minutes  INT NOT NULL DEFAULT 60;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS max_per_unit_per_day   INT NOT NULL DEFAULT 1;
