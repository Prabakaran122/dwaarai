import { Router } from 'express';
import { queryOne, queryRows } from '../db/queries.js';
import { success } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { assemblePolls } from './polls.js';
import { resolveCaller } from '../lib/committee.js';

const router = Router();

// Known post types for the unified feed. `discussion` is backed by
// notices.category='discussion' (see migrations/014_notice_board.sql) —
// residents post discussion threads via POST /notices with that category,
// same table as the pinned `official` notices fetchAnnouncements() already
// reads. fetchDiscussions() below queries the same table with the opposite
// category filter and no is_pinned/is_pinned requirement.
const KNOWN_POST_TYPES = ['announcement', 'issue', 'poll', 'discussion'];

/**
 * Feed order per BRD F-01 and F-22.
 *
 * Announcements are pinned above the regular feed regardless of age, stacked
 * newest-first, and everything else is reverse-chronological below them.
 *
 * At most MAX_PINNED_ANNOUNCEMENTS are pinned at once and the oldest unpins
 * automatically (F-22). The cap is the whole point: without it a society that
 * announces often would push every other post below the fold, which is the
 * failure mode this feed exists to avoid. Unpinned announcements are not
 * hidden — they fall back into the timeline in date order.
 */
// Words too common to describe anything. A trending list of "the, and, for"
// tells a resident nothing about what their community is discussing.
const TRENDING_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'this', 'that', 'with', 'from',
  'they', 'been', 'will', 'would', 'there', 'their', 'what', 'about', 'which',
  'when', 'your', 'said', 'each', 'she', 'him', 'his', 'how', 'its', 'who',
  'please', 'need', 'needs', 'issue', 'again', 'still', 'also', 'very', 'into',
]);

const TRENDING_WINDOW_DAYS = 7;

/**
 * Trending topics (BRD F-06): the five most-used words in post titles over the
 * past week, as tappable chips.
 *
 * Derived from titles only, not bodies — a title is what a resident chose to
 * call the thing, so it carries the topic. Short words and stopwords are
 * dropped, or the list degenerates into "the" and "for".
 */
export function trendingTopics(posts, now = Date.now()) {
  const cutoff = now - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const counts = new Map();

  for (const post of posts) {
    const created = new Date(post.createdAt).getTime();
    if (!Number.isFinite(created) || created < cutoff) continue;

    const title = post.title || post.topic || post.question || '';
    const seen = new Set(); // one post counts a word once, however often it repeats
    for (const raw of String(title).toLowerCase().match(/[a-z]{4,}/g) || []) {
      if (TRENDING_STOPWORDS.has(raw) || seen.has(raw)) continue;
      seen.add(raw);
      counts.set(raw, (counts.get(raw) || 0) + 1);
    }
  }

  return [...counts.entries()]
    // Count first; ties break alphabetically so the order is stable between
    // requests rather than depending on Map insertion order.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([term, count]) => ({ term, count }));
}

export const MAX_PINNED_ANNOUNCEMENTS = 3;

export function orderFeed(posts) {
  const byNewest = [...posts].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const pinned = [];
  const rest = [];
  for (const post of byNewest) {
    if (post.type === 'announcement' && pinned.length < MAX_PINNED_ANNOUNCEMENTS) {
      pinned.push(post);
    } else {
      rest.push(post);
    }
  }
  return [...pinned, ...rest];
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
//
// Call order (fetchAnnouncements, fetchIssues, fetchDiscussions, fetchPolls
// all start synchronously in that array order; each one's first await lands
// in the shared queryRows/queryOne mock queue in that same order — see
// src/__tests__/community.test.js and community-feed.test.js for the
// authoritative positional-mock notes):
//   queryRows 1: fetchAnnouncements notices query
//   queryRows 2: fetchIssues issues query
//   queryRows 3: fetchDiscussions notices query
//   queryOne  1: fetchPolls callerBlock lookup
//   queryRows 4: fetchPolls polls list  (+ queryRows 5, 6 for options/myVotes if non-empty)

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

  // ── Discussions sub-query (notices.category='discussion', LIMIT 10) ──────
  // Same table as fetchAnnouncements(), opposite category, no is_pinned
  // filter — discussion threads are not pinnable, they're plain
  // reverse-chronological posts like issues.
  async function fetchDiscussions() {
    const rows = await queryRows(
      `SELECT id, title, body, author_name, created_at
         FROM notices
        WHERE community_id = $1
          AND is_removed = false
          AND category = 'discussion'
        ORDER BY last_activity_at DESC
        LIMIT 10`,
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

  // ── Polls sub-query (top 5 open polls, audience-filtered) ────────────────
  // Query order within fetchPolls, relative to the other three sub-queries
  // running concurrently under Promise.allSettled (see the call-order note
  // above the router handler below):
  //   queryOne  1: SELECT block_id FROM units WHERE id=$1  (caller's block)
  //   queryRows 4: polls list (audience-filtered, only open)
  //   queryRows 5: options with vote counts (only if polls found)
  //   queryRows 6: caller's votes by unit_id (only if polls found)
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

  const [announcementsResult, issuesResult, discussionsResult, pollsResult] = await Promise.allSettled([
    fetchAnnouncements(),
    fetchIssues(),
    fetchDiscussions(),
    fetchPolls(),
  ]);

  const val = (result, label) => {
    if (result.status === 'fulfilled') return result.value;
    console.error(`[community/feed] ${label} section failed:`, result.reason?.message);
    return [];
  };

  const announcements = val(announcementsResult, 'announcements');
  const issues = val(issuesResult, 'issues');
  const discussions = val(discussionsResult, 'discussions');
  const polls = val(pollsResult, 'polls');

  const allPosts = [
    ...announcements.map((a) => ({ ...a, type: 'announcement', createdAt: safeCreatedAt(a.createdAt) })),
    ...issues.map((i) => ({ ...i, type: 'issue', createdAt: safeCreatedAt(i.createdAt) })),
    ...discussions.map((d) => ({ ...d, type: 'discussion', createdAt: safeCreatedAt(d.createdAt) })),
    ...polls.map((p) => ({ ...p, type: 'poll', createdAt: safeCreatedAt(p.createdAt) })),
  ];

  const ordered = orderFeed(allPosts);
  const posts = rawType === undefined ? ordered : ordered.filter((post) => post.type === rawType);

  // Computed after the feed sections so it cannot shift their positional
  // query order (community.test.js and community-feed.test.js both assert it).
  //
  // Degrades like every other section rather than throwing: this route's whole
  // contract is that a failing source empties one part of the feed instead of
  // 500ing all of it, and an unguarded await here would have broken that.
  // Failing closed is safe — hiding a committee control is presentation, and
  // the server authorises every write regardless of what the client renders.
  let me = { isCommittee: false, committeeRole: null };
  try {
    me = await resolveCaller(queryOne, req.user);
  } catch (err) {
    console.error('[community/feed] caller capability lookup failed:', err?.message);
  }

  return success(res, {
    posts,
    me,
    // F-06. Derived from the full ordered feed, not the filtered view, so the
    // chips stay the same whichever tab the resident is on — they are a
    // property of the community's week, not of the current filter.
    trending: trendingTopics(ordered),
    // DEPRECATED — see comment above the route. Byte-identical to the
    // pre-`posts` response; do not change without also updating the Basera
    // resident app's CommunityScreen.
    announcements,
    issues,
    polls,
  });
});

export default router;
