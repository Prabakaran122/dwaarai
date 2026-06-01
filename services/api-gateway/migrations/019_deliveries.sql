-- 019_deliveries.sql
-- Guard App 3.5 (Delivery Management): courier arrivals logged at the gate.

CREATE TABLE IF NOT EXISTS deliveries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id   UUID NOT NULL REFERENCES communities(id),
  gate_id        UUID,
  unit_id        UUID NOT NULL REFERENCES units(id),
  company        VARCHAR(40) NOT NULL,
  note           TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'waiting', -- waiting | delivered | left_at_gate
  logged_by      UUID REFERENCES residents(id),          -- guards are residents
  logged_by_name VARCHAR(200),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deliveries_active ON deliveries(community_id, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_unit ON deliveries(unit_id, created_at);
