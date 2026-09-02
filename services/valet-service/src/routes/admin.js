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

// ─────────────────────────────────────────────────────────────────────────────
// Printed card stock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The venue's box of printed cards, each with the ticket it is currently on.
 *
 * Registering stock is an operator job, not a guard one: a guard scans a card
 * that already exists, and letting the intake path create unknown codes on the
 * fly would mean a mis-scan silently invents a card that matches nothing
 * printed.
 */
router.get('/cards', authenticateJWT(['admin']), async (req, res) => {
  const rows = await queryRows(
    `SELECT c.id, c.code, c.is_active, c.created_at,
            t.display_id, t.plate, t.status
       FROM valet_cards c
       LEFT JOIN valet_tickets t
         ON t.card_id = c.id
        AND t.status NOT IN ('final_closed', 'expired')
      WHERE c.community_id = $1
      ORDER BY c.code`,
    [req.user.community_id]
  );

  res.json({
    cards: rows.map((r) => ({
      id: r.id,
      code: r.code,
      isActive: r.is_active,
      createdAt: r.created_at,
      // Null means the card is in the stack, ready to hand out.
      inUseBy: r.display_id
        ? { displayId: r.display_id, plate: r.plate, status: r.status }
        : null,
    })),
  });
});

/**
 * Registers printed cards, either as an explicit list or as a range.
 *
 * A range exists because stock is printed in runs — nobody types A001..A100
 * one at a time, and making them do it guarantees gaps that only surface when
 * a guard scans a card the system has never heard of, mid-handover.
 *
 * Re-registering an existing code is not an error. Ordering another box that
 * overlaps the last one is normal, and failing the whole request over codes
 * that are already correct would leave the operator diffing lists by hand.
 */
router.post('/cards', authenticateJWT(['admin']), async (req, res) => {
  const communityId = req.user.community_id;
  let codes = [];

  if (Array.isArray(req.body.codes)) {
    codes = req.body.codes;
  } else if (req.body.prefix !== undefined || req.body.from !== undefined) {
    const prefix = String(req.body.prefix ?? '').trim().toUpperCase();
    const from = Number(req.body.from);
    const to = Number(req.body.to);
    const width = Number(req.body.width ?? 3);

    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      return res.status(400).json({ error: 'invalid_range', message: 'from and to must be whole numbers, with to no smaller than from' });
    }
    // A slip in the range field should not mint ten thousand cards nobody
    // printed; a venue's whole stock is tens, not thousands.
    if (to - from + 1 > 500) {
      return res.status(400).json({ error: 'range_too_large', message: 'Register at most 500 cards at once' });
    }
    if (!Number.isInteger(width) || width < 1 || width > 6) {
      return res.status(400).json({ error: 'invalid_width', message: 'width must be between 1 and 6' });
    }
    for (let n = from; n <= to; n += 1) {
      codes.push(`${prefix}${String(n).padStart(width, '0')}`);
    }
  } else {
    return res.status(400).json({ error: 'codes_required', message: 'Provide codes, or a prefix with from and to' });
  }

  const cleaned = [...new Set(
    codes.map((c) => String(c ?? '').trim().toUpperCase()).filter(Boolean)
  )];
  if (!cleaned.length) return res.status(400).json({ error: 'codes_required' });
  if (cleaned.some((c) => c.length > 20)) {
    return res.status(400).json({ error: 'code_too_long', message: 'A card code is at most 20 characters' });
  }
  if (cleaned.length > 500) {
    return res.status(400).json({ error: 'range_too_large', message: 'Register at most 500 cards at once' });
  }

  const existing = await queryRows(
    'SELECT code FROM valet_cards WHERE community_id = $1 AND code = ANY($2)',
    [communityId, cleaned]
  );
  const already = new Set(existing.map((r) => r.code));
  const toAdd = cleaned.filter((c) => !already.has(c));

  if (toAdd.length) {
    const values = toAdd.map((_, i) => `($1, $${i + 2})`).join(',');
    await queryRows(
      `INSERT INTO valet_cards (community_id, code) VALUES ${values}
       ON CONFLICT (community_id, code) DO NOTHING`,
      [communityId, ...toAdd]
    );
  }

  res.status(201).json({ added: toAdd, skipped: [...already], total: cleaned.length });
});

/**
 * Retires a card — lost, or physically destroyed.
 *
 * Deactivating rather than deleting, because the card is referenced by every
 * ticket it has ever been on and that history is the point of the audit trail.
 * A card currently on an open ticket cannot be retired: the guest is still
 * holding it, and freeing it here would let the same code be handed to someone
 * else while the first vehicle is still parked.
 */
router.post('/cards/:id/deactivate', authenticateJWT(['admin']), async (req, res) => {
  const card = await queryOne(
    'SELECT id FROM valet_cards WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id]
  );
  if (!card) return res.status(404).json({ error: 'card_not_found' });

  const open = await queryOne(
    `SELECT display_id FROM valet_tickets
      WHERE card_id = $1 AND status NOT IN ('final_closed', 'expired') LIMIT 1`,
    [card.id]
  );
  if (open) {
    return res.status(409).json({
      error: 'card_in_use',
      message: `Card is on ticket ${open.display_id}. Check that vehicle out first.`,
    });
  }

  await queryRows('UPDATE valet_cards SET is_active = false WHERE id = $1', [card.id]);
  res.json({ id: card.id, isActive: false });
});

/** Puts a retired card back into circulation — it turned up again. */
router.post('/cards/:id/activate', authenticateJWT(['admin']), async (req, res) => {
  const card = await queryOne(
    'SELECT id FROM valet_cards WHERE id = $1 AND community_id = $2',
    [req.params.id, req.user.community_id]
  );
  if (!card) return res.status(404).json({ error: 'card_not_found' });

  await queryRows('UPDATE valet_cards SET is_active = true WHERE id = $1', [card.id]);
  res.json({ id: card.id, isActive: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plate search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds vehicles by any part of the plate, open or closed.
 *
 * Distinct from /plate-history, which needs the whole plate and reports on one
 * vehicle across visits. This is the "guest is standing here and only knows
 * the last four digits" case, and it is why the match is a substring rather
 * than a prefix.
 */
router.get('/tickets/search', authenticateJWT(['admin']), async (req, res) => {
  const q = normalizePlate(req.query.plate);
  if (q.length < 3) return res.json({ tickets: [], query: q });

  const rows = await queryRows(
    `SELECT t.display_id, t.session_token, t.plate, t.vehicle_make, t.status,
            t.created_at, t.closed_at, t.disputed, t.card_code,
            cg.name AS created_guard_name
       FROM valet_tickets t
       JOIN residents cg ON cg.id = t.created_by_guard_id
      WHERE t.community_id = $1
        AND t.plate_normalized LIKE '%' || $2 || '%'
      ORDER BY (t.status NOT IN ('final_closed','expired')) DESC, t.created_at DESC
      LIMIT 50`,
    [req.user.community_id, q]
  );

  res.json({
    query: q,
    tickets: rows.map((r) => ({
      displayId: r.display_id,
      sessionToken: r.session_token,
      plate: r.plate,
      vehicleMake: r.vehicle_make,
      status: r.status,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      disputed: r.disputed,
      cardCode: r.card_code,
      createdGuardName: r.created_guard_name,
    })),
  });
});

export default router;
