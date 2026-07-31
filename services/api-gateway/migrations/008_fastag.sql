-- FASTag auto-pairing: add fastag_tid_hash to vehicles, extend gate_events

-- Vehicles: add FASTag TID hash column
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fastag_tid_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_vehicles_fastag ON vehicles(community_id, fastag_tid_hash) WHERE fastag_tid_hash IS NOT NULL;

-- Gate events: add FASTag + correlation fields
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS fastag_tid_hash VARCHAR(64);
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS auto_paired BOOLEAN DEFAULT FALSE;
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'entry';
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS correlation_id UUID;

-- Blacklist: add FASTag TID hash support
ALTER TABLE blacklist ADD COLUMN IF NOT EXISTS fastag_tid_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_bl_fastag ON blacklist(community_id, fastag_tid_hash) WHERE is_active=TRUE AND fastag_tid_hash IS NOT NULL;

-- Seed FASTag hashes for the demo vehicles.
--
-- These used to live in the vehicles INSERT in 005_seed.sql, which referenced
-- fastag_tid_hash three migrations before this file created it — so 005 failed
-- on any database migrated from scratch. It went unnoticed while migrations
-- were applied by hand: 005 ran before this file existed, and was edited
-- afterwards. They belong here, immediately after the column.
--
-- SHA-256 of the TID string (matches edge/emulators/uhf_mock.py TEST_TAGS):
--   E200001234560001 (RESIDENT_301)  -> c95ceb59...
--   E200001234560002 (RESIDENT_205)  -> 5ff94532...
--   E200001234560003 (RESIDENT_BIKE) -> 212c7215...
UPDATE vehicles SET fastag_tid_hash = 'c95ceb59dddcb3d2aa5010cb814ed3cd7acfb66ba1d21b4b00fb6c1d9fb27714'
  WHERE id = '00000000-0000-0000-0000-000000010001';
UPDATE vehicles SET fastag_tid_hash = '5ff94532420e5c4321e8b30785e394ef116f59917a2fa37944f842f7b403c492'
  WHERE id = '00000000-0000-0000-0000-000000010002';
UPDATE vehicles SET fastag_tid_hash = '212c72153310ef96e348e3d5648c480c514b25fe9bce2998820482b727cf25af'
  WHERE id = '00000000-0000-0000-0000-000000010003';
