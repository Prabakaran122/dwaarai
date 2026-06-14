-- 029_committee_polls.sql — committee-run polls: committee flag, audience, per-unit voting
ALTER TABLE residents ADD COLUMN IF NOT EXISTS is_committee BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS target_block_id UUID REFERENCES blocks(id);
ALTER TABLE poll_votes ADD COLUMN IF NOT EXISTS unit_id UUID;
-- switch one-vote-per-resident to one-vote-per-unit
ALTER TABLE poll_votes DROP CONSTRAINT IF EXISTS poll_votes_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_poll_unit ON poll_votes(poll_id, unit_id);
