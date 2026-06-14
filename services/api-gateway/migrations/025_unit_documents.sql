-- 025_unit_documents.sql — resident document vault (per unit)
CREATE TABLE IF NOT EXISTS unit_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  uploaded_by UUID REFERENCES residents(id),
  title VARCHAR(120) NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'other', -- 'ownership' | 'maintenance' | 'id_proof' | 'other'
  file_path VARCHAR(255) NOT NULL,
  mime VARCHAR(80),
  size_bytes INT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unit_documents_unit ON unit_documents(unit_id) WHERE is_active = true;
