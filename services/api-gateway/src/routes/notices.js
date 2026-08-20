import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, isAdminUser } from '../middleware/auth.js';
import { canAnnounce, isGuard, roleLabel } from '../lib/committee.js';
import { sendToMultiple } from '../lib/fcm.js';
import { sendTransactionalSMS, isConfigured as smsConfigured } from '../lib/msg91.js';

const router = Router();

// Announcements are pinned, but the BRD caps the pinned stack at three and
// unpins the oldest (F-22).
export const MAX_PINNED = 3;

async function trimPinned(communityId) {
  await query(
    `UPDATE notices SET is_pinned = false
      WHERE community_id = $1 AND category = 'official' AND is_pinned = true
        AND id NOT IN (
          SELECT id FROM notices
           WHERE community_id = $1 AND category = 'official' AND is_pinned = true
           ORDER BY created_at DESC
           LIMIT ${MAX_PINNED})`,
    [communityId]
  );
}

/**
 * Deliver an announcement: push to every registered device, and for Urgent
 * also SMS. Shared by immediate posting and by the scheduled-release cron
 * (F-24) so the two can never drift on how a notice reaches people.
 *
 * Delivery failures are logged, never thrown. The announcement is the
 * product; the notification is a courtesy, and a dead MSG91 must not turn a
 * published notice into a 500.
 */
export async function publishNotice(notice) {
  const { push, sound, sms } = deliveryFor(notice.priority || 'normal');
  const preview = notice.body.length > 120 ? `${notice.body.slice(0, 117)}...` : notice.body;

  try {
    const recipients = await queryRows(
      `SELECT fcm_token FROM residents
        WHERE community_id = $1 AND is_active = true AND fcm_token IS NOT NULL`,
      [notice.community_id]
    );
    const tokens = recipients.map((r) => r.fcm_token).filter(Boolean);
    if (tokens.length) {
      await sendToMultiple(
        tokens,
        `📢 ${notice.title}`,
        preview,
        { type: 'notice', notice_id: notice.id },
        { priority: push, sound }
      );
    }
  } catch (e) {
    console.error('[Push] notice fan-out failed:', e.message);
  }

  if (!sms || !smsEnabled() || !smsConfigured()) return;

  try {
    const targets = await queryRows(
      `SELECT phone FROM residents
        WHERE community_id = $1 AND is_active = true AND phone IS NOT NULL`,
      [notice.community_id]
    );
    for (const t of targets) {
      await sendTransactionalSMS(t.phone, `${notice.title} - ${preview}`);
    }
  } catch (e) {
    console.error('[SMS] urgent announcement failed:', e.message);
  }
}

// Three priority levels (F-21). The BRD names them General / Important /
// Urgent; 'normal' is retained as the stored value for General because the
// installed Basera build sends and reads it, and 'general' is accepted as an
// input alias so a client speaking the BRD's vocabulary also works.
export const NOTICE_PRIORITIES = ['normal', 'important', 'urgent'];
export const NOTICE_PRIORITY_INPUTS = ['general', 'normal', 'important', 'urgent'];

export function normalisePriority(input) {
  return input === 'general' ? 'normal' : (input || 'normal');
}

export function isUrgent(priority) {
  return priority === 'urgent';
}

/**
 * How a tier is delivered.
 *
 * DEVIATION FROM THE BRD, approved by the product owner: the document has
 * General skip push entirely. Silently dropping notifications for the most
 * common announcement type is a worse regression than notification fatigue,
 * so General still pushes — quietly. That would leave General and Important
 * identical, so the tiers separate on push treatment instead of push-or-not.
 */
export function deliveryFor(priority) {
  switch (priority) {
    case 'urgent':    return { push: 'high',    sound: 'default', sms: true };
    case 'important': return { push: 'high',    sound: 'default', sms: false };
    default:          return { push: 'default', sound: null,      sms: false };
  }
}

// Urgent SMS reaches every resident and costs money per send, so it stays
// behind a flag that is off unless explicitly switched on.
export function smsEnabled() {
  return process.env.ANNOUNCEMENT_SMS_ENABLED === 'true';
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  category: z.enum(['official', 'discussion']).optional(),
  priority: z.enum(NOTICE_PRIORITY_INPUTS).default('normal'),
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
    priority: n.priority,
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
// Announcement composer: portal admins or resident committee members only
// (BRD: "Announcement composer, committee-only, with priority levels"). A
// portal admin's JWT `sub` is an admins.id, not a residents.id, so the
// committee lookup must be skipped entirely for admins — looking it up would
// always come back empty and 403 every portal announcement.

router.post('/notices', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { title, body } = parsed.data;
    const priority = normalisePriority(parsed.data.priority);
    const user = req.user;
    const admin = isAdminUser(user);

    // This route serves two different posts with two different permissions
    // (BRD role table): an ANNOUNCEMENT is official, pinned and committee-only,
    // while a DISCUSSION is open to any owner or tenant. Gating both on
    // committee membership would take discussion posting away from ordinary
    // residents, who can do it today.
    const category = parsed.data.category === 'discussion' ? 'discussion' : 'official';

    let authorResidentId = null;
    let authorName;
    let authorUnit = null;
    let role;

    // posted_by_role is NOT NULL (014_notice_board.sql) and its existing
    // vocabulary is 'admin' | 'resident'. The shipped Basera app compares it to
    // the literal 'admin' to render the "· RWA" badge, so those two values must
    // survive verbatim; a committee member's label is the only new value, and
    // it is additive — it simply doesn't match 'admin', which renders fine.
    if (admin) {
      authorName = user.name || 'Management';
      role = 'admin';
    } else {
      // The actor's committee role comes from the database, never the token —
      // a token issued before someone left the committee must not still work.
      const actor = await queryOne(
        `SELECT id, name, type AS resident_type, committee_role
           FROM residents WHERE id = $1 AND community_id = $2 AND is_active = true`,
        [user.sub, user.community_id]
      );
      const permitted = category === 'official'
        ? canAnnounce({ ...actor, role: user.role })
        : Boolean(actor) && !isGuard({ ...actor, role: user.role });
      if (!permitted) {
        return error(
          res,
          category === 'official'
            ? 'Only committee members can post announcements'
            : 'Only residents can start a discussion',
          403
        );
      }
      authorResidentId = actor.id;
      const unit = await queryOne('SELECT unit_number FROM units WHERE id = $1', [user.unit_id]);
      authorName = actor.name || user.name || 'Resident';
      authorUnit = unit?.unit_number || null;
      // Never null: the column rejects it, and a plain resident starting a
      // discussion has no committee label to fall back on.
      role = roleLabel(actor.committee_role) || 'resident';
    }

    const isPinned = category === 'official';

    const notice = await queryOne(
      `INSERT INTO notices
         (community_id, category, title, body, author_resident_id, author_name, author_unit, posted_by_role, is_pinned, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [user.community_id, category, title, body, authorResidentId, authorName, authorUnit, role, isPinned, priority]
    );

    // Discussions never notify; only announcements do.
    if (category === 'official') {
      await trimPinned(user.community_id);
      await publishNotice(notice);
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
