-- Sarthi valet flow, ported from the standalone SQLite prototype into the
-- CommunityGate schema.
--
-- Three structural changes from the prototype's schema.sql, all deliberate:
--
-- 1. `venue_id TEXT` becomes `community_id UUID REFERENCES communities(id)`.
--    The prototype was venue-scoped with a free-text id read from an env var;
--    every other table in this database is community-scoped, and valet is now
--    a product line inside a community rather than a separate deployment.
--
-- 2. The prototype's `guards` table (keyed by guard NAME, its own known
--    simplification) is dropped entirely. Guards already exist here as
--    `residents` rows with `type = 'guard'`, so the staff-badge fields are
--    added to that table instead and every guard reference below is a real
--    FK to residents(id) rather than a name string.
--
-- 3. Every timestamp is TIMESTAMPTZ, not an ISO string in a TEXT column.
--    The prototype stored `toISOString()` output as TEXT and compared it
--    against SQLite's `datetime('now')`, which formats differently
--    ("2026-08-10 14:11:15" vs "2026-08-10T14:11:15.294Z"). Because SQLite
--    compares TEXT lexicographically and ' ' sorts before 'T', that
--    comparison was false for every row and the retention sweep silently
--    never deleted anything. Real timestamp types make that class of bug
--    unrepresentable.
--
-- The three DPDP consent timestamps (photo capture, discount opt-in, staff
-- badge) stay three separate columns on three separate tables. They are
-- distinct collection purposes and are intentionally never merged.

-- --------------------------------------------------------------------------
-- Staff badge fields on the existing guard identity.
-- Company-issued badge only: photo, name, employee code. No government ID
-- document or number is ever captured here.
-- --------------------------------------------------------------------------
ALTER TABLE residents ADD COLUMN IF NOT EXISTS employee_code     VARCHAR(50);
ALTER TABLE residents ADD COLUMN IF NOT EXISTS badge_photo_key   TEXT;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS badge_consent_at  TIMESTAMPTZ;

-- --------------------------------------------------------------------------
-- Tickets
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS valet_tickets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id        UUID NOT NULL REFERENCES communities(id),

  -- Cosmetic, shown on the printed card and the guard UI. Never used to look
  -- up a ticket: only session_token resolves a guest URL, so incrementing
  -- this can never walk into another guest's data.
  display_id          VARCHAR(20) NOT NULL,
  session_token       TEXT NOT NULL UNIQUE,

  plate               VARCHAR(20) NOT NULL,   -- as typed by the guard, for display
  plate_normalized    VARCHAR(20) NOT NULL,   -- uppercased, whitespace stripped; repeat-vehicle matching only
  vehicle_make        VARCHAR(100) NOT NULL,
  phone_number        VARCHAR(15),            -- reserved for the WhatsApp/PMS tier; nothing writes it today

  stay_end_at         TIMESTAMPTZ NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'parked',

  created_by_guard_id UUID NOT NULL REFERENCES residents(id),
  current_guard_id    UUID REFERENCES residents(id),

  eta_minutes         INTEGER,      -- guard's rough estimate, set at accept time
  en_route_started_at TIMESTAMPTZ,  -- eta_minutes counts down from here; only meaningful while en_route

  disputed            BOOLEAN NOT NULL DEFAULT FALSE,
  disputed_at         TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at           TIMESTAMPTZ,

  CONSTRAINT valet_tickets_status_check CHECK (status IN (
    'parked', 'requested', 'en_route', 'arrived', 'parked_again', 'final_closed', 'expired'
  )),
  CONSTRAINT valet_tickets_eta_range CHECK (eta_minutes IS NULL OR (eta_minutes BETWEEN 1 AND 60)),
  UNIQUE (community_id, display_id)
);

CREATE INDEX IF NOT EXISTS idx_valet_tickets_status     ON valet_tickets(community_id, status);
CREATE INDEX IF NOT EXISTS idx_valet_tickets_stay_end   ON valet_tickets(stay_end_at);
CREATE INDEX IF NOT EXISTS idx_valet_tickets_plate      ON valet_tickets(community_id, plate_normalized);

