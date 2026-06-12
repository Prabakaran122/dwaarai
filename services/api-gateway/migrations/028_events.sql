-- 028_events.sql — community events + RSVP
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  created_by UUID REFERENCES residents(id),
  author_name VARCHAR(200),
  title VARCHAR(160) NOT NULL,
  description VARCHAR(4000),
  location VARCHAR(160),
  category VARCHAR(20) NOT NULL DEFAULT 'general',  -- general|sports|festival|meeting|kids
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_community_time ON events(community_id, starts_at) WHERE is_cancelled = false;
CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id UUID NOT NULL REFERENCES events(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  status VARCHAR(10) NOT NULL DEFAULT 'going',  -- going|maybe|no
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, resident_id)
);
