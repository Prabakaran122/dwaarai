-- 014_notice_board.sql
-- Feature 6 (Resident App brief): Community Notice Board.
-- Two post categories:
--   'official'   — posted by admin / RWA only, pinned, residents may reply but not author.
--   'discussion' — any resident may start a thread; replies are threaded.
-- Moderation is admin-only (soft removal). No likes, media, polls, or DMs in Phase 1.

CREATE TABLE IF NOT EXISTS notices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id       UUID NOT NULL REFERENCES communities(id),
  category           VARCHAR(20) NOT NULL DEFAULT 'discussion',  -- 'official' | 'discussion'
  title              VARCHAR(200) NOT NULL,
  body               TEXT NOT NULL,
  author_resident_id UUID REFERENCES residents(id),              -- NULL for admin/RWA posts
  author_name        VARCHAR(200) NOT NULL,
  author_unit        VARCHAR(30),                                -- snapshot; NULL for RWA
  posted_by_role     VARCHAR(20) NOT NULL DEFAULT 'resident',    -- 'resident' | 'admin'
  is_pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  is_removed         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Board listing: pinned official notices first, then most-recently-active threads.
CREATE INDEX IF NOT EXISTS idx_notices_board
  ON notices(community_id, is_pinned DESC, last_activity_at DESC)
  WHERE is_removed = FALSE;

CREATE TABLE IF NOT EXISTS notice_replies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id          UUID NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  community_id       UUID NOT NULL REFERENCES communities(id),
  body               TEXT NOT NULL,
  author_resident_id UUID REFERENCES residents(id),
  author_name        VARCHAR(200) NOT NULL,
  author_unit        VARCHAR(30),
  posted_by_role     VARCHAR(20) NOT NULL DEFAULT 'resident',
  is_removed         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notice_replies_thread
  ON notice_replies(notice_id, created_at)
  WHERE is_removed = FALSE;
