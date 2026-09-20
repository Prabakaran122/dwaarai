-- Hotel groups, and the four kinds of person who work in them.
--
-- Until now a property was a stand-alone community and an administrator was
-- scoped to exactly one of them, or to all of them. That covers a housing
-- society and a single hotel. It does not cover a group: four Leela
-- properties under one contract, with one person who sees all four and four
-- managers who each see their own.
--
-- The BRD's four tiers map onto what already exists rather than replacing it:
--
--   Client Admin      admins.role = 'client_admin', scoped to an account
--   Location Manager  admins.role = 'community_admin', scoped to a community
--   Valet Manager     residents.type = 'guard', valet_role = 'valet_manager'
--   Temporary Driver  residents.type = 'guard', valet_role = 'temporary_driver'

BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(200) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nullable, and it stays nullable. A single property with no group is the
-- common case and must not be forced to invent a parent to belong to.
ALTER TABLE communities ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);
CREATE INDEX IF NOT EXISTS idx_communities_account ON communities(account_id);

-- A Client Admin is scoped to an account the way a Location Manager is scoped
-- to a community: by which column is populated, not by a separate table.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);

ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check
  CHECK (role IN ('super_admin', 'client_admin', 'community_admin'));

-- Surge staff during a banquet are the same kind of record as a valet manager
-- with a different shelf life. Separate tables would mean every query that
-- asks "who is on shift" having to ask twice and remember to.
ALTER TABLE residents ADD COLUMN IF NOT EXISTS valet_role VARCHAR(20);
ALTER TABLE residents DROP CONSTRAINT IF EXISTS residents_valet_role_check;
ALTER TABLE residents ADD CONSTRAINT residents_valet_role_check
  CHECK (valet_role IS NULL OR valet_role IN ('valet_manager', 'temporary_driver'));

-- When a temporary driver stops being staff. Null means permanent; the point
-- of a temp is that somebody set an end date at the moment they were hired,
-- rather than a manager remembering to remove them after the wedding.
ALTER TABLE residents ADD COLUMN IF NOT EXISTS valet_until TIMESTAMPTZ;

COMMIT;
