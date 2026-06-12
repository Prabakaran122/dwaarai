import { Router } from 'express';
import { queryRows } from '../db/queries.js';
import { success } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { assemblePolls } from './polls.js';

const router = Router();

// ── GET /community/feed ───────────────────────────────────────────────────────
// Aggregate feed: top pinned announcements, recent issues, open polls.
// Promise.allSettled degrades each section to [] on failure — never 500.

router.get('/community/feed', authenticateJWT(['resident', 'admin']), async (req, res) => {
  const { community_id, sub } = req.user;

  // ── Announcements sub-query ───────────────────────────────────────────────
  async function fetchAnnouncements() {
    const rows = await queryRows(
      `SELECT id, title, body, author_name, created_at
         FROM notices
        WHERE community_id = $1
          AND is_removed = false
          AND is_pinned = true
          AND category = 'official'
        ORDER BY last_activity_at DESC
        LIMIT 5`,
      [community_id]
    );
    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      authorName: n.author_name,
      createdAt: n.created_at,
    }));
  }

  // ── Issues sub-query (same as GET /issues, LIMIT 10) ─────────────────────
  async function fetchIssues() {
    const rows = await queryRows(
      `SELECT i.id, i.title, i.body, i.category, i.status, i.author_name, i.author_unit, i.created_at,
              (SELECT COUNT(*) FROM issue_upvotes u WHERE u.issue_id = i.id)::int AS upvote_count,
              EXISTS(SELECT 1 FROM issue_upvotes u WHERE u.issue_id = i.id AND u.resident_id = $2) AS my_upvoted
         FROM issues i
        WHERE i.community_id = $1 AND i.is_removed = false
        ORDER BY (i.status = 'resolved') ASC, i.last_activity_at DESC
        LIMIT 10`,
      [community_id, sub]
    );
    return rows.map((i) => ({
      id: i.id,
      title: i.title,
      body: i.body,
      category: i.category,
      status: i.status,
      authorName: i.author_name,
      authorUnit: i.author_unit || null,
      upvoteCount: Number(i.upvote_count ?? 0),
      myUpvoted: Boolean(i.my_upvoted),
      createdAt: i.created_at,
    }));
  }

  // ── Polls sub-query (top 5 open polls) ───────────────────────────────────
  async function fetchPolls() {
    const polls = await queryRows(
      `SELECT id, question, status, closes_at, author_name, created_at
         FROM polls
        WHERE community_id = $1 AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 5`,
      [community_id]
    );
    if (polls.length === 0) return [];

    const pollIds = polls.map((p) => p.id);

    const options = await queryRows(
      `SELECT o.id, o.poll_id, o.label, o.position,
              (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id)::int AS votes
         FROM poll_options o
        WHERE o.poll_id = ANY($1)
        ORDER BY o.position`,
      [pollIds]
    );

    const myVotes = await queryRows(
      `SELECT poll_id, option_id FROM poll_votes
        WHERE poll_id = ANY($1) AND resident_id = $2`,
      [pollIds, sub]
    );

    return assemblePolls(polls, options, myVotes);
  }

  const [announcementsResult, issuesResult, pollsResult] = await Promise.allSettled([
    fetchAnnouncements(),
    fetchIssues(),
    fetchPolls(),
  ]);

  const val = (result, label) => {
    if (result.status === 'fulfilled') return result.value;
    console.error(`[community/feed] ${label} section failed:`, result.reason?.message);
    return [];
  };

  return success(res, {
    announcements: val(announcementsResult, 'announcements'),
    issues: val(issuesResult, 'issues'),
    polls: val(pollsResult, 'polls'),
  });
});

export default router;
