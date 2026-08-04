import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, isAdminUser } from '../middleware/auth.js';
import pool from '../db/pool.js';
import { canChangeStatus, canPostIssue, isCommittee, isGuard, roleLabel } from '../lib/committee.js';
import { allocateReference } from '../lib/issue-reference.js';
import { sendToMultiple } from '../lib/fcm.js';

const router = Router();

// Photo uploads, matching the incidents pattern (services/api-gateway/src/routes/incidents.js).
const UPLOAD_BASE = process.env.UPLOAD_DIR || '/opt/communitygate/uploads';

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createIssueSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  category: z.enum(['maintenance', 'security', 'amenities', 'general']).optional().default('general'),
});

const updateStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved']),
  assignee_name: z.string().max(200).optional(),
});

// open -> in_progress -> resolved, and nothing else. The BRD is explicit that
// there are no backwards transitions: a resolved issue that recurs is a new
// issue, so the original's audit trail stays true.
const STATUS_ORDER = ['open', 'in_progress', 'resolved'];

export function nextStatusIsValid(from, to) {
  const i = STATUS_ORDER.indexOf(from);
  const j = STATUS_ORDER.indexOf(to);
  return i !== -1 && j !== -1 && j === i + 1;
}

// Issue references are stamped IQ-<year>-NNN by calendar year. The server
// runs UTC, but this is an Indian product: an issue reported at 05:15 IST on
// 1 Jan is 23:45 UTC on 31 Dec, so the year must be read in Asia/Kolkata or
// it would be filed under the previous year's sequence.
function istYear(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(date)
  );
}

// The count at which an issue is treated as a community-wide concern. Crossing
// it writes a system timeline entry, which is what turns a pile of upvotes
// into visible pressure on the RWA.
export const UPVOTE_THRESHOLD = 20;

export function crossedThreshold(before, after) {
  return before < UPVOTE_THRESHOLD && after >= UPVOTE_THRESHOLD;
}

// Up to 5 photos per issue (BRD). remainingPhotoSlots never goes negative so
// callers can compare an upload's file count directly against it.
export const MAX_ISSUE_PHOTOS = 5;

export function remainingPhotoSlots(existingCount) {
  return Math.max(0, MAX_ISSUE_PHOTOS - existingCount);
}

// ── Resolve notification ─────────────────────────────────────────────────────
// Fired once per issue, on the transition INTO 'resolved' (forward-only
// transitions mean that's the only time it can happen). Dispatched strictly
// after the status-change transaction COMMITs: the status change is the
// source of truth, so a failed or slow notification must never roll it back,
// change the response, or throw out of the request handler.

// Pure and exported so the dedup rule (reporter vs. upvoters) is unit-testable
// without touching the database.
export function resolveNotificationTargets(reporterId, upvoterIds) {
  return [...new Set([reporterId, ...upvoterIds].filter(Boolean))];
}

// Looks up FCM tokens for the target ids, scoped to active residents of the
// community and excluding guards (guards read the feed but are never a
// notification target). The resident app has no deep-link scheme yet, so the
// payload carries issueId + reference for a future handler to route on.
async function notifyIssueResolved({ issueId, communityId, authorResidentId, reference, title }) {
  const upvoters = await queryRows(
    'SELECT resident_id FROM issue_upvotes WHERE issue_id = $1',
    [issueId]
  );
  const targetIds = resolveNotificationTargets(authorResidentId, upvoters.map((u) => u.resident_id));
  if (!targetIds.length) return;

  const residents = await queryRows(
    `SELECT id, fcm_token, type AS resident_type
       FROM residents
      WHERE id = ANY($1::uuid[]) AND community_id = $2 AND is_active = true`,
    [targetIds, communityId]
  );
  const tokens = residents.filter((r) => !isGuard(r) && r.fcm_token).map((r) => r.fcm_token);
  if (!tokens.length) return;

  const label = reference || issueId;
  await sendToMultiple(
    tokens,
    'Issue resolved',
    `${label} — ${title || 'Your issue'} has been marked resolved.`,
    { type: 'issue_resolved', issueId, reference: reference || null }
  );
}

// ── Shape helper ──────────────────────────────────────────────────────────────

