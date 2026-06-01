-- 018_sos_alerts.sql
-- Guard App 3.6 (SOS & Emergency): guard-raised emergency alerts.
-- Broadcast over WebSocket to the community room; persisted for admin review.

CREATE TABLE IF NOT EXISTS sos_alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id   UUID NOT NULL REFERENCES communities(id),
  gate_id        UUID,
  raised_by      UUID REFERENCES residents(id),   -- guards are residents
  raised_by_name VARCHAR(200),
  type           VARCHAR(20) NOT NULL,             -- medical | fire | security | other
  note           TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'active', -- active | resolved
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ,
  resolved_by    UUID
);

CREATE INDEX IF NOT EXISTS idx_sos_active ON sos_alerts(community_id, status);
