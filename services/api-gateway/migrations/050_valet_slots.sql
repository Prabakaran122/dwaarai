-- Parking inventory, for venues that have any.
--
-- A hotel with a three-level garage wants Floor -> Zone -> Slot and a grid
-- showing what is free. A restaurant with a forecourt does not, and forcing
-- that structure on them would be worse than not offering it -- hence the
-- per-venue flag in communities.config.valetSlotsEnabled rather than a column
-- every property has to care about.

CREATE TABLE IF NOT EXISTS valet_slots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id  UUID NOT NULL REFERENCES communities(id),

  -- Text, not an integer: basements are the common case in Indian hotels and
  -- 'B2' does not fit in a number. Ordering is handled at read time.
  floor         VARCHAR(10) NOT NULL,
  zone          VARCHAR(20) NOT NULL,
  number        VARCHAR(10) NOT NULL,

  -- Retired rather than deleted once a car has stood in it, for the same
  -- reason cards are: the slot is referenced by tickets that are still part of
  -- the audit trail.
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (community_id, floor, zone, number)
);

CREATE INDEX IF NOT EXISTS idx_valet_slots_community
  ON valet_slots(community_id) WHERE is_active = true;

-- Which slot a car is standing in.
--
-- Nullable on purpose, and it stays nullable even at venues with the flag on.
-- A full garage must never be the reason a car cannot be taken in: valets
-- double-park and use aisles, and an intake that refuses over inventory
-- bookkeeping would have the guard abandon the app, not the car.
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS slot_id UUID REFERENCES valet_slots(id);

-- Occupancy is derived from this at query time and never stored. A stored
-- is_occupied flag drifts the first time a ticket closes by a path nobody
-- remembered to update.
CREATE INDEX IF NOT EXISTS idx_valet_tickets_slot
  ON valet_tickets(slot_id) WHERE slot_id IS NOT NULL;
