-- Per-society verification-layer entitlements (BRD Nazar §5.6, NAZ-050..055).
-- Operated exclusively by Dwaar AI ops (super_admin) -- community_admin has no
-- write access, matching the BRD's "societies cannot turn their own layers on
-- or off" requirement.

CREATE TABLE community_entitlements (
  community_id       UUID PRIMARY KEY REFERENCES communities(id),
  fastag_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  anpr_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  face_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  ai_anomaly_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_by         UUID REFERENCES admins(id)
);

-- Seed the demo community at Elite tier (all four layers) so it's immediately demoable.
INSERT INTO community_entitlements (community_id, fastag_enabled, anpr_enabled, face_enabled, ai_anomaly_enabled)
VALUES ('00000000-0000-0000-0000-000000000001', true, true, true, true)
ON CONFLICT (community_id) DO NOTHING;
