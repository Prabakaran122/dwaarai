-- 027_community.sql — Community: issues (same-issue upvote + status) and polls
CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  unit_id UUID REFERENCES units(id),
  author_resident_id UUID REFERENCES residents(id),
  author_name VARCHAR(200),
  author_unit VARCHAR(30),
  title VARCHAR(200) NOT NULL,
  body VARCHAR(4000) NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'general',   -- maintenance|security|amenities|general
  status VARCHAR(20) NOT NULL DEFAULT 'open',         -- open|in_progress|resolved
  is_removed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS issue_upvotes (
  issue_id UUID NOT NULL REFERENCES issues(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issue_id, resident_id)
);
CREATE TABLE IF NOT EXISTS polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  created_by UUID REFERENCES residents(id),
  author_name VARCHAR(200),
  question VARCHAR(280) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',          -- open|closed
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id),
  label VARCHAR(120) NOT NULL,
  position INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id UUID NOT NULL REFERENCES polls(id),
  option_id UUID NOT NULL REFERENCES poll_options(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, resident_id)
);
CREATE INDEX IF NOT EXISTS idx_issues_community ON issues(community_id) WHERE is_removed = false;
CREATE INDEX IF NOT EXISTS idx_polls_community ON polls(community_id);
