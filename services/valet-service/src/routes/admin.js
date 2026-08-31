import { asyncRouter } from '../lib/async-router.js';
import { queryOne, queryRows } from '../db.js';
import { normalizePlate } from '../lib/plate.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = asyncRouter();

/**
 * Venue-level reporting, deliberately separate from the guard's fast-path
 * ticket screens: a guard does not touch this during a live handover, it is
 * for an operator reviewing history.
 *
 * The prototype rode on the guard cookie here because it had no operator
 * accounts. It no longer needs to — this requires a real admin token, so
 * reporting across every ticket at a community is a different permission from
 * handling one car.
 */
router.get('/plate-history', authenticateJWT(['admin']), async (req, res) => {
  const normalized = normalizePlate(req.query.plate);
  if (!normalized) return res.status(400).json({ error: 'plate_required' });

  // Plate matching survives formatting differences ("KA03NJ0435" vs
  // "KA 03 NJ 0435") because write time and lookup time both run the plate
  // through the same normalizePlate().
  const rows = await queryRows(
    `SELECT t.display_id, t.plate, t.created_at, t.closed_at, t.status, t.disputed,
            cg.name AS created_guard_name
       FROM valet_tickets t
       JOIN residents cg ON cg.id = t.created_by_guard_id
      WHERE t.community_id = $1 AND t.plate_normalized = $2
      ORDER BY t.created_at DESC`,
    [req.user.community_id, normalized]
  );

  res.json({
    plate: normalized,
    communityId: req.user.community_id,
    visitCount: rows.length,
    disputedCount: rows.filter((r) => r.disputed).length,
    visits: rows.map((r) => ({
      displayId: r.display_id,
      plateAsEntered: r.plate,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      status: r.status,
      disputed: r.disputed,
      createdGuardName: r.created_guard_name,
    })),
  });
});

/**
 * Everything that came through the valet stand over a window — the view a
 * manager actually asks for ("what came in over the last 30 days"), which
 * plate-history above cannot answer because it needs a plate up front.
 *
 * Reports on `created_at`: when the car was taken in. A stay that is still
 * open counts on the day it arrived, which is what "came in last 30 days"
 * means to the person asking.
 */
router.get('/visits', authenticateJWT(['admin']), async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  // Bounded so one request cannot try to serialise a year of a busy venue.
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const rows = await queryRows(
    `SELECT t.id, t.display_id, t.plate, t.plate_normalized, t.vehicle_make,
            t.status, t.created_at, t.closed_at, t.disputed,
            cg.name AS created_guard_name,
            EXTRACT(EPOCH FROM (COALESCE(t.closed_at, NOW()) - t.created_at))::bigint AS stay_seconds
       FROM valet_tickets t
       JOIN residents cg ON cg.id = t.created_by_guard_id
      WHERE t.community_id = $1
        AND t.created_at >= NOW() - ($2 || ' days')::interval
      ORDER BY t.created_at DESC
      LIMIT $3 OFFSET $4`,
    [req.user.community_id, String(days), limit, offset]
  );

  // Totals are computed over the whole window, not the returned page — a
  // manager reading "148 visits" while looking at 200 rows of 900 would be
  // worse than no number at all.
  const totals = await queryOne(
    `SELECT COUNT(*)::int                                   AS total_visits,
            COUNT(DISTINCT plate_normalized)::int           AS unique_vehicles,
            COUNT(*) FILTER (WHERE disputed)::int           AS disputed_count,
            COUNT(*) FILTER (WHERE status NOT IN ('final_closed','expired'))::int AS open_count,
            COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(closed_at, NOW()) - created_at))), 0)::bigint AS avg_stay_seconds
       FROM valet_tickets
      WHERE community_id = $1
        AND created_at >= NOW() - ($2 || ' days')::interval`,
    [req.user.community_id, String(days)]
  );

  res.json({
    days,
    totals: {
      visits: totals?.total_visits ?? 0,
      uniqueVehicles: totals?.unique_vehicles ?? 0,
      // A vehicle seen more than once in the window. The interesting number
      // for a venue is repeat custom, not raw footfall.
      returningVehicles: Math.max(0, (totals?.total_visits ?? 0) - (totals?.unique_vehicles ?? 0)),
      disputed: totals?.disputed_count ?? 0,
      stillOpen: totals?.open_count ?? 0,
      avgStaySeconds: Number(totals?.avg_stay_seconds ?? 0),
    },
    visits: rows.map((r) => ({
      id: r.id,
      displayId: r.display_id,
      plate: r.plate,
      vehicleMake: r.vehicle_make,
      status: r.status,
      arrivedAt: r.created_at,
      closedAt: r.closed_at,
      staySeconds: Number(r.stay_seconds),
      disputed: r.disputed,
      takenInBy: r.created_guard_name,
    })),
    paging: { limit, offset, returned: rows.length },
  });
});

/**
 * Operational summary for the valet dashboard's header. Counts only, no PII.
 */
router.get('/summary', authenticateJWT(['admin', 'guard']), async (req, res) => {
  const rows = await queryRows(
    `SELECT status, COUNT(*)::int AS count
       FROM valet_tickets
      WHERE community_id = $1
      GROUP BY status`,
    [req.user.community_id]
  );

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
  const open = ['parked', 'requested', 'en_route', 'arrived', 'parked_again']
    .reduce((sum, s) => sum + (byStatus[s] || 0), 0);

  res.json({ byStatus, open });
});

export default router;
