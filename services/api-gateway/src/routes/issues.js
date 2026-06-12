import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createIssueSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  category: z.enum(['maintenance', 'security', 'amenities', 'general']).optional().default('general'),
});

const updateStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved']),
});

// ── Shape helper ──────────────────────────────────────────────────────────────

function shapeIssue(i) {
  return {
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
  };
}

// ── GET /issues ───────────────────────────────────────────────────────────────
// List community issues with upvote count and caller's upvote status.

router.get('/issues', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id, sub } = req.user;
    const rows = await queryRows(
      `SELECT i.id, i.title, i.body, i.category, i.status, i.author_name, i.author_unit, i.created_at,
              (SELECT COUNT(*) FROM issue_upvotes u WHERE u.issue_id = i.id)::int AS upvote_count,
              EXISTS(SELECT 1 FROM issue_upvotes u WHERE u.issue_id = i.id AND u.resident_id = $2) AS my_upvoted
         FROM issues i
        WHERE i.community_id = $1 AND i.is_removed = false
        ORDER BY (i.status = 'resolved') ASC, i.last_activity_at DESC
        LIMIT 100`,
      [community_id, sub]
    );
    return success(res, rows.map(shapeIssue));
  } catch (err) {
    console.error('GET /issues error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── POST /issues ──────────────────────────────────────────────────────────────
// Create a new issue; look up author's unit_number for author_unit.

router.post('/issues', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = createIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { title, body, category } = parsed.data;
    const user = req.user;

    // Look up unit number for author_unit (mirrors notices.js pattern)
    const unit = await queryOne('SELECT unit_number FROM units WHERE id = $1', [user.unit_id]);
    const authorName = user.name || 'Resident';
    const authorUnit = unit?.unit_number || null;

    const issue = await queryOne(
      `INSERT INTO issues
         (community_id, unit_id, author_resident_id, author_name, author_unit, title, body, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [user.community_id, user.unit_id, user.sub, authorName, authorUnit, title, body, category]
    );

    return success(res, { ...shapeIssue(issue), upvoteCount: 0, myUpvoted: false }, 201);
  } catch (err) {
    console.error('POST /issues error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── POST /issues/:id/upvote ───────────────────────────────────────────────────
// Toggle upvote: remove if already upvoted, add if not.

router.post('/issues/:id/upvote', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id, sub } = req.user;
    const issueId = req.params.id;

    // Query 1: verify issue exists in this community
    const issue = await queryOne(
      'SELECT id FROM issues WHERE id = $1 AND community_id = $2 AND is_removed = false',
      [issueId, community_id]
    );
    if (!issue) {
      return error(res, 'Issue not found', 404);
    }

    // Query 2: check if the caller has already upvoted
    const existing = await queryOne(
      'SELECT 1 FROM issue_upvotes WHERE issue_id = $1 AND resident_id = $2',
      [issueId, sub]
    );

    if (existing) {
      // Toggle off: delete the upvote
      await query(
        'DELETE FROM issue_upvotes WHERE issue_id = $1 AND resident_id = $2',
        [issueId, sub]
      );
      return success(res, { upvoted: false });
    } else {
      // Toggle on: insert upvote and bump last_activity_at
      await query(
        'INSERT INTO issue_upvotes (issue_id, resident_id) VALUES ($1, $2)',
        [issueId, sub]
      );
      await query(
        'UPDATE issues SET last_activity_at = NOW() WHERE id = $1',
        [issueId]
      );
      return success(res, { upvoted: true });
    }
  } catch (err) {
    console.error('POST /issues/:id/upvote error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── PUT /issues/:id/status ────────────────────────────────────────────────────
// Admin only: update the status of an issue.

router.put('/issues/:id/status', authenticateJWT(['admin']), async (req, res) => {
  try {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id } = req.user;
    const { status } = parsed.data;

    const issue = await queryOne(
      `UPDATE issues
          SET status = $1, last_activity_at = NOW()
        WHERE id = $2 AND community_id = $3 AND is_removed = false
        RETURNING id, status`,
      [status, req.params.id, community_id]
    );
    if (!issue) {
      return error(res, 'Issue not found', 404);
    }
    return success(res, { id: issue.id, status: issue.status });
  } catch (err) {
    console.error('PUT /issues/:id/status error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
