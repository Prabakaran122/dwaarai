import multer from 'multer';
import { asyncRouter } from '../lib/async-router.js';
import { query, queryOne, queryRows } from '../db.js';
import { normalizePlate } from '../lib/plate.js';
import { storage, extensionFor } from '../lib/storage.js';
import { newClaimCode } from '../lib/claim-code.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = asyncRouter();

// Small on purpose. This is a wordmark shown above a thank-you message on a
// phone, not a hero image, and a venue uploading a 12MB print asset would make
// the guest wait on a hotel's patchy wifi for something they glance at.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const admin = authenticateJWT(['admin']);

/** The venue's own logo key, kept in communities.config rather than a column. */
function logoKeyOf(communityId) {
  return queryOne(
    `SELECT config->>'valetLogoKey' AS logo_key FROM communities WHERE id = $1`,
    [communityId]
  );
}

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
    // Each card also gets a reference it can carry into WhatsApp on its own.
    // The printed code is unique per venue only -- every box starts at A001 --
    // and a WhatsApp message arrives with no venue context to disambiguate it.
    // Same confusable-free alphabet as claim codes, so it survives being read
    // aloud or retyped.
    const params = [communityId];
    const values = toAdd.map((code) => {
      params.push(code, newClaimCode());
      return `($1, $${params.length - 1}, $${params.length})`;
    }).join(',');

    await queryRows(
      `INSERT INTO valet_cards (community_id, code, wa_ref) VALUES ${values}
       ON CONFLICT (community_id, code) DO NOTHING`,
      params
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
            t.created_at, t.closed_at, t.disputed, t.card_code, t.claim_code,
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
      claimCode: r.claim_code,
      createdGuardName: r.created_guard_name,
    })),
  });
});

export default router;

// --- venue branding --------------------------------------------------------

/**
 * The venue's logo, shown to the guest on the thank-you screen.
 *
 * Lives in communities.config rather than its own column: it is one optional
 * string per venue, and a venue with no logo behaves exactly as it does today
 * -- its name set in type, which is all a wordmark is anyway.
 */
router.get('/branding', admin, async (req, res) => {
  const row = await logoKeyOf(req.user.community_id);
  res.json({ hasLogo: !!row?.logo_key });
});

/** The live logo, so the operator sees what a guest sees rather than a filename. */
router.get('/branding/logo', admin, async (req, res) => {
  const row = await logoKeyOf(req.user.community_id);
  if (!row?.logo_key) return res.status(404).json({ error: 'no_logo' });

  const stream = await storage.getStream(row.logo_key);
  if (!stream) return res.status(404).json({ error: 'no_logo' });

  res.setHeader('Cache-Control', 'private, no-store');
  stream.pipe(res);
});

router.post('/branding/logo', admin, logoUpload.single('logo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'no_file', message: 'Choose a PNG or JPG to upload' });
  }

  const communityId = req.user.community_id;
  const key = `valet/branding/${communityId}/logo-${Date.now()}.${extensionFor(req.file.mimetype)}`;
  await storage.put(key, req.file.buffer, req.file.mimetype);

  // The previous file is removed after the new one is written and recorded, so
  // a failure part-way leaves the venue with the old logo rather than none.
  const previous = await logoKeyOf(communityId);
  await query(
    `UPDATE communities
        SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{valetLogoKey}', to_jsonb($2::text))
      WHERE id = $1`,
    [communityId, key]
  );
  if (previous?.logo_key) await storage.delete(previous.logo_key).catch(() => {});

  res.status(201).json({ hasLogo: true });
});

router.delete('/branding/logo', admin, async (req, res) => {
  const row = await logoKeyOf(req.user.community_id);
  if (!row?.logo_key) return res.status(404).json({ error: 'no_logo' });

  await query(
    `UPDATE communities SET config = config - 'valetLogoKey' WHERE id = $1`,
    [req.user.community_id]
  );
  await storage.delete(row.logo_key).catch(() => {});

  res.json({ hasLogo: false });
});

// --- parking inventory -----------------------------------------------------

/** Open statuses: a car standing in a slot, by any of the names that means. */
const HOLDING_A_SLOT = ['parked', 'requested', 'en_route', 'arrived', 'parked_again'];

function slotsEnabledFor(communityId) {
  return queryOne(
    `SELECT (config->>'valetSlotsEnabled')::boolean AS slots_enabled
       FROM communities WHERE id = $1`,
    [communityId]
  );
}

/**
 * The venue's Floor -> Zone -> Slot grid, with occupancy.
 *
 * Occupancy is a LEFT JOIN against live tickets, computed on every read and
 * never stored. A stored is_occupied column drifts the first time a ticket
 * closes by a path nobody remembered to update, and the grid is exactly the
 * screen where that lie would be believed.
 */
