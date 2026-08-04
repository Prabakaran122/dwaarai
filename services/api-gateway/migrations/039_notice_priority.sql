-- Announcement priority (BRD: announcement composer with priority levels).
-- posted_by_role already exists (see 014_notice_board.sql); nothing to add there.
ALTER TABLE notices ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal';