-- --------------------------------------------------------------------------
-- Audit trail. This table, not valet_tickets.status, is the record of what
-- happened: status is only the current position in the flow.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS valet_ticket_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID NOT NULL REFERENCES valet_tickets(id) ON DELETE CASCADE,
  event_type  VARCHAR(40) NOT NULL,
  guard_id    UUID REFERENCES residents(id),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valet_ticket_events_type_check CHECK (event_type IN (
    'created', 'photo_captured', 'requested', 'accepted', 'arrived',
    'scan_success', 'scan_failed', 'closed_pickup', 'final_closed',
    'expired', 'discount_optin', 'condition_captured', 'disputed'
  ))
);

CREATE INDEX IF NOT EXISTS idx_valet_events_ticket ON valet_ticket_events(ticket_id, created_at);

-- --------------------------------------------------------------------------
-- Guest comparison photo, captured at drop-off, shown to the guard at pickup
-- for a human visual match. No face-matching model runs against it.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS valet_photos (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id          UUID NOT NULL REFERENCES valet_tickets(id) ON DELETE CASCADE,
  storage_key        TEXT NOT NULL,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_at         TIMESTAMPTZ NOT NULL,   -- distinct DPDP purpose from the discount opt-in
  auto_delete_after  TIMESTAMPTZ,            -- set once the ticket closes; NULL while open
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_valet_photos_ticket    ON valet_photos(ticket_id);
CREATE INDEX IF NOT EXISTS idx_valet_photos_retention ON valet_photos(auto_delete_after) WHERE deleted_at IS NULL;

-- --------------------------------------------------------------------------
-- Rotating pickup QR. Only the most recently issued token for a ticket ever
-- validates, so a screenshot of an earlier one cannot be replayed.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS valet_rotating_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id    UUID NOT NULL REFERENCES valet_tickets(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_valet_rotating_ticket ON valet_rotating_tokens(ticket_id, generated_at DESC);

-- --------------------------------------------------------------------------
-- Discount opt-in. Marketing contact, a separate collection purpose from the
-- photo above, hence its own consent timestamp on its own table.
-- Nothing flips `redeemed` today; POS integration is out of scope.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS valet_discount_optins (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(20) NOT NULL UNIQUE,
  phone_number  VARCHAR(15) NOT NULL,
  community_id  UUID NOT NULL REFERENCES communities(id),
  ticket_id     UUID REFERENCES valet_tickets(id) ON DELETE SET NULL,
  consent_at    TIMESTAMPTZ NOT NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiry        TIMESTAMPTZ NOT NULL,
  redeemed      BOOLEAN NOT NULL DEFAULT FALSE
);

-- --------------------------------------------------------------------------
-- Vehicle condition media: intake at drop-off, return at pickup. Each stage
-- holds up to four angle photos OR one short video.
--
-- STUB: automated damage detection would read this table and compare intake
-- against return media. Nothing in this phase analyses it; a human reviews
-- the two stages side by side.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS valet_condition_records (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id          UUID NOT NULL REFERENCES valet_tickets(id) ON DELETE CASCADE,
  stage              VARCHAR(10) NOT NULL,
  media_type         VARCHAR(10) NOT NULL,
  angle              VARCHAR(10),           -- NULL for video
  storage_key        TEXT NOT NULL,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Never enforced while the ticket is disputed; that exemption is checked at
  -- deletion time, not here, so flagging a dispute after this was scheduled
  -- still protects the media.
  auto_delete_after  TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ,

  CONSTRAINT valet_condition_stage_check CHECK (stage IN ('intake', 'return')),
  CONSTRAINT valet_condition_media_check CHECK (media_type IN ('photo', 'video')),
  CONSTRAINT valet_condition_angle_check CHECK (
    angle IS NULL OR angle IN ('front', 'back', 'left', 'right')
  )
);

CREATE INDEX IF NOT EXISTS idx_valet_condition_ticket    ON valet_condition_records(ticket_id, stage);
CREATE INDEX IF NOT EXISTS idx_valet_condition_retention ON valet_condition_records(auto_delete_after) WHERE deleted_at IS NULL;
