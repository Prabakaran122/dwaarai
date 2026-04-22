import { Router } from 'express';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const router = Router();

// Photo upload config
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/opt/communitygate/uploads/visits';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const dir = path.join(UPLOAD_DIR, month);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, _file, cb) => {
    cb(null, `${req.params.id}.jpg`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

// -- GET /expected-visits (guard JWT) ----------------------------------------

router.get('/expected-visits', authenticateJWT(['guard']), async (req, res) => {
  try {
    const communityId = req.user.community_id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // Get all expected visits for the date, joined with pass info
    const visits = await queryRows(
      `SELECT ev.*, rp.visitor_name, rp.visitor_role, u.unit_number
       FROM expected_visits ev
       JOIN recurring_passes rp ON rp.id = ev.recurring_pass_id
       JOIN units u ON u.id = ev.unit_id
       WHERE ev.community_id = $1 AND ev.visit_date = $2
       ORDER BY ev.time_from, rp.visitor_name`,
      [communityId, date]
    );

    // Group by visitor_name_normalized + visitor_role
    const expectedMap = new Map();
    const arrivedList = [];

    for (const v of visits) {
      if (v.status === 'arrived') {
        arrivedList.push({
          visitor_name: v.visitor_name,
          visitor_role: v.visitor_role,
          unit_number: v.unit_number,
          arrived_at: v.arrived_at,
          photo_url: v.photo_url,
        });
        continue;
      }

      if (v.status !== 'expected') continue;

      const key = `${v.visitor_name_normalized}:${v.visitor_role || ''}`;
      if (!expectedMap.has(key)) {
        expectedMap.set(key, {
          id: v.id, // first visit ID (used for marking arrived)
          visitor_name: v.visitor_name,
          visitor_role: v.visitor_role,
          units: [],
          visit_ids: [],
          time_from: v.time_from,
          time_until: v.time_until,
        });
      }
      const group = expectedMap.get(key);
      group.units.push(v.unit_number);
      group.visit_ids.push(v.id);
    }

    return success(res, {
      expected: Array.from(expectedMap.values()),
      arrived: arrivedList,
    });
  } catch (err) {
    console.error('GET /expected-visits error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /expected-visits/:id/arrived (guard JWT) ---------------------------

router.post('/expected-visits/:id/arrived', authenticateJWT(['guard']), upload.single('photo'), async (req, res) => {
  try {
    const visitId = req.params.id;
    const guardId = req.user.sub;
    const communityId = req.user.community_id;

    // Find the target visit
    const visit = await queryOne(
      `SELECT ev.*, rp.visitor_name
       FROM expected_visits ev
       JOIN recurring_passes rp ON rp.id = ev.recurring_pass_id
       WHERE ev.id = $1 AND ev.community_id = $2`,
      [visitId, communityId]
    );

    if (!visit) {
      return error(res, 'Expected visit not found', 404);
    }

    // Build photo URL if uploaded
    let photoUrl = null;
    if (req.file) {
      const month = new Date().toISOString().slice(0, 7);
      photoUrl = `/uploads/visits/${month}/${visitId}.jpg`;
    }

    // Find ALL matching expected visits (same person, same day, same community)
    const matched = await queryRows(
      `SELECT ev.id, u.unit_number
       FROM expected_visits ev
       JOIN units u ON u.id = ev.unit_id
       WHERE ev.community_id = $1
         AND ev.visit_date = $2
         AND ev.visitor_name_normalized = $3
         AND ($4::varchar IS NULL OR ev.visitor_role = $4 OR ev.visitor_role IS NULL)
         AND ev.status = 'expected'`,
      [communityId, visit.visit_date, visit.visitor_name_normalized, visit.visitor_role]
    );

    // Mark all as arrived
    const ids = matched.map((m) => m.id);
    if (ids.length > 0) {
      await query(
        `UPDATE expected_visits
         SET status = 'arrived', arrived_at = NOW(), marked_by = $1, photo_url = $2
         WHERE id = ANY($3)`,
        [guardId, photoUrl, ids]
      );
    }

    return success(res, {
      marked: ids.length,
      units: matched.map((m) => m.unit_number),
      photo_url: photoUrl,
      visitor_name: visit.visitor_name,
    });
  } catch (err) {
    console.error('POST /expected-visits/:id/arrived error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
