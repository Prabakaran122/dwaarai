-- 023_pets.sql — household pets under My Unit
CREATE TABLE IF NOT EXISTS pets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  created_by UUID REFERENCES residents(id),
  name VARCHAR(60) NOT NULL,
  species VARCHAR(20) NOT NULL,  -- 'dog' | 'cat' | 'bird' | 'rabbit' | 'other'
  breed VARCHAR(60),
  notes VARCHAR(280),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pets_unit ON pets(unit_id) WHERE is_active = true;
