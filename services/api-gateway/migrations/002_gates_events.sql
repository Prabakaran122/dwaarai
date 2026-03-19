CREATE TABLE gates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id),
  name         VARCHAR(100) NOT NULL,
  type         VARCHAR(20) DEFAULT 'entry',
  hardware     JSONB DEFAULT '{"anpr":true,"rfid":true}',
  is_active    BOOLEAN DEFAULT TRUE,
  last_seen    TIMESTAMPTZ,
  status       VARCHAR(20) DEFAULT 'online',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- NEVER UPDATE OR DELETE ROWS FROM gate_events
CREATE TABLE gate_events (
  id                  UUID NOT NULL DEFAULT uuid_generate_v4(),
  community_id        UUID NOT NULL,
  gate_id             UUID NOT NULL,
  detection_method    VARCHAR(10) NOT NULL,
  raw_value           VARCHAR(100),
  matched_vehicle_id  UUID,
  matched_pass_id     UUID,
  matched_unit_id     UUID,
  matched_unit_number VARCHAR(30),
  resident_name       VARCHAR(200),
  access_decision     VARCHAR(15) NOT NULL,
  deny_reason         VARCHAR(100),
  anpr_confidence     FLOAT,
  snapshot_s3_key     TEXT,
  processing_ms       INT,
  is_offline_event    BOOLEAN DEFAULT FALSE,
  synced_at           TIMESTAMPTZ,
  event_ts            TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (event_ts);

-- All 16 partitions from y2025m01 through y2026m04
CREATE TABLE gate_events_y2025m01 PARTITION OF gate_events FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE gate_events_y2025m02 PARTITION OF gate_events FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE gate_events_y2025m03 PARTITION OF gate_events FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE gate_events_y2025m04 PARTITION OF gate_events FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE gate_events_y2025m05 PARTITION OF gate_events FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE gate_events_y2025m06 PARTITION OF gate_events FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE gate_events_y2025m07 PARTITION OF gate_events FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE gate_events_y2025m08 PARTITION OF gate_events FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE gate_events_y2025m09 PARTITION OF gate_events FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE gate_events_y2025m10 PARTITION OF gate_events FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE gate_events_y2025m11 PARTITION OF gate_events FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE gate_events_y2025m12 PARTITION OF gate_events FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE gate_events_y2026m01 PARTITION OF gate_events FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE gate_events_y2026m02 PARTITION OF gate_events FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE gate_events_y2026m03 PARTITION OF gate_events FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE gate_events_y2026m04 PARTITION OF gate_events FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE INDEX idx_ge_ts    ON gate_events(community_id, event_ts DESC);
CREATE INDEX idx_ge_gate  ON gate_events(gate_id, event_ts DESC);
CREATE INDEX idx_ge_value ON gate_events(raw_value, event_ts DESC);
