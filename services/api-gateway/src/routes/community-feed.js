import { Router } from 'express';
import { queryOne, queryRows } from '../db/queries.js';
import { success } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { assemblePolls } from './polls.js';

const router = Router();

// Known post types for the unified feed. `discussion` is a real, existing
// domain concept (notices.category='discussion' — see migrations/014_notice_board.sql)
// but this endpoint does not query it yet: doing so would add a new
// queryRows() call, and the interleaved mock-call-order that
// src/__tests__/community.test.js already asserts for GET /community/feed
// (queryRows 1=announcements, 2=issues, queryOne 1=callerBlock, queryRows
// 3=polls, ...) is out of scope for this task to touch. Kept in the validated
// set so `?type=discussion` is accepted (and correctly returns []) rather than
// erroring, and so the union doesn't silently shrink. Follow-up: add a
// fetchDiscussions() source once that test file's call-order assertions can
// be updated alongside it.
const KNOWN_POST_TYPES = ['announcement', 'issue', 'poll', 'discussion'];

/**
 * Feed order per BRD F-01: the most recent announcement is pinned to the top
 * regardless of its age, everything else is reverse-chronological. Only ONE
 * announcement is pinned — older ones fall back into the timeline, or a society
 * that posts often would show nothing but announcements.
 */
export function orderFeed(posts) {
  const byNewest = [...posts].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  const pinIndex = byNewest.findIndex((p) => p.type === 'announcement');
  if (pinIndex <= 0) return byNewest;
  const [pinned] = byNewest.splice(pinIndex, 1);
  return [pinned, ...byNewest];
}

// A row with a null/missing createdAt is coerced to the epoch (new Date(0))
// so it sorts to the very bottom of the reverse-chronological order rather
// than producing `Invalid Date` / NaN comparisons inside orderFeed's sort.
// In practice this should never fire: created_at is NOT NULL DEFAULT NOW()
// on notices, issues, and polls (see migrations 014, 037), so this is
// defense-in-depth, not an expected path.
function safeCreatedAt(value) {
  return value == null ? new Date(0).toISOString() : value;
}

// ── GET /community/feed ───────────────────────────────────────────────────────
// Unified reverse-chronological feed (`posts`) with the newest announcement
// pinned first, PLUS the legacy `{ announcements, issues, polls }` grouped
// keys — UNCHANGED — for backward compatibility.
//
// DEPRECATED: `announcements` / `issues` / `polls` on this response. The
// Basera resident app installed on real phones today consumes this grouped
// shape; the new Community screens (a separate, later plan, see
// docs/superpowers/plans/2026-08-04-community-backend.md) will read `posts`
// instead. Once every installed client is on the new screens, delete the
// grouped keys here.
//
// Promise.allSettled degrades each section to [] on failure — never 500.

router.get('/community/feed', authenticateJWT(['resident', 'admin']), async (req, res) => {
  const { community_id, sub, unit_id } = req.user;

  const rawType = req.query.type;
  if (rawType !== undefined && !KNOWN_POST_TYPES.includes(rawType)) {
    return res.status(400).json({
      error: { message: `Invalid type filter. Must be one of: ${KNOWN_POST_TYPES.join(', ')}` },
    });
  }

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

  // ── Polls sub-query (top 5 open polls, audience-filtered) ────────────────
  // Query order within fetchPolls:
  //   queryOne  1: SELECT block_id FROM units WHERE id=$1  (caller's block)
  //   queryRows 2: polls list (audience-filtered, only open)
  //   queryRows 3: options with vote counts (only if polls found)
  //   queryRows 4: caller's votes by unit_id (only if polls found)
  async function fetchPolls() {
    // Resolve the caller's block for audience filter
    const callerBlockRow = await queryOne('SELECT block_id FROM units WHERE id=$1', [unit_id]);
    const callerBlock = callerBlockRow?.block_id || null;

    const polls = await queryRows(
      `SELECT id, question, status, closes_at, target_block_id, author_name, created_at
         FROM polls
        WHERE community_id = $1
          AND status = 'open'
          AND (closes_at IS NULL OR closes_at > NOW())
          AND (target_block_id IS NULL OR target_block_id = $2)
        ORDER BY created_at DESC
        LIMIT 5`,
      [community_id, callerBlock]
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

    // Per-unit my-votes for feed
    const myVotes = await queryRows(
      `SELECT poll_id, option_id FROM poll_votes
        WHERE poll_id = ANY($1) AND unit_id = $2`,
      [pollIds, unit_id]
    );

    // Feed shows polls without canManage (false — it's a read-only feed)
    return assemblePolls(polls, options, myVotes, false);
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

  const announcements = val(announcementsResult, 'announcements');
  const issues = val(issuesResult, 'issues');
  const polls = val(pollsResult, 'polls');

  const allPosts = [
    ...announcements.map((a) => ({ ...a, type: 'announcement', createdAt: safeCreatedAt(a.createdAt) })),
    ...issues.map((i) => ({ ...i, type: 'issue', createdAt: safeCreatedAt(i.createdAt) })),
    ...polls.map((p) => ({ ...p, type: 'poll', createdAt: safeCreatedAt(p.createdAt) })),
  ];

  const ordered = orderFeed(allPosts);
  const posts = rawType === undefined ? ordered : ordered.filter((post) => post.type === rawType);

  return success(res, {
    posts,
    // DEPRECATED — see comment above the route. Byte-identical to the
    // pre-`posts` response; do not change without also updating the Basera
    // resident app's CommunityScreen.
    announcements,
    issues,
    polls,
  });
});

export default router;
