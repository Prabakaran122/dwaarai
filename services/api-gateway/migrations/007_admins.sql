-- Admins table for portal authentication
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'community_admin')),
  community_id UUID REFERENCES communities(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admins_username ON admins(username);

-- Add fields to communities table
ALTER TABLE communities ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE communities ADD COLUMN IF NOT EXISTS contact_name VARCHAR(200);
ALTER TABLE communities ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(15);

-- Seed super admin (password: admin123)
INSERT INTO admins (id, name, username, password_hash, role, community_id)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  'Super Admin',
  'superadmin',
  '$2b$10$eIh.gs2jxFCeRqqKIH8af.y3pXF1t5ORU9H//G8STv./uVXvz/1f6',
  'super_admin',
  NULL
) ON CONFLICT (username) DO NOTHING;
