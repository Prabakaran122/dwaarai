-- 012_recurring_passes.sql
-- Recurring visitor passes + daily expected visits

CREATE TABLE IF NOT EXISTS recurring_passes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL REFERENCES communities(id),
  unit_id         UUID NOT NULL REFERENCES units(id),
  created_by      UUID NOT NULL REFERENCES residents(id),
  visitor_name    VARCHAR(200) NOT NULL,
  visitor_name_normalized VARCHAR(200) NOT NULL,
  visitor_role    VARCHAR(50),
  schedule_type   VARCHAR(20) NOT NULL,
  schedule_days   SMALLINT[],
  time_from       TIME NOT NULL,
  time_until      TIME NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recurring_active ON recurring_passes(community_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS expected_visits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_pass_id UUID NOT NULL REFERENCES recurring_passes(id),
  community_id    UUID NOT NULL REFERENCES communities(id),
  unit_id         UUID NOT NULL,
  visit_date      DATE NOT NULL,
  time_from       TIME NOT NULL,
  time_until      TIME NOT NULL,
  visitor_name_normalized VARCHAR(200) NOT NULL,
  visitor_role    VARCHAR(50),
  status          VARCHAR(20) NOT NULL DEFAULT 'expected',
  arrived_at      TIMESTAMPTZ,
  marked_by       UUID,
  photo_url       VARCHAR(500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expected_today ON expected_visits(community_id, visit_date, status);
CREATE INDEX idx_expected_name ON expected_visits(community_id, visit_date, visitor_name_normalized)
  WHERE status = 'expected';