// Never SELECT * onto the wire: is_removed and author_resident_id are internal
// and must not leak to the client.
function shapeIssue(i) {
  return {
    id: i.id,
    title: i.title,
    body: i.body,
    category: i.category,
    status: i.status,
    authorName: i.author_name,
    authorUnit: i.author_unit || null,
    reference: i.reference ?? null,
    assigneeName: i.assignee_name ?? null,
    resolvedAt: i.resolved_at ?? null,
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

// Reporting is a resident action (owners + committee); portal admins have no
// residents row so canPostIssue({}) correctly rejects them with 403. Reference
// allocation and the opening timeline row share the same transaction as the
// issue INSERT, so a rolled-back issue never burns (or keeps) a number.
router.post('/issues', authenticateJWT(['resident', 'admin']), async (req, res) => {
  const client = await pool.connect();
  try {
    const parsed = createIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { title, body, category } = parsed.data;
    const user = req.user;

    // The actor's committee role and resident type come from the database,
    // never the token. canPostIssue rejects tenants and admins server-side.
    const actor = await queryOne(
      `SELECT id, name, type AS resident_type, committee_role
         FROM residents WHERE id = $1 AND community_id = $2 AND is_active = true`,
      [user.sub, user.community_id]
    );
    if (!canPostIssue({ ...actor, role: user.role })) {
      return error(res, 'Only owners and committee members can report issues', 403);
    }

    // Look up unit number for author_unit (mirrors notices.js pattern)
    const unit = await queryOne('SELECT unit_number FROM units WHERE id = $1', [user.unit_id]);
    const authorName = user.name || 'Resident';
    const authorUnit = unit?.unit_number || null;

    await client.query('BEGIN');
    const reference = await allocateReference(client, user.community_id, istYear());

    const insertResult = await client.query(
      `INSERT INTO issues
         (community_id, unit_id, author_resident_id, author_name, author_unit, title, body, category, reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [user.community_id, user.unit_id, user.sub, authorName, authorUnit, title, body, category, reference]
    );
    const issue = insertResult.rows[0];

    // Same transaction as the INSERT: an issue without its opening timeline
    // row is exactly the gap this feature exists to close. Insert-only.
    await client.query(
      `INSERT INTO issue_status_events
         (issue_id, community_id, from_status, to_status,
          changed_by_resident_id, changed_by_name, changed_by_role, kind, detail)
       VALUES ($1,$2,NULL,'open',$3,$4,$5,'status_change','Issue reported')`,
      [issue.id, user.community_id, actor.id, actor.name, roleLabel(actor.committee_role) || null]
    );
    await client.query('COMMIT');

    return success(res, { ...shapeIssue(issue), upvoteCount: 0, myUpvoted: false, reference: issue.reference }, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /issues error:', err);
    return error(res, 'Internal server error', 500);
  } finally {
    client.release();
  }
});

// ── POST /issues/:id/upvote ───────────────────────────────────────────────────
// Toggle upvote: remove if already upvoted, add if not.

// Locking the issues row for the duration of the upvote, recount and threshold
// check is what makes the crossing detection correct under concurrency: two
// residents upvoting at once would otherwise both read the same "before"
// count and either double-write the system entry or miss the crossing
// entirely (see crossedThreshold above).
router.post('/issues/:id/upvote', authenticateJWT(['resident', 'admin']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { community_id, sub } = req.user;
    const issueId = req.params.id;

    await client.query('BEGIN');

    const issueResult = await client.query(
      `SELECT id FROM issues
        WHERE id = $1 AND community_id = $2 AND is_removed = false FOR UPDATE`,
      [issueId, community_id]
    );
    if (!issueResult.rows.length) {
      await client.query('ROLLBACK');
      return error(res, 'Issue not found', 404);
    }

    const existing = await client.query(
      'SELECT 1 FROM issue_upvotes WHERE issue_id = $1 AND resident_id = $2',
      [issueId, sub]
    );

    let upvoted;
    if (existing.rows.length) {
      await client.query(
        'DELETE FROM issue_upvotes WHERE issue_id = $1 AND resident_id = $2',
        [issueId, sub]
      );
      upvoted = false;
    } else {
      await client.query(
        'INSERT INTO issue_upvotes (issue_id, resident_id) VALUES ($1, $2)',
        [issueId, sub]
      );
      await client.query('UPDATE issues SET last_activity_at = NOW() WHERE id = $1', [issueId]);
      upvoted = true;
    }

    // Recount under the same lock, then test the crossing before COMMIT.
    const countResult = await client.query(
      'SELECT COUNT(*)::int AS n FROM issue_upvotes WHERE issue_id = $1',
      [issueId]
    );
    const after = countResult.rows[0].n;
    const before = upvoted ? after - 1 : after + 1;

    if (crossedThreshold(before, after)) {
      // Upvotes toggle, so the count can fall below the threshold and cross it
      // again later — WHERE NOT EXISTS enforces at most one system entry per
      // issue, ever, as a single atomic statement rather than a read-then-decide
      // that would itself race under concurrent upvotes.
      //
      // INVARIANT: the threshold entry is currently the ONLY kind='system' row
      // anyone writes, which is the only reason this predicate can identify it
      // by kind alone. Anything that adds a second sort of system entry (issue
      // auto-closed, issue merged) must give it a distinct `kind` AND narrow
      // this predicate — otherwise the first such row silently suppresses the
      // threshold entry forever, and no test would catch it.
      await client.query(
        `INSERT INTO issue_status_events (issue_id, community_id, kind, detail)
         SELECT $1, $2, 'system', $3
          WHERE NOT EXISTS (
            SELECT 1 FROM issue_status_events WHERE issue_id = $1 AND kind = 'system'
          )`,
        [issueId, community_id, `${after} residents affected — community upvote threshold crossed`]
      );
    }

    await client.query('COMMIT');
    return success(res, { upvoted });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /issues/:id/upvote error:', err);
    return error(res, 'Internal server error', 500);
  } finally {
    client.release();
  }
});

// ── PUT /issues/:id/status ────────────────────────────────────────────────────
// Both portal admins and resident committee members may change issue status.
// Forward-only transitions; every change writes an immutable timeline row in
// the same transaction as the status update.

router.put('/issues/:id/status', authenticateJWT(['resident', 'admin']), async (req, res) => {
  const client = await pool.connect();
  try {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id } = req.user;
    const { status } = parsed.data;

    // Portal admins skip the residents lookup entirely — an admin token's
    // `sub` is an admins.id, not a residents.id, so looking it up there would
    // always come back empty and incorrectly lock admins out.
    let changedByResidentId;
    let changedByName;
    let changedByRole;

    if (isAdminUser(req.user)) {
      changedByResidentId = null;
      changedByName = req.user.name || 'Admin';
      changedByRole = 'Admin';
    } else {
      // The actor's committee role comes from the database, never the token —
      // a token issued before someone left the committee must not still work.
      const actor = await queryOne(
        `SELECT id, name, type AS resident_type, committee_role
           FROM residents WHERE id = $1 AND community_id = $2 AND is_active = true`,
        [req.user.sub, community_id]
      );
      if (!canChangeStatus({ ...actor, role: req.user.role })) {
        return error(res, 'Only committee members can change issue status', 403);
      }
      changedByResidentId = actor.id;
      changedByName = actor.name;
      changedByRole = roleLabel(actor.committee_role);
    }

    await client.query('BEGIN');
    // Lock the row so two committee members cannot race the same transition.
    // author_resident_id/reference/title are read here (not in a second query
    // after COMMIT) so the resolve-notification dispatch below sees exactly
    // the row this transaction locked, not one that changed underneath it.
    const current = await client.query(
      `SELECT id, status, author_resident_id, reference, title FROM issues
        WHERE id = $1 AND community_id = $2 AND is_removed = false FOR UPDATE`,
      [req.params.id, community_id]
    );
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return error(res, 'Issue not found', 404);
    }
    const issueRow = current.rows[0];
    const from = issueRow.status;
    if (!nextStatusIsValid(from, status)) {
      await client.query('ROLLBACK');
      return error(res, `Cannot move an issue from ${from} to ${status}`, 422);
    }

    await client.query(
      `UPDATE issues
          SET status = $1, last_activity_at = NOW(),
              assignee_name = COALESCE($2, assignee_name),
              resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
        WHERE id = $3 AND community_id = $4`,
      [status, parsed.data.assignee_name || null, req.params.id, community_id]
    );

    // Same transaction as the update: a status change without its timeline row
    // is exactly the gap this feature exists to close. Insert-only — nothing
    // in this route (or anywhere else) may UPDATE or DELETE this table.
    await client.query(
      `INSERT INTO issue_status_events
         (issue_id, community_id, from_status, to_status,
          changed_by_resident_id, changed_by_name, changed_by_role, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'status_change')`,
      [req.params.id, community_id, from, status,
       changedByResidentId, changedByName, changedByRole]
    );
    await client.query('COMMIT');

    // Only on the transition INTO 'resolved', and strictly after COMMIT — see
    // notifyIssueResolved above for why. Never let this affect the response.
    if (status === 'resolved') {
      try {
        await notifyIssueResolved({
          issueId: req.params.id,
          communityId: community_id,
          authorResidentId: issueRow.author_resident_id,
          reference: issueRow.reference,
          title: issueRow.title,
        });
      } catch (notifyErr) {
        console.error('[issues] resolve notification failed:', notifyErr.message);
      }
    }

    return success(res, { id: req.params.id, status, from });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('PUT /issues/:id/status error:', err);
    return error(res, 'Internal server error', 500);
  } finally {
    client.release();
  }
});

// ── GET /issues/:id ───────────────────────────────────────────────────────────
// Post, photos, timeline and replies in one call. Explicitly shaped — never
// SELECT * — so internal columns (is_removed, author_resident_id) never leak.

router.get('/issues/:id', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id, sub } = req.user;
    const issue = await queryOne(
      `SELECT id, title, body, category, status, author_name, author_unit,
              reference, assignee_name, resolved_at, created_at
         FROM issues WHERE id = $1 AND community_id = $2 AND is_removed = false`,
      [req.params.id, community_id]
    );
    if (!issue) return error(res, 'Issue not found', 404);

    const [photos, timeline, replies, counts] = await Promise.all([
      queryRows('SELECT id, path, position FROM issue_photos WHERE issue_id = $1 ORDER BY position', [issue.id]),
      queryRows(
        `SELECT from_status, to_status, changed_by_name, changed_by_role, kind, detail, created_at
           FROM issue_status_events WHERE issue_id = $1 ORDER BY created_at`, [issue.id]),
      queryRows(
        `SELECT id, author_name, author_unit, author_role, body, is_official, created_at
           FROM issue_replies WHERE issue_id = $1 AND is_removed = false ORDER BY created_at`, [issue.id]),
      queryOne(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE resident_id = $2)::int AS mine
           FROM issue_upvotes WHERE issue_id = $1`, [issue.id, sub]),
    ]);

    const upvoteCount = counts?.total ?? 0;
    const myUpvoted = (counts?.mine ?? 0) > 0;

    return success(res, {
      issue: shapeIssue({ ...issue, upvote_count: upvoteCount, my_upvoted: myUpvoted }),
      photos,
      timeline,
      replies,
      upvoteCount,
      myUpvoted,
    });
  } catch (err) {
    console.error('GET /issues/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── POST /issues/:id/replies ──────────────────────────────────────────────────
// Committee replies are flagged official at write time, so the flag reflects
// the author's standing when they wrote it, not who they are now.

router.post('/issues/:id/replies', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = z.object({ body: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return error(res, 'Validation error', 400, parsed.error.issues);

    const { community_id } = req.user;

    // Must exist, be in the caller's community, and not be removed — otherwise
    // a reply can be attached to another community's issue or a hidden one.
    const issue = await queryOne(
      `SELECT id FROM issues WHERE id = $1 AND community_id = $2 AND is_removed = false`,
      [req.params.id, community_id]
    );
    if (!issue) return error(res, 'Issue not found', 404);

    const actor = await queryOne(
      `SELECT id, name, committee_role,
              (SELECT unit_number FROM units WHERE id = residents.unit_id) AS unit
         FROM residents WHERE id = $1 AND community_id = $2 AND is_active = true`,
      [req.user.sub, community_id]
    );
    if (!actor) return error(res, 'Resident not found', 404);

    const official = isCommittee(actor);
    const row = await queryOne(
      `INSERT INTO issue_replies
         (issue_id, community_id, author_resident_id, author_name, author_unit,
          author_role, body, is_official)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, author_name, author_unit, author_role, body, is_official, created_at`,
      [req.params.id, community_id, actor.id, actor.name, actor.unit,
       roleLabel(actor.committee_role) || null, parsed.data.body, official]
    );
    await query('UPDATE issues SET last_activity_at = NOW() WHERE id = $1', [req.params.id]);
    return success(res, row, 201);
  } catch (err) {
    console.error('POST /issues/:id/replies error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── POST /issues/:id/photos ───────────────────────────────────────────────────
// Multer writes files to disk before this handler runs (Express 4 multipart
// parsing), so every rejection path below unlinks req.files — a 403/404/422/500
// must never orphan an already-written file. The cap check is count-and-insert
// in one transaction with the issue row locked (FOR UPDATE), so two concurrent
// uploads cannot both see room for photos that only one of them can have.

const issueStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const month = new Date().toISOString().slice(0, 7);
    const dir = path.join(UPLOAD_BASE, 'issues', month);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, _file, cb) => {
    cb(null, `${uuidv4()}.jpg`);
  },
});
const uploadIssuePhotos = multer({
  storage: issueStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_ISSUE_PHOTOS },
  fileFilter: (_req, file, cb) => cb(null, /jpeg|jpg|png|heic/i.test(file.mimetype)),
});

async function unlinkAll(files) {
  await Promise.all((files || []).map((f) => unlink(f.path).catch(() => {})));
}

router.post('/issues/:id/photos', authenticateJWT(['resident', 'admin']),
  uploadIssuePhotos.array('photos', MAX_ISSUE_PHOTOS), async (req, res) => {
    const client = await pool.connect();
    try {
      const { community_id, sub } = req.user;

      await client.query('BEGIN');

      const issueResult = await client.query(
        `SELECT id, author_resident_id FROM issues
          WHERE id = $1 AND community_id = $2 AND is_removed = false FOR UPDATE`,
        [req.params.id, community_id]
      );
      if (!issueResult.rows.length) {
        await client.query('ROLLBACK');
        await unlinkAll(req.files);
        return error(res, 'Issue not found', 404);
      }
      const issue = issueResult.rows[0];

      // The actor's committee role comes from the database, never the token.
      const actorResult = await client.query(
        `SELECT committee_role FROM residents WHERE id = $1 AND community_id = $2 AND is_active = true`,
        [sub, community_id]
      );
      const actor = actorResult.rows[0] || null;
      const isAuthor = issue.author_resident_id === sub;
      if (!isAuthor && !isCommittee(actor)) {
        await client.query('ROLLBACK');
        await unlinkAll(req.files);
        return error(res, 'Only the issue author or a committee member can attach photos', 403);
      }

      // Count and insert in the same transaction, under the row lock taken
      // above — otherwise two concurrent uploads of, say, three photos each
      // can both see room for three and land six.
      const countResult = await client.query(
        'SELECT COUNT(*)::int AS n FROM issue_photos WHERE issue_id = $1',
        [req.params.id]
      );
      const existingCount = countResult.rows[0].n;
      const slots = remainingPhotoSlots(existingCount);
      const files = req.files || [];
      if (files.length > slots) {
        await client.query('ROLLBACK');
        await unlinkAll(req.files);
        return error(res, `This issue can take ${slots} more photo(s)`, 422);
      }

      const month = new Date().toISOString().slice(0, 7);
      const inserted = [];
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const filePath = `/uploads/issues/${month}/${file.filename}`;
        const insertResult = await client.query(
          `INSERT INTO issue_photos (issue_id, path, position)
           VALUES ($1, $2, $3) RETURNING id, path, position`,
          [req.params.id, filePath, existingCount + idx]
        );
        inserted.push(insertResult.rows[0]);
      }
      await client.query('UPDATE issues SET last_activity_at = NOW() WHERE id = $1', [req.params.id]);
      await client.query('COMMIT');

      return success(res, inserted, 201);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      await unlinkAll(req.files);
      console.error('POST /issues/:id/photos error:', err);
      return error(res, 'Internal server error', 500);
    } finally {
      client.release();
    }
  });

export default router;
