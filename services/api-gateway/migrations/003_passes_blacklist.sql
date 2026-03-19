CREATE TABLE visitor_passes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id   UUID NOT NULL REFERENCES communities(id),
  unit_id        UUID NOT NULL REFERENCES units(id),
  created_by     UUID NOT NULL REFERENCES residents(id),
  visitor_name   VARCHAR(200) NOT NULL,
  visitor_mobile VARCHAR(15),
  otp            VARCHAR(8),
  rfid_uid_hash  VARCHAR(64),
  valid_from     TIMESTAMPTZ NOT NULL,
  valid_until    TIMESTAMPTZ NOT NULL,
  max_uses       INT DEFAULT 1,
  uses_count     INT DEFAULT 0,
  status         VARCHAR(20) DEFAULT 'active',
  sms_sent       BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pass_otp  ON visitor_passes(community_id, otp) WHERE status='active';
CREATE INDEX idx_pass_rfid ON visitor_passes(community_id, rfid_uid_hash) WHERE status='active';

CREATE TABLE rfid_cards (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id   UUID NOT NULL REFERENCES communities(id),
  uid_hash       VARCHAR(64) NOT NULL UNIQUE,
  card_number    VARCHAR(50),
  issued_to_unit UUID REFERENCES units(id),
  card_type      VARCHAR(20) DEFAULT 'resident',
  is_active      BOOLEAN DEFAULT TRUE,
  issued_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at     TIMESTAMPTZ
);

CREATE TABLE blacklist (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id   UUID NOT NULL REFERENCES communities(id),
  plate          VARCHAR(20),
  rfid_uid_hash  VARCHAR(64),
  reason         TEXT NOT NULL,
  added_by       UUID REFERENCES residents(id),
  expires_at     TIMESTAMPTZ,
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bl_plate ON blacklist(community_id, plate) WHERE is_active=TRUE;
CREATE INDEX idx_bl_rfid  ON blacklist(community_id, rfid_uid_hash) WHERE is_active=TRUE;
