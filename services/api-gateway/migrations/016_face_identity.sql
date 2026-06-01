-- 016_face_identity.sql
-- Feature 7 (Resident App brief): Biometric Identity — facial enrollment & consent.
-- DPDP-aligned: opt-in, granular per-location consent, withdrawable, audited.
-- IMPORTANT: raw face images are NEVER stored. Enrollment converts a scan to a
-- mathematical vector via the recognition service; only the vector is persisted.

CREATE TABLE IF NOT EXISTS face_enrollments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  unit_id      UUID NOT NULL REFERENCES units(id),
  resident_id  UUID NOT NULL UNIQUE REFERENCES residents(id),
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending' | 'active' | 'deleted'
  vector       BYTEA,                                   -- face vector only; encrypt at rest in infra. Never an image.
  enrolled_at  TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Granular per-location consent. Each location is an independent, withdrawable toggle.
CREATE TABLE IF NOT EXISTS biometric_consents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES residents(id),
  location    VARCHAR(20) NOT NULL,                     -- 'gate' | 'pool' | 'clubhouse' | 'gym'
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(resident_id, location)
);

-- Transparency: every biometric access decision is logged for the resident to see.
CREATE TABLE IF NOT EXISTS biometric_access_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  resident_id  UUID REFERENCES residents(id),
  location     VARCHAR(20) NOT NULL,
  method       VARCHAR(20) NOT NULL,                    -- 'face' | 'otp'
  decision     VARCHAR(20) NOT NULL,                    -- 'granted' | 'denied' | 'fallback'
  terminal_id  VARCHAR(100),
  event_ts     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biometric_events_resident
  ON biometric_access_events(resident_id, event_ts DESC);
