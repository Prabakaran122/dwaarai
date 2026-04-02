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
