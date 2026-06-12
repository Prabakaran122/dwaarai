-- 022_unit_profile.sql — My Unit: wing + ownership type on units
ALTER TABLE units ADD COLUMN IF NOT EXISTS wing VARCHAR(40);
ALTER TABLE units ADD COLUMN IF NOT EXISTS ownership_type VARCHAR(10); -- 'owner' | 'tenant'
