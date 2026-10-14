-- A shift as a thing that happened, rather than a column on a person.
--
-- Today the only trace of a shift is residents.shift_started_at, a single
-- timestamp that is overwritten on the next sign-in and read by nothing. So
-- "who is on duty right now" cannot be answered, "who was on duty at 7pm
-- yesterday" cannot be answered, and the face verification computed at
-- shift start -- verified, confidence, reason -- is returned to the app and
-- then dropped on the floor.
--
-- That last part matters most. The route is careful to keep three outcomes
-- distinct ("we could not check" is not "we checked and it was not them")
-- and then persists none of them, so the audit trail the BRD asks for does
-- not exist. A row per shift is what makes it exist.
--
-- One row is opened at shift start and closed at shift end. ended_at NULL
-- means on duty now, which is also what the staff screen reads to decide
-- between "On shift" and "Off shift".

CREATE TABLE IF NOT EXISTS valet_shifts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resident_id   UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,

  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL while the attendant is on duty. The staff screen's "On shift" badge
  -- and the shift log's "Still on shift" are the same fact read twice.
  ended_at      TIMESTAMPTZ,

  -- What the recogniser actually concluded, kept as three distinct outcomes
  -- rather than collapsed into a boolean. `reason` carries why a shift was
  -- not verified: no_photo, attendant_not_enrolled, recognition_not_configured
  -- or no_match. A manager reading "not verified" needs to know which, because
  -- only one of those is about the person in front of them.
  verified      BOOLEAN NOT NULL DEFAULT false,
  confidence    REAL,
  reason        VARCHAR(40),

  -- Where they worked. Free text for now: valet points are a property-level
  -- concept the redesign introduces and this column is here so the shift log
  -- does not need a second migration when they land.
  valet_point   VARCHAR(120),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Who is on duty at this property right now" -- read on every load of the
-- staff screen, so it gets the partial index rather than a filtered scan.
CREATE INDEX IF NOT EXISTS idx_valet_shifts_open
  ON valet_shifts (community_id, resident_id)
  WHERE ended_at IS NULL;

-- The shift log, newest first, per property and per day.
CREATE INDEX IF NOT EXISTS idx_valet_shifts_log
  ON valet_shifts (community_id, started_at DESC);

-- At most one open shift per person. Without it a double tap on the start
-- screen, or an app that retried after a dropped reply, leaves two open rows
-- and the attendant appears twice in "on shift now" forever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_shifts_one_open_per_person
  ON valet_shifts (resident_id)
  WHERE ended_at IS NULL;
