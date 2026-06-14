-- 026_facilities.sql — community facilities + slot bookings (My Unit: Book a court)
CREATE TABLE IF NOT EXISTS facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  name VARCHAR(60) NOT NULL,
  sport VARCHAR(30) NOT NULL,
  open_time TIME NOT NULL DEFAULT '06:00',
  close_time TIME NOT NULL DEFAULT '22:00',
  slot_minutes INT NOT NULL DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_facility_name ON facilities(community_id, name);

CREATE TABLE IF NOT EXISTS facility_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  resident_id UUID REFERENCES residents(id),
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'booked',  -- 'booked' | 'cancelled'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_facility_slot ON facility_bookings(facility_id, booking_date, start_time) WHERE status = 'booked';

-- Seed default facilities for every existing community.
INSERT INTO facilities (community_id, name, sport)
SELECT c.id, v.name, v.sport
  FROM communities c
  CROSS JOIN (VALUES
    ('Badminton Court','badminton'),
    ('Table Tennis','table_tennis'),
    ('Lawn Tennis','tennis'),
    ('Basketball Court','basketball'),
    ('Snooker Table','snooker')
  ) AS v(name, sport)
ON CONFLICT (community_id, name) DO NOTHING;
