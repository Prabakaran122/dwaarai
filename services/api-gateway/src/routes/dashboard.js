import { Router } from 'express';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

/**
 * Everything the RWA dashboard renders, in one round trip.
 *
 * The portal used to show four bare counters from /admin/dashboard/stats with
 * no sense of trend, load, or what needs attention. This adds the shape of the
 * day (hourly traffic by decision), a week of history for sparklines, how
 * people are actually getting in (detection methods), live gate health, and an
 * explicit "needs attention" roll-up.
 *
 * TIME ZONE: "today" is a local-calendar idea, and these are Indian
 * communities. Bucketing on UTC would roll the day over at 05:30 IST and put a
 * whole evening's traffic under tomorrow. Every bucket boundary below is
 * computed in the community's zone (default Asia/Kolkata, override with ?tz=).
 */

const DEFAULT_TZ = 'Asia/Kolkata';

// Decisions that mean "a human should look at this" (see the edge's event
// contract in schemas/event-sync.js).
const REVIEW_DECISIONS = ['guard_review', 'alarm', 'alert'];

router.get('/admin/dashboard/summary', authenticateJWT(['admin']), async (req, res) => {
  try {
    const communityId = req.user.community_id;
    const tz = typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : DEFAULT_TZ;

    if (!communityId) {
      return success(res, emptySummary(tz));
    }

    const [totals, hourly, daily, methods, gates, vehicles, passes, alerts] = await Promise.all([
      // Today vs yesterday, so every KPI can show a real delta.
      queryOne(
        `WITH b AS (SELECT date_trunc('day', NOW() AT TIME ZONE $2) AS d0),
              e AS (
                SELECT access_decision, (event_ts AT TIME ZONE $2) AS ts_local
                FROM gate_events
                WHERE community_id = $1 AND event_ts >= NOW() - INTERVAL '3 days'
              )
         SELECT
           COUNT(e.ts_local) FILTER (WHERE e.ts_local >= b.d0) AS today_total,
           COUNT(e.ts_local) FILTER (WHERE e.ts_local >= b.d0
             AND e.access_decision = 'deny') AS today_deny,
           COUNT(e.ts_local) FILTER (WHERE e.ts_local >= b.d0
             AND e.access_decision = ANY($3)) AS today_review,
           COUNT(e.ts_local) FILTER (WHERE e.ts_local >= b.d0 - INTERVAL '1 day'
             AND e.ts_local < b.d0) AS yest_total,
           COUNT(e.ts_local) FILTER (WHERE e.ts_local >= b.d0 - INTERVAL '1 day'
             AND e.ts_local < b.d0 AND e.access_decision = 'deny') AS yest_deny,
           COUNT(e.ts_local) FILTER (WHERE e.ts_local >= b.d0 - INTERVAL '1 day'
             AND e.ts_local < b.d0 AND e.access_decision = ANY($3)) AS yest_review
         FROM b LEFT JOIN e ON TRUE`,
        [communityId, tz, REVIEW_DECISIONS]
      ),

      // 24 hourly buckets. generate_series so quiet hours are real zeroes
      // rather than gaps the chart would silently close up.
      queryRows(
        `WITH h AS (
           SELECT generate_series(
             date_trunc('hour', NOW() AT TIME ZONE $2) - INTERVAL '23 hours',
             date_trunc('hour', NOW() AT TIME ZONE $2),
             INTERVAL '1 hour') AS bucket
         ),
         e AS (
           SELECT access_decision, date_trunc('hour', event_ts AT TIME ZONE $2) AS bucket
           FROM gate_events
           WHERE community_id = $1 AND event_ts >= NOW() - INTERVAL '25 hours'
         )
         SELECT h.bucket,
           COUNT(e.access_decision) FILTER (WHERE e.access_decision = 'allow')  AS allow,
           COUNT(e.access_decision) FILTER (WHERE e.access_decision = 'deny')   AS deny,
           COUNT(e.access_decision) FILTER (WHERE e.access_decision = ANY($3))  AS review
         FROM h LEFT JOIN e ON e.bucket = h.bucket
         GROUP BY h.bucket ORDER BY h.bucket`,
        [communityId, tz, REVIEW_DECISIONS]
      ),

      // 7 days of daily totals — the KPI sparklines.
      queryRows(
        `WITH d AS (
           SELECT generate_series(
             date_trunc('day', NOW() AT TIME ZONE $2) - INTERVAL '6 days',
             date_trunc('day', NOW() AT TIME ZONE $2),
             INTERVAL '1 day') AS bucket
         ),
         e AS (
           SELECT access_decision, date_trunc('day', event_ts AT TIME ZONE $2) AS bucket
           FROM gate_events
           WHERE community_id = $1 AND event_ts >= NOW() - INTERVAL '8 days'
         )
         SELECT d.bucket,
           COUNT(e.access_decision)                                            AS total,
           COUNT(e.access_decision) FILTER (WHERE e.access_decision = 'deny')  AS deny,
           COUNT(e.access_decision) FILTER (WHERE e.access_decision = ANY($3)) AS review
         FROM d LEFT JOIN e ON e.bucket = d.bucket
         GROUP BY d.bucket ORDER BY d.bucket`,
        [communityId, tz, REVIEW_DECISIONS]
      ),

      // How people actually get in, over the last 7 days.
      queryRows(
        `SELECT detection_method AS method, COUNT(*) AS count
         FROM gate_events
         WHERE community_id = $1 AND event_ts >= NOW() - INTERVAL '7 days'
         GROUP BY detection_method
         ORDER BY count DESC
         LIMIT 8`,
        [communityId]
      ),

      queryRows(
        `SELECT id, name, status, last_seen, type
         FROM gates WHERE community_id = $1 AND is_active = true ORDER BY name`,
        [communityId]
      ),

      queryOne(
        'SELECT COUNT(*) AS count FROM vehicles WHERE community_id = $1 AND is_active = true',
        [communityId]
      ),

      queryOne(
        `SELECT COUNT(*) AS count FROM visitor_passes
         WHERE community_id = $1 AND status = 'active' AND valid_until > NOW()`,
        [communityId]
      ),

      // SOS and incidents arrived in migrations 018/021. A portal shouldn't
      // 500 because a deployment hasn't run them yet.
      countAlerts(communityId),
    ]);

    const num = (v) => parseInt(v || 0, 10);
    const gatesOnline = gates.filter((g) => g.status === 'online').length;

    return success(res, {
      tz,
      generatedAt: new Date().toISOString(),
      kpis: {
        todayEntries: { value: num(totals?.today_total), prev: num(totals?.yest_total) },
        deniedToday: { value: num(totals?.today_deny), prev: num(totals?.yest_deny) },
        reviewToday: { value: num(totals?.today_review), prev: num(totals?.yest_review) },
        totalVehicles: { value: num(vehicles?.count) },
        activePasses: { value: num(passes?.count) },
        gatesOnline: { value: gatesOnline, total: gates.length },
      },
      hourly: hourly.map((r) => ({
        bucket: r.bucket,
        allow: num(r.allow),
        deny: num(r.deny),
        review: num(r.review),
      })),
      daily: daily.map((r) => ({
        bucket: r.bucket,
        total: num(r.total),
        deny: num(r.deny),
        review: num(r.review),
      })),
      methods: methods.map((r) => ({ method: r.method, count: num(r.count) })),
      gates: gates.map((g) => ({
        id: g.id, name: g.name, status: g.status, type: g.type, lastSeen: g.last_seen,
      })),
      attention: {
        gatesOffline: gates.length - gatesOnline,
        pendingReviews: num(totals?.today_review),
        activeSos: alerts.sos,
        openIncidents: alerts.incidents,
      },
    });
  } catch (err) {
    console.error('GET /admin/dashboard/summary error:', err);
    return error(res, 'Internal server error', 500);
  }
});

async function countAlerts(communityId) {
  const safeCount = async (sql) => {
    try {
      const row = await queryOne(sql, [communityId]);
      return parseInt(row?.count || 0, 10);
    } catch {
      return 0;   // table not migrated yet
    }
  };
  const [sos, incidents] = await Promise.all([
    safeCount("SELECT COUNT(*) AS count FROM sos_alerts WHERE community_id = $1 AND status = 'active'"),
    safeCount("SELECT COUNT(*) AS count FROM incidents WHERE community_id = $1 AND status = 'open'"),
  ]);
  return { sos, incidents };
}

function emptySummary(tz) {
  return {
    tz,
    generatedAt: new Date().toISOString(),
    kpis: {
      todayEntries: { value: 0, prev: 0 },
      deniedToday: { value: 0, prev: 0 },
      reviewToday: { value: 0, prev: 0 },
      totalVehicles: { value: 0 },
      activePasses: { value: 0 },
      gatesOnline: { value: 0, total: 0 },
    },
    hourly: [], daily: [], methods: [], gates: [],
    attention: { gatesOffline: 0, pendingReviews: 0, activeSos: 0, openIncidents: 0 },
  };
}

export default router;
