import { Router } from 'express';
import { queryOne, queryRows } from '../db/queries.js';
import { success } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// -- GET /resident/home — one aggregate summary for the resident's unit ------
// Sub-queries run independently; a failed section degrades to a default and is
// logged rather than failing the whole response.

router.get('/resident/home', authenticateJWT(['resident']), async (req, res) => {
  const { community_id, unit_id } = req.user;
  const today = new Date().toISOString().slice(0, 10);

  const sections = await Promise.allSettled([
    queryOne(
      "SELECT COUNT(*)::int AS c FROM visitor_passes WHERE community_id = $1 AND unit_id = $2 AND status = 'active'",
      [community_id, unit_id]
    ),
    queryOne(
      "SELECT COUNT(*)::int AS c FROM deliveries WHERE community_id = $1 AND unit_id = $2 AND status = 'waiting'",
      [community_id, unit_id]
    ),
    queryOne(
      `SELECT COUNT(ev.id)::int AS expected,
              (COUNT(*) FILTER (WHERE ev.status = 'arrived'))::int AS arrived
         FROM recurring_passes rp
         LEFT JOIN expected_visits ev
           ON ev.recurring_pass_id = rp.id AND ev.visit_date = $3
        WHERE rp.community_id = $1 AND rp.unit_id = $2 AND rp.status = 'active'`,
      [community_id, unit_id, today]
    ),
    queryRows(
      `SELECT ge.id, ge.event_ts, ge.raw_value, ge.detection_method, ge.direction,
              ge.access_decision, ge.resident_name
         FROM gate_events ge
        WHERE ge.community_id = $1 AND ge.matched_unit_id = $2
        ORDER BY ge.event_ts DESC LIMIT 5`,
      [community_id, unit_id]
    ),
    queryRows(
      `SELECT id, period, base_amount, penalty_amount, due_date FROM dues
        WHERE community_id = $1 AND unit_id = $2 AND status = 'pending'
        ORDER BY due_date ASC NULLS LAST, created_at ASC`,
      [community_id, unit_id]
    ),
    queryOne(
      `SELECT id, title, author_name, created_at FROM notices
        WHERE community_id = $1 AND is_removed = false AND is_pinned = true AND category = 'official'
        ORDER BY last_activity_at DESC LIMIT 1`,
      [community_id]
    ),
    queryOne(
      `SELECT id, title, location, starts_at FROM events
        WHERE community_id = $1 AND is_cancelled = false AND starts_at >= NOW()
        ORDER BY starts_at ASC LIMIT 1`,
      [community_id]
    ),
  ]);

  const val = (i, fallback) => {
    if (sections[i].status === 'fulfilled') return sections[i].value;
    console.error(`[resident/home] section ${i} failed:`, sections[i].reason?.message);
    return fallback;
  };

  const visitors = val(0, null);
  const parcels = val(1, null);
  const helpers = val(2, null);
  const activity = val(3, []) || [];
  const dues = val(4, []) || [];
  const notice = val(5, null);
  const upcoming = val(6, null);

  const outstanding = Number(
    dues.reduce((s, d) => s + Number(d.base_amount || 0) + Number(d.penalty_amount || 0), 0).toFixed(2)
  );

  return success(res, {
    gateGlance: {
      visitors: { expected: visitors?.c ?? 0 },
      parcels: { pending: parcels?.c ?? 0 },
      helpers: { expected: helpers?.expected ?? 0, arrived: helpers?.arrived ?? 0 },
    },
    recentActivity: activity.map((r) => ({
      id: r.id,
      ts: r.event_ts,
      plate: r.raw_value || '',
      method: r.detection_method,
      direction: r.direction || 'entry',
      decision: r.access_decision,
      residentName: r.resident_name || '',
    })),
    dues: {
      outstanding,
      earliestDueDate: dues.length ? dues[0].due_date : null,
      pendingCount: dues.length,
    },
    community: {
      pinnedNotice: notice
        ? { id: notice.id, title: notice.title, authorName: notice.author_name, createdAt: notice.created_at }
        : null,
      upcomingEvent: upcoming ? { id: upcoming.id, title: upcoming.title, location: upcoming.location || null, startsAt: upcoming.starts_at } : null,
    },
  });
});

export default router;
