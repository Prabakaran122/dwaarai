-- 009_invite_code.sql — Resident self-registration + visitor vehicle support

-- Community invite code for self-registration
ALTER TABLE communities ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20) UNIQUE;

-- Generate invite codes for existing communities
UPDATE communities SET invite_code = UPPER(SUBSTR(REPLACE(gen_random_uuid()::text, '-', ''), 1, 8))
WHERE invite_code IS NULL;

-- Visitor vehicle number for ANPR auto-entry
ALTER TABLE visitor_passes ADD COLUMN IF NOT EXISTS visitor_vehicle VARCHAR(20);
