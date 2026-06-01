-- 021_incidents.sql
-- Guard App 3.8 (Incident Reporting): persist guard-filed incidents.
-- The guard app already submits these (POST /incidents); this adds storage + admin review.

CREATE TABLE IF NOT EXISTS incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id     UUID NOT NULL REFERENCES communities(id),
  gate_id          UUID,
  reported_by      UUID REFERENCES residents(id),   -- guards are residents
  reported_by_name VARCHAR(200),
  type             VARCHAR(50) NOT NULL,             -- unauthorized_entry | tailgating | suspicious_person | vehicle_damage | equipment_malfunction | other
  description      TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'open', -- open | reviewed
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      UUID
);

CREATE INDEX IF NOT EXISTS idx_incidents_community ON incidents(community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(community_id, status);
