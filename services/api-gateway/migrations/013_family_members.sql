-- 013_family_members.sql
-- Feature 4 (Resident App brief): Household / Family Members.
-- Family members are additional residents linked to the same unit. The residents
-- table already supports this (unit_id, is_primary, UNIQUE(community_id, mobile));
-- we only extend it with relationship, authorship, and per-member notification opt-in.

ALTER TABLE residents
  ADD COLUMN IF NOT EXISTS relationship        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS created_by          UUID REFERENCES residents(id),
  ADD COLUMN IF NOT EXISTS notify_on_approval  BOOLEAN DEFAULT TRUE;

-- Fast lookup of all active members of a unit (household roster).
CREATE INDEX IF NOT EXISTS idx_residents_unit_active
  ON residents(unit_id) WHERE is_active = true;
