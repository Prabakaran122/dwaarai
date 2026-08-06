-- Events module (BRD v1.0): stall commerce, donation funds, and a single
-- payment_orders ledger shared by every purpose so there is one audit trail.

-- ── events: type, featured flag, cover image ─────────────────────────────────
-- `category` already exists and means something else (general|sports|festival|
-- meeting|kids). The BRD's filter chips need a separate commerce dimension.
ALTER TABLE events ADD COLUMN IF NOT EXISTS has_stalls    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS has_donations BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_featured   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_path    VARCHAR(255);

-- At most one featured event per community — the BRD renders exactly one hero.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_featured_event_per_community
  ON events(community_id) WHERE is_featured;

-- ── stalls ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_stalls (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id),
  community_id  UUID NOT NULL REFERENCES communities(id),
  code          VARCHAR(20) NOT NULL,            -- 'A1', 'B4' — shown to the user
  stall_type    VARCHAR(20) NOT NULL DEFAULT 'standard', -- standard|premium|corner
  price_paise   INTEGER NOT NULL CHECK (price_paise >= 0),
  row_index     INTEGER NOT NULL DEFAULT 0,      -- grid position for the map
  col_index     INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stall_code_per_event ON event_stalls(event_id, code);

-- ── stall bookings ───────────────────────────────────────────────────────────
-- booker_kind distinguishes a resident (resident_id set) from an external
-- vendor booking through the public link (guest_name/guest_mobile set).
CREATE TABLE IF NOT EXISTS stall_bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stall_id          UUID NOT NULL REFERENCES event_stalls(id),
  event_id          UUID NOT NULL REFERENCES events(id),
  community_id      UUID NOT NULL REFERENCES communities(id),
  booker_kind       VARCHAR(10) NOT NULL,          -- 'resident' | 'guest'
  resident_id       UUID REFERENCES residents(id),
  unit_id           UUID REFERENCES units(id),
  guest_name        VARCHAR(120),
  guest_mobile      VARCHAR(15),
  stall_fee_paise   INTEGER NOT NULL,
  platform_fee_paise INTEGER NOT NULL,
  total_paise       INTEGER NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'reserved', -- reserved|booked|released
  order_id          UUID,                          -- -> payment_orders.id
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  booked_at         TIMESTAMPTZ,
  released_at       TIMESTAMPTZ
);

-- THE concurrency guarantee. The BRD requires that two people booking the same
-- stall produce exactly one booking and one clear error. A SELECT-then-INSERT
-- cannot promise that; this partial unique index can: only one non-released
-- booking may exist per stall, and the loser gets a 23505 the route turns into
-- a 409.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_booking_per_stall
  ON stall_bookings(stall_id) WHERE status <> 'released';

-- ── donation funds ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS donation_funds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id   UUID NOT NULL REFERENCES communities(id),
  event_id       UUID REFERENCES events(id),
  name           VARCHAR(160) NOT NULL,
  description    VARCHAR(2000),
  target_paise   INTEGER NOT NULL CHECK (target_paise > 0),
  is_open        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS donations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id       UUID NOT NULL REFERENCES donation_funds(id),
  community_id  UUID NOT NULL REFERENCES communities(id),
  resident_id   UUID REFERENCES residents(id),
  unit_id       UUID REFERENCES units(id),
  donor_name    VARCHAR(120),
  amount_paise  INTEGER NOT NULL CHECK (amount_paise > 0),
  status        VARCHAR(20) NOT NULL DEFAULT 'created', -- created|paid|failed
  order_id      UUID,
  is_anonymous  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_donations_fund_paid ON donations(fund_id) WHERE status = 'paid';

-- ── payment orders (shared ledger) ───────────────────────────────────────────
-- One row per gateway order regardless of what is being paid for. dues keeps
-- its own due_payments table untouched — that path is live.
CREATE TABLE IF NOT EXISTS payment_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id       UUID NOT NULL REFERENCES communities(id),
  purpose            VARCHAR(20) NOT NULL,          -- 'stall' | 'donation'
  subject_id         UUID NOT NULL,                 -- stall_bookings.id | donations.id
  amount_paise       INTEGER NOT NULL,
  platform_fee_paise INTEGER NOT NULL DEFAULT 0,
  gateway            VARCHAR(20) NOT NULL DEFAULT 'razorpay',
  gateway_order_id   VARCHAR(100),
  gateway_payment_id VARCHAR(100),
  status             VARCHAR(20) NOT NULL DEFAULT 'created', -- created|paid|failed
  test_mode          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at            TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_order_gateway_id
  ON payment_orders(gateway_order_id) WHERE gateway_order_id IS NOT NULL;

-- ── guest booking links ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guest_booking_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id),
  community_id UUID NOT NULL REFERENCES communities(id),
  token        VARCHAR(64) NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ,
  is_revoked   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
