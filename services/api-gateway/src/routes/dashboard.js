import { Router } from 'express';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

/**
 * Everything the RWA dashboard renders, in one round trip.
 *
 * The portal used to show four bare counters from /admin/dashboard/stats with
 * no sense of trend, load, or what needs attention. This returns:
 *
 *   kpis         today vs yesterday, so every figure carries a real delta
 *   hourly       24 buckets split by decision (the shape of the day)
 *   daily        7 days, feeding the KPI sparklines
 *   methods      how people actually get in
 *   denyReasons  why they were turned away
 *   gates        live health
 *   attention    the roll-up of everything a manager should act on
 *   operations   visitors, parcels, complaints, approvals, bookings, handover
 *   flow         entries/exits/occupancy (see `trustworthy` below)
 *   finance      dues outstanding
 *   performance  time-to-open and ANPR confidence
 *   edge         offline buffer depth and panel health
 *
 * TIME ZONE: "today" is a local-calendar idea, and these are Indian
 * communities. Bucketing on UTC would roll the day over at 05:30 IST and put a
 * whole evening's traffic under tomorrow. Every bucket boundary below is
 * computed in the community's zone (default Asia/Kolkata, override with ?tz=).
 *
 * RESILIENCE: each section beyond the core gate_events queries runs through
 * `optional()`. The dashboard aggregates across a dozen feature areas, each
 * introduced by its own migration — one un-migrated table must not blank the
 * whole page.
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

    const [
      totals, hourly, daily, methods, gates, vehicles, passes, alerts,
      visits, parcels, issues, handover, flow, perf,
      approvals, dues, bookings, overstay, edgeGates, autoPaired, denyReasons,
    ] = await Promise.all([
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

      // ── Gate operations: what a guard and an RWA manager look at hourly ──
      // Each is optional — a deployment that hasn't run the migration that
      // creates the table degrades to zero rather than 500-ing the dashboard.
      optional(() => queryOne(
        `SELECT
           COUNT(*)                                        AS expected,
           COUNT(*) FILTER (WHERE arrived_at IS NOT NULL)  AS arrived
         FROM expected_visits
         WHERE community_id = $1
           AND visit_date = (NOW() AT TIME ZONE $2)::date`,
        [communityId, tz]
      ), {}),

      optional(() => queryOne(
        `SELECT COUNT(*) AS waiting FROM deliveries
         WHERE community_id = $1 AND status = 'waiting'`,
        [communityId]
      ), {}),

      optional(() => queryOne(
        `SELECT COUNT(*) AS open FROM issues
         WHERE community_id = $1 AND status <> 'resolved' AND is_removed = FALSE`,
        [communityId]
      ), {}),

      optional(() => queryOne(
        `SELECT guard_name, created_at FROM shift_handovers
         WHERE community_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [communityId]
      ), null),

      // ── Occupancy: only meaningful now that the edge stamps direction ──
      optional(() => queryOne(
        `WITH b AS (SELECT date_trunc('day', NOW() AT TIME ZONE $2) AS d0)
         SELECT
           COUNT(*) FILTER (WHERE direction = 'entry') AS entries,
           COUNT(*) FILTER (WHERE direction = 'exit')  AS exits
         FROM gate_events, b
         WHERE community_id = $1
           AND access_decision = 'allow'
           AND (event_ts AT TIME ZONE $2) >= b.d0`,
        [communityId, tz]
      ), {}),

      // ── Gate performance: columns we already write and never read ──
      optional(() => queryOne(
        `SELECT
           percentile_disc(0.5)  WITHIN GROUP (ORDER BY processing_ms) AS p50,
           percentile_disc(0.95) WITHIN GROUP (ORDER BY processing_ms) AS p95,
           COUNT(processing_ms)                                        AS sampled,
           AVG(anpr_confidence) FILTER (WHERE detection_method = 'anpr')      AS anpr_avg,
           COUNT(*) FILTER (WHERE detection_method = 'anpr'
                              AND anpr_confidence < 0.80)              AS anpr_low,
           COUNT(*) FILTER (WHERE detection_method = 'anpr')            AS anpr_total
         FROM gate_events
         WHERE community_id = $1 AND event_ts >= NOW() - INTERVAL '24 hours'`,
        [communityId]
      ), {}),

      // ── Tier 1 remainder: money, approvals, amenities ──
      optional(() => queryOne(
        `SELECT COUNT(*) AS pending FROM approval_requests
         WHERE community_id = $1 AND status = 'pending'`,
        [communityId]
      ), {}),

      optional(() => queryOne(
        `SELECT COALESCE(SUM(base_amount + penalty_amount), 0) AS outstanding,
                COUNT(*) AS unpaid_count
         FROM dues WHERE community_id = $1 AND status = 'pending'`,
        [communityId]
      ), {}),

      optional(() => queryOne(
        `SELECT COUNT(*) AS today FROM facility_bookings
         WHERE community_id = $1
           AND booking_date = (NOW() AT TIME ZONE $2)::date
           AND status <> 'cancelled'`,
        [communityId, tz]
      ), {}),

      // Visitor passes that should have expired but are still marked active —
      // the "overstay" alert every competitor's gate screen has.
      optional(() => queryOne(
        `SELECT COUNT(*) AS overstayed FROM visitor_passes
         WHERE community_id = $1 AND status = 'active' AND valid_until < NOW()`,
        [communityId]
      ), {}),

      // ── Tier 4: the edge story nothing has ever shown ──
      // Offline buffer depth and panel state, straight off the heartbeat.
      optional(() => queryRows(
        `SELECT id, name, queue_depth, uptime_s, panel, telemetry_at
         FROM gates WHERE community_id = $1 AND is_active = true`,
        [communityId]
      ), []),

      // Vehicles the platform paired to a FASTag by itself.
      optional(() => queryOne(
        `SELECT COUNT(*) AS paired FROM gate_events
         WHERE community_id = $1 AND auto_paired = TRUE
           AND event_ts >= NOW() - INTERVAL '30 days'`,
        [communityId]
      ), {}),

      // Why people are actually being turned away.
      optional(() => queryRows(
        `SELECT COALESCE(deny_reason, 'unspecified') AS reason, COUNT(*) AS count
         FROM gate_events
         WHERE community_id = $1
           AND access_decision IN ('deny', 'guard_review')
           AND event_ts >= NOW() - INTERVAL '7 days'
         GROUP BY 1 ORDER BY count DESC LIMIT 5`,
        [communityId]
      ), []),
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
        parcelsWaiting: num(parcels?.waiting),
        openIssues: num(issues?.open),
        pendingApprovals: num(approvals?.pending),
        overstayedPasses: num(overstay?.overstayed),
      },

      // What's happening at the gate right now.
      operations: {
        visitorsExpected: num(visits?.expected),
        visitorsArrived: num(visits?.arrived),
        parcelsWaiting: num(parcels?.waiting),
        openIssues: num(issues?.open),
        lastHandover: handover
          ? { guardName: handover.guard_name, at: handover.created_at }
          : null,
        pendingApprovals: num(approvals?.pending),
        bookingsToday: num(bookings?.today),
        overstayedPasses: num(overstay?.overstayed),
      },

      // Committees care about collection before anything else on this page.
      finance: {
        outstanding: Number(dues?.outstanding || 0),
        unpaidCount: num(dues?.unpaid_count),
      },

      // Offline buffer + panel health. The edge keeps deciding when the cloud
      // is unreachable; this is the only place that fact is visible.
      edge: {
        gates: (edgeGates || []).map((g) => ({
          id: g.id,
          name: g.name,
          queueDepth: g.queue_depth == null ? null : num(g.queue_depth),
          uptimeS: g.uptime_s == null ? null : num(g.uptime_s),
          panel: g.panel || null,
          telemetryAt: g.telemetry_at,
        })),
        queuedTotal: (edgeGates || []).reduce((t, g) => t + num(g.queue_depth), 0),
        autoPaired30d: num(autoPaired?.paired),
      },

      // Entries minus exits today. `inside` is only trustworthy once BOTH an
      // entry and an exit node are reporting; `exits` at zero means nothing is
      // stamping 'exit' yet, so the UI suppresses the figure rather than
      // showing a headcount that only ever climbs.
      flow: {
        entries: num(flow?.entries),
        exits: num(flow?.exits),
        inside: Math.max(num(flow?.entries) - num(flow?.exits), 0),
        trustworthy: num(flow?.exits) > 0,
      },

      // Columns the platform already writes and has never surfaced.
      performance: {
        openMsP50: perf?.p50 == null ? null : num(perf.p50),
        openMsP95: perf?.p95 == null ? null : num(perf.p95),
        sampled: num(perf?.sampled),
        anprAvgConfidence: perf?.anpr_avg == null ? null : Number(perf.anpr_avg),
        anprLowConfidence: num(perf?.anpr_low),
        anprTotal: num(perf?.anpr_total),
      },

      denyReasons: (denyReasons || []).map((r) => ({
        reason: r.reason, count: num(r.count),
      })),
    });
  } catch (err) {
    console.error('GET /admin/dashboard/summary error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * Run a query whose table may not exist yet on this deployment.
 *
 * The dashboard aggregates across a dozen feature areas, each introduced by its
 * own migration. One un-migrated table shouldn't blank the whole page, so a
 * failure degrades that section to `fallback` instead of propagating.
 */
async function optional(run, fallback) {
  try {
    return (await run()) ?? fallback;
  } catch (err) {
    console.warn('dashboard: optional section unavailable —', err.message);
    return fallback;
  }
}

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
    hourly: [], daily: [], methods: [], gates: [], denyReasons: [],
    attention: {
      gatesOffline: 0, pendingReviews: 0, activeSos: 0, openIncidents: 0,
      parcelsWaiting: 0, openIssues: 0, pendingApprovals: 0, overstayedPasses: 0,
    },
    operations: {
      visitorsExpected: 0, visitorsArrived: 0, parcelsWaiting: 0,
      openIssues: 0, lastHandover: null, pendingApprovals: 0,
      bookingsToday: 0, overstayedPasses: 0,
    },
    finance: { outstanding: 0, unpaidCount: 0 },
    edge: { gates: [], queuedTotal: 0, autoPaired30d: 0 },
    flow: { entries: 0, exits: 0, inside: 0, trustworthy: false },
    performance: {
      openMsP50: null, openMsP95: null, sampled: 0,
      anprAvgConfidence: null, anprLowConfidence: 0, anprTotal: 0,
    },
  };
}

export default router;
