-- Community module v1.0 (BRD, Aug 2026).

-- Committee identity. The mockups label people "Rajan Kumar · Secretary";
-- residents previously had only an is_committee boolean and no way to set it.
ALTER TABLE residents ADD COLUMN IF NOT EXISTS committee_role VARCHAR(20);

-- The accountability surface. INSERT-ONLY: nothing in the codebase updates or
-- deletes these rows, and they outlive the parent issue being hidden.
-- changed_by_name/role are denormalised on purpose: an audit entry must read
-- correctly after the actor leaves the committee.
CREATE TABLE IF NOT EXISTS issue_status_events (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id                UUID NOT NULL REFERENCES issues(id),
  community_id            UUID NOT NULL REFERENCES communities(id),
  from_status             VARCHAR(20),
  to_status               VARCHAR(20),
  changed_by_resident_id  UUID REFERENCES residents(id),
  changed_by_name         VARCHAR(200),
  changed_by_role         VARCHAR(20),
  kind                    VARCHAR(20) NOT NULL DEFAULT 'status_change',
  detail                  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ise_issue ON issue_status_events(issue_id, created_at);

-- Up to 5 ordered photos per issue. A child table, not an array column, so the
-- cap and ordering are enforceable.
CREATE TABLE IF NOT EXISTS issue_photos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id   UUID NOT NULL REFERENCES issues(id),
  path       TEXT NOT NULL,
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_photos ON issue_photos(issue_id, position);

CREATE TABLE IF NOT EXISTS issue_replies (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id            UUID NOT NULL REFERENCES issues(id),
  community_id        UUID NOT NULL REFERENCES communities(id),
  author_resident_id  UUID REFERENCES residents(id),
  author_name         VARCHAR(200),
  author_unit         VARCHAR(30),
  author_role         VARCHAR(20),
  body                TEXT NOT NULL,
  is_official         BOOLEAN NOT NULL DEFAULT FALSE,
  is_removed          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_replies ON issue_replies(issue_id, created_at);

ALTER TABLE issues ADD COLUMN IF NOT EXISTS reference     VARCHAR(20);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS assignee_name VARCHAR(200);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at   TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_issue_reference
  ON issues(community_id, reference) WHERE reference IS NOT NULL;

-- Per-community, per-year counter for IQ-YYYY-NNN. A row-locked counter rather
-- than MAX(n)+1, which collides under concurrent inserts.
CREATE TABLE IF NOT EXISTS issue_reference_seq (
  community_id UUID NOT NULL,
  year         INT  NOT NULL,
  last_value   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (community_id, year)
);

ALTER TABLE polls ADD COLUMN IF NOT EXISTS topic              VARCHAR(80);
ALTER TABLE polls ADD COLUMN IF NOT EXISTS one_vote_per_unit  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS is_anonymous       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS show_live_results  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS audience           VARCHAR(20) NOT NULL DEFAULT 'all';
