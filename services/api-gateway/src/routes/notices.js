import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { sendToMultiple } from '../lib/fcm.js';

const router = Router();

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  category: z.enum(['official', 'discussion']).optional(),
});

const replySchema = z.object({
  body: z.string().min(1).max(2000),
});

function isAdmin(user) {
  return user.role === 'admin' || user.role === 'community_admin' || user.role === 'super_admin';
}

function shapeNotice(n) {
  return {
    id: n.id,
    category: n.category,
    title: n.title,
    body: n.body,
    author_name: n.author_name,
    author_unit: n.author_unit || null,
    posted_by_role: n.posted_by_role,
    is_pinned: n.is_pinned,
    author_resident_id: n.author_resident_id || null,
    reply_count: n.reply_count !== undefined ? Number(n.reply_count) : undefined,
    created_at: n.created_at,
    last_activity_at: n.last_activity_at,
  };
}

function shapeReply(r) {
  return {
    id: r.id,
    notice_id: r.notice_id,
    body: r.body,
    author_name: r.author_name,
    author_unit: r.author_unit || null,
    posted_by_role: r.posted_by_role,
    author_resident_id: r.author_resident_id || null,
    created_at: r.created_at,
  };
}

// -- GET /notices ------------------------------------------------------------
// Board listing: pinned official notices first, then threads by recent activity.

router.get('/notices', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const rows = await queryRows(
      `SELECT n.*,
              (SELECT COUNT(*) FROM notice_replies r
                WHERE r.notice_id = n.id AND r.is_removed = false) AS reply_count
         FROM notices n
        WHERE n.community_id = $1 AND n.is_removed = false
        ORDER BY n.is_pinned DESC, n.last_activity_at DESC
        LIMIT 100`,
      [req.user.community_id]
    );
    return success(res, rows.map(shapeNotice));
  } catch (err) {
    console.error('GET /notices error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /notices/:id --------------------------------------------------------

router.get('/notices/:id', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const notice = await queryOne(
      'SELECT * FROM notices WHERE id = $1 AND community_id = $2 AND is_removed = false',
      [req.params.id, req.user.community_id]
    );
    if (!notice) {
      return error(res, 'Notice not found', 404);
    }
    const replies = await queryRows(
      `SELECT * FROM notice_replies
        WHERE notice_id = $1 AND is_removed = false
        ORDER BY created_at ASC`,
      [notice.id]
    );
    return success(res, { notice: shapeNotice(notice), replies: replies.map(shapeReply) });
  } catch (err) {
    console.error('GET /notices/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /notices -----------------------------------------------------------
// Residents may only create discussions. Admins may post official (pinned) notices.

router.post('/notices', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { title, body } = parsed.data;
    const user = req.user;
    const admin = isAdmin(user);

    // Residents are confined to discussion threads.
    const category = admin ? (parsed.data.category || 'official') : 'discussion';
    const isPinned = admin && category === 'official';

    let authorResidentId = null;
    let authorName = user.name || 'Management';
    let authorUnit = null;
    let role = 'admin';

    if (!admin) {
      role = 'resident';
      authorResidentId = user.sub;
      const unit = await queryOne('SELECT unit_number FROM units WHERE id = $1', [user.unit_id]);
      authorName = user.name || 'Resident';
      authorUnit = unit?.unit_number || null;
    }

    const notice = await queryOne(
      `INSERT INTO notices
         (community_id, category, title, body, author_resident_id, author_name, author_unit, posted_by_role, is_pinned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [user.community_id, category, title, body, authorResidentId, authorName, authorUnit, role, isPinned]
    );

    // Push for official notices only (never for every discussion thread).
    if (category === 'official') {
      try {
        const recipients = await queryRows(
          `SELECT fcm_token FROM residents
            WHERE community_id = $1 AND is_active = true AND fcm_token IS NOT NULL`,
          [user.community_id]
        );
        const tokens = recipients.map((r) => r.fcm_token).filter(Boolean);
        if (tokens.length) {
          const preview = body.length > 120 ? `${body.slice(0, 117)}...` : body;
          sendToMultiple(tokens, `📢 ${title}`, preview, {
            type: 'notice',
            notice_id: notice.id,
          }).catch((e) => console.error('[Push] notice fan-out failed:', e.message));
        }
      } catch (e) {
        console.error('[Push] notice recipient lookup failed:', e.message);
      }
    }

    return success(res, shapeNotice(notice), 201);
  } catch (err) {
    console.error('POST /notices error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /notices/:id/replies -----------------------------------------------

router.post('/notices/:id/replies', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const user = req.user;
    const admin = isAdmin(user);

    const notice = await queryOne(
      'SELECT id FROM notices WHERE id = $1 AND community_id = $2 AND is_removed = false',
      [req.params.id, user.community_id]
    );
    if (!notice) {
      return error(res, 'Notice not found', 404);
    }

    let authorResidentId = null;
    let authorName = user.name || 'Management';
    let authorUnit = null;
    let role = 'admin';
    if (!admin) {
      role = 'resident';
      authorResidentId = user.sub;
      const unit = await queryOne('SELECT unit_number FROM units WHERE id = $1', [user.unit_id]);
      authorName = user.name || 'Resident';
      authorUnit = unit?.unit_number || null;
    }

    const reply = await queryOne(
      `INSERT INTO notice_replies
         (notice_id, community_id, body, author_resident_id, author_name, author_unit, posted_by_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [notice.id, user.community_id, parsed.data.body, authorResidentId, authorName, authorUnit, role]
    );

    await query('UPDATE notices SET last_activity_at = NOW() WHERE id = $1', [notice.id]);

    return success(res, shapeReply(reply), 201);
  } catch (err) {
    console.error('POST /notices/:id/replies error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /notices/:id -----------------------------------------------------
// Admin moderation, or the resident author removing their own thread.

router.delete('/notices/:id', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const user = req.user;
    const notice = await queryOne(
      'SELECT id, author_resident_id FROM notices WHERE id = $1 AND community_id = $2 AND is_removed = false',
      [req.params.id, user.community_id]
    );
    if (!notice) {
      return error(res, 'Notice not found', 404);
    }
    if (!isAdmin(user) && notice.author_resident_id !== user.sub) {
      return error(res, 'You can only remove your own posts', 403);
    }
    await query('UPDATE notices SET is_removed = true WHERE id = $1', [notice.id]);
    return success(res, { id: notice.id, removed: true });
  } catch (err) {
    console.error('DELETE /notices/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /notices/:id/replies/:rid ----------------------------------------

router.delete('/notices/:id/replies/:rid', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const user = req.user;
    const reply = await queryOne(
      'SELECT id, author_resident_id FROM notice_replies WHERE id = $1 AND notice_id = $2 AND community_id = $3 AND is_removed = false',
      [req.params.rid, req.params.id, user.community_id]
    );
    if (!reply) {
      return error(res, 'Reply not found', 404);
    }
    if (!isAdmin(user) && reply.author_resident_id !== user.sub) {
      return error(res, 'You can only remove your own replies', 403);
    }
    await query('UPDATE notice_replies SET is_removed = true WHERE id = $1', [reply.id]);
    return success(res, { id: reply.id, removed: true });
  } catch (err) {
    console.error('DELETE /notices/:id/replies/:rid error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
