CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE communities (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(200) NOT NULL,
  city         VARCHAR(100) DEFAULT 'Bangalore',
  total_units  INT NOT NULL DEFAULT 0,
  config       JSONB DEFAULT '{}',
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE blocks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id),
  name         VARCHAR(100) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE units (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id),
  block_id     UUID REFERENCES blocks(id),
  unit_number  VARCHAR(30) NOT NULL,
  floor        INT,
  owner_name   VARCHAR(200),
  status       VARCHAR(20) DEFAULT 'occupied',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(community_id, unit_number)
);

CREATE TABLE residents (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id),
  unit_id      UUID NOT NULL REFERENCES units(id),
  name         VARCHAR(200) NOT NULL,
  mobile       VARCHAR(15) NOT NULL,
  email        VARCHAR(200),
  type         VARCHAR(20) DEFAULT 'owner',
  is_primary   BOOLEAN DEFAULT FALSE,
  fcm_token    TEXT,
  cognito_sub  VARCHAR(200) UNIQUE,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(community_id, mobile)
);

CREATE TABLE vehicles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id  UUID NOT NULL REFERENCES communities(id),
  unit_id       UUID NOT NULL REFERENCES units(id),
  resident_id   UUID REFERENCES residents(id),
  plate         VARCHAR(20) NOT NULL,
  plate_display VARCHAR(25),
  make          VARCHAR(50),
  model         VARCHAR(50),
  color         VARCHAR(30),
  type          VARCHAR(20) DEFAULT 'car',
  rfid_uid_hash VARCHAR(64),
  rfid_card_no  VARCHAR(50),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(community_id, plate)
);
CREATE INDEX idx_vehicles_plate ON vehicles(community_id, plate);
CREATE INDEX idx_vehicles_rfid  ON vehicles(community_id, rfid_uid_hash);
