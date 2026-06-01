-- 020_shift_handovers.sql
-- Guard App 3.7 (Shift Handover): outgoing guard's note carried to the next shift.

CREATE TABLE IF NOT EXISTS shift_handovers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  gate_id      UUID,
  guard_id     UUID REFERENCES residents(id),   -- guards are residents
  guard_name   VARCHAR(200),
  note         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_handovers_latest
  ON shift_handovers(community_id, gate_id, created_at DESC);
