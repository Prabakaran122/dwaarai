-- 011_approval_requests.sql
-- Remote approval requests from guard → resident

CREATE TABLE IF NOT EXISTS approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL REFERENCES communities(id),
  unit_id         UUID NOT NULL REFERENCES units(id),
  gate_id         UUID NOT NULL REFERENCES gates(id),
  guard_id        UUID NOT NULL,
  visitor_name    VARCHAR(200) NOT NULL,
  vehicle_plate   VARCHAR(20),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  responded_by    UUID REFERENCES residents(id),
  responded_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approval_pending ON approval_requests(community_id, unit_id)
  WHERE status = 'pending';