router.get('/slots', admin, async (req, res) => {
  const communityId = req.user.community_id;
  const flag = await slotsEnabledFor(communityId);

  const rows = await queryRows(
    `SELECT s.id, s.floor, s.zone, s.number, t.display_id, t.plate, t.session_token
       FROM valet_slots s
       LEFT JOIN valet_tickets t
         ON t.slot_id = s.id AND t.status = ANY($2)
      WHERE s.community_id = $1 AND s.is_active = true
      ORDER BY s.floor, s.zone, s.number`,
    [communityId, HOLDING_A_SLOT]
  );

  res.json({
    enabled: !!flag?.slots_enabled,
    slots: rows.map((r) => ({
      id: r.id,
      floor: r.floor,
      zone: r.zone,
      number: r.number,
      occupiedBy: r.display_id
        ? { displayId: r.display_id, plate: r.plate, sessionToken: r.session_token }
        : null,
    })),
  });
});

/**
 * Adds inventory, by range or explicit list — the same shape card stock uses,
 * because a garage level is numbered in a run exactly like a box of cards and
 * typing 120 slots one at a time guarantees gaps.
 */
router.post('/slots', admin, async (req, res) => {
  const communityId = req.user.community_id;
  const floor = String(req.body.floor ?? '').trim().toUpperCase();
  const zone = String(req.body.zone ?? '').trim().toUpperCase();
  if (!floor || !zone) {
    return res.status(400).json({ error: 'floor_and_zone_required' });
  }

  let numbers = [];
  if (Array.isArray(req.body.numbers)) {
    numbers = req.body.numbers.map((n) => String(n ?? '').trim()).filter(Boolean);
  } else {
    const from = Number(req.body.from);
    const to = Number(req.body.to);
    const width = Number(req.body.width ?? 2);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      return res.status(400).json({ error: 'invalid_range' });
    }
    if (to - from + 1 > 500) return res.status(400).json({ error: 'range_too_large' });
    for (let n = from; n <= to; n += 1) numbers.push(String(n).padStart(width, '0'));
  }
  if (!numbers.length) return res.status(400).json({ error: 'numbers_required' });

  const existing = await queryRows(
    `SELECT number FROM valet_slots
      WHERE community_id = $1 AND floor = $2 AND zone = $3 AND number = ANY($4)`,
    [communityId, floor, zone, numbers]
  );
  const already = new Set(existing.map((r) => r.number));
  const toAdd = numbers.filter((n) => !already.has(n));

  if (toAdd.length) {
    const params = [communityId, floor, zone];
    const values = toAdd.map((n) => {
      params.push(n);
      return `($1, $2, $3, $${params.length})`;
    }).join(',');
    await queryRows(
      `INSERT INTO valet_slots (community_id, floor, zone, number) VALUES ${values}
       ON CONFLICT (community_id, floor, zone, number) DO NOTHING`,
      params
    );
  }

  res.status(201).json({ added: toAdd, skipped: [...already] });
});

/**
 * Retires a slot. Deactivated rather than deleted: tickets reference it and
 * that history is the point of the audit trail.
 */
router.delete('/slots/:id', admin, async (req, res) => {
  const inUse = await queryOne(
    `SELECT display_id FROM valet_tickets
      WHERE slot_id = $1 AND status = ANY($2) LIMIT 1`,
    [req.params.id, HOLDING_A_SLOT]
  );
  if (inUse) {
    return res.status(409).json({
      error: 'slot_in_use',
      message: `${inUse.display_id} is standing in this slot`,
    });
  }

  await query(
    `UPDATE valet_slots SET is_active = false WHERE id = $1 AND community_id = $2`,
    [req.params.id, req.user.community_id]
  );
  res.json({ retired: true });
});

/**
 * The per-venue switch. Kept in communities.config beside valetLogoKey rather
 * than a column, because it is one optional boolean per venue and most venues
 * will never set it.
 */
router.patch('/slots/enabled', admin, async (req, res) => {
  const enabled = req.body.enabled === true;
  await query(
    `UPDATE communities
        SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{valetSlotsEnabled}', to_jsonb($2::boolean))
      WHERE id = $1`,
    [req.user.community_id, enabled]
  );
  res.json({ enabled });
});

// --- feedback --------------------------------------------------------------

/**
 * Sentiment for the property, and the chips behind the unhappy half.
 *
 * A filtered aggregate over valet_feedback, computed on read like every other
 * report here — there is no rollup table to drift away from the taps that
 * produced it.
 */
router.get('/feedback', admin, async (req, res) => {
  const communityId = req.user.community_id;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

  const totals = await queryOne(
    `SELECT COUNT(*) FILTER (WHERE satisfied)::int      AS satisfied,
            COUNT(*) FILTER (WHERE NOT satisfied)::int  AS not_satisfied
       FROM valet_feedback
      WHERE community_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval`,
    [communityId, String(days)]
  );

  // Unnested so a trip that cited two reasons counts against both, which is
  // what a manager reading "long wait: 4" expects it to mean.
  const reasons = await queryRows(
    `SELECT reason, COUNT(*)::int AS count
       FROM valet_feedback f, UNNEST(f.reasons) AS reason
      WHERE f.community_id = $1 AND f.created_at >= NOW() - ($2 || ' days')::interval
      GROUP BY reason
      ORDER BY count DESC`,
    [communityId, String(days)]
  );

  res.json({
    days,
    satisfied: totals?.satisfied ?? 0,
    notSatisfied: totals?.not_satisfied ?? 0,
    reasons,
  });
});
