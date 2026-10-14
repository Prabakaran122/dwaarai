-- Where guests actually hand over and collect cars.
--
-- A hotel does not have "a valet desk". It has a main porch that runs all day,
-- a banquet entrance that opens for events, and sometimes a separate tower
-- lobby -- and an attendant works one of them for a shift. Until now the
-- product modelled a property as a single undifferentiated place, so "which
-- door was Suresh on when that car went missing" had no answer, and the shift
-- log's valet_point column was free text with nothing to choose from.
--
-- Deliberately not the same thing as valet_slots. A slot is a numbered bay a
-- car is parked IN; a point is a door a guest stands AT. Conflating them would
-- break the one question each is good at.

CREATE TABLE IF NOT EXISTS valet_points (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,

  name          VARCHAR(120) NOT NULL,

  -- 'active'      — open now, offered to every attendant starting a shift
  -- 'events_only' — the banquet door: real, staffed only when something is on
  -- 'paused'      — kept for history, not offered
  --
  -- Paused rather than deleted, because shifts reference the name and a
  -- property that closes a door for a refurbishment still needs last month's
  -- log to make sense.
  status        VARCHAR(16) NOT NULL DEFAULT 'active',

  -- How many cars this point can hold. Nullable: plenty of venues genuinely
  -- do not know, and a made-up number is worse than an empty one.
  capacity      INT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valet_points_status_check CHECK (
    status IN ('active', 'events_only', 'paused')
  )
);

-- One name per property. Two "Main porch" entries would make the shift log
-- ambiguous in exactly the situation it exists to resolve.
CREATE UNIQUE INDEX IF NOT EXISTS idx_valet_points_name
  ON valet_points (community_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_valet_points_community
  ON valet_points (community_id, status);
