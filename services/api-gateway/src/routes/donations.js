import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, isAdminUser } from '../middleware/auth.js';
import { createOrder, getKeyId, isLiveMode } from '../lib/razorpay.js';
import pool from '../db/pool.js';

// Donations are the one payment purpose in this module the BRD is explicit
// and deliberate about: NO platform fee, ever. Taking a cut of a community's
// religious/festival collection would break the trust the whole feature
// depends on. `platformFeePaise` from ../lib/money.js is intentionally never
// imported here — there is no fee arithmetic to perform.

const router = Router();

const createFundSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  targetPaise: z.number().int().positive(),
  eventId: z.string().uuid().optional(),
});

const donateSchema = z.object({
  // The quick-select ladder (₹51/101/251/501) is a CLIENT concern. The server
  // accepts any positive integer paise, with a floor of ₹1 (100 paise) so a
  // near-zero "donation" can't be used to spam the donor list.
  amountPaise: z.number().int().min(100),
  isAnonymous: z.boolean().optional().default(false),
});

function shapeFundProgress(f) {
  const targetPaise = Number(f.target_paise);
  const raisedPaise = Number(f.raised || 0);
  const donorCount = Number(f.donor_count || 0);
  // targetPaise is CHECK > 0 at the schema level, but never trust that from
  // here — a divide-by-zero must not be possible regardless.
  const percent = targetPaise > 0 ? Math.min(100, Math.round((raisedPaise / targetPaise) * 100)) : 0;
  return {
    id: f.id,
    name: f.name,
    description: f.description || null,
    eventId: f.event_id || null,
    targetPaise,
    raisedPaise,
    percent,
    donorCount,
    isOpen: f.is_open !== undefined ? Boolean(f.is_open) : true,
  };
}

// Progress is computed from PAID donations only (status = 'paid'). A
// 'created' (unpaid) donation must never inflate this — otherwise anyone
// could fake a fund's progress by starting a payment they never complete.
const LIST_SQL = `
  SELECT f.id, f.name, f.description, f.target_paise, f.event_id, f.is_open,
         COALESCE(SUM(CASE WHEN d.status = 'paid' THEN d.amount_paise END), 0) AS raised,
         COUNT(CASE WHEN d.status = 'paid' THEN 1 END) AS donor_count
    FROM donation_funds f
    LEFT JOIN donations d ON d.fund_id = f.id
   WHERE f.community_id = $1
   GROUP BY f.id
   ORDER BY f.created_at DESC`;

const SINGLE_SQL = `
  SELECT f.id, f.name, f.description, f.target_paise, f.event_id, f.is_open,
         COALESCE(SUM(CASE WHEN d.status = 'paid' THEN d.amount_paise END), 0) AS raised,
         COUNT(CASE WHEN d.status = 'paid' THEN 1 END) AS donor_count
    FROM donation_funds f
    LEFT JOIN donations d ON d.fund_id = f.id
   WHERE f.id = $1 AND f.community_id = $2
   GROUP BY f.id`;

// -- GET /donation-funds --------------------------------------------------

router.get('/donation-funds', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id } = req.user;
    const rows = await queryRows(LIST_SQL, [community_id]);
    return success(res, rows.map(shapeFundProgress));
  } catch (err) {
    console.error('GET /donation-funds error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /donation-funds/:id -----------------------------------------------

router.get('/donation-funds/:id', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id } = req.user;
    const f = await queryOne(SINGLE_SQL, [req.params.id, community_id]);
    if (!f) {
      return error(res, 'Donation fund not found', 404);
    }
    return success(res, shapeFundProgress(f));
  } catch (err) {
    console.error('GET /donation-funds/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /donation-funds/:id/donate (resident) -----------------------------
//
// No concurrency guarantee is needed here (unlike stall booking) — any
// number of donations may land on the same fund. What matters is that the
// order carries platform_fee_paise = 0, always, and that the amount is taken
// from the request (any positive integer paise the client asks to pay,
// clamped only by the ₹1 floor) — there is no "true price" to protect
// against the client the way there is for a stall.
router.post('/donation-funds/:id/donate', authenticateJWT(['resident']), async (req, res) => {
  const parsed = donateSchema.safeParse(req.body);
  if (!parsed.success) {
    return error(res, 'Validation error', 400, parsed.error.issues);
  }
  const { amountPaise, isAnonymous } = parsed.data;

  const client = await pool.connect();
  try {
    const { community_id, unit_id, sub, name } = req.user;

    const fundResult = await client.query(
      'SELECT id, is_open FROM donation_funds WHERE id = $1 AND community_id = $2',
      [req.params.id, community_id]
    );
    if (!fundResult.rows.length || fundResult.rows[0].is_open === false) {
      return error(res, 'Donation fund not found', 404);
    }
    const fund = fundResult.rows[0];

    await client.query('BEGIN');

    const donorName = name || 'Resident';

    const donationResult = await client.query(
      `INSERT INTO donations
         (fund_id, community_id, resident_id, unit_id, donor_name, amount_paise, status, is_anonymous)
       VALUES ($1, $2, $3, $4, $5, $6, 'created', $7)
       RETURNING id`,
      [fund.id, community_id, sub, unit_id, donorName, amountPaise, isAnonymous]
    );
    const donationId = donationResult.rows[0].id;

    const orderRow = await client.query(
      `INSERT INTO payment_orders
         (community_id, purpose, subject_id, amount_paise, platform_fee_paise, gateway, status, test_mode)
       VALUES ($1, 'donation', $2, $3, 0, 'razorpay', 'created', $4)
       RETURNING id`,
      [community_id, donationId, amountPaise, !isLiveMode()]
    );
    const orderId = orderRow.rows[0].id;

    const receipt = `donation_${String(donationId).slice(0, 8)}`;
    const gatewayOrder = await createOrder(amountPaise, receipt);

    await client.query('UPDATE payment_orders SET gateway_order_id = $1 WHERE id = $2', [gatewayOrder.id, orderId]);
    await client.query('UPDATE donations SET order_id = $1 WHERE id = $2', [orderId, donationId]);

    await client.query('COMMIT');

    return success(res, {
      donationId,
      orderId,
      gatewayOrderId: gatewayOrder.id,
      keyId: getKeyId(),
      amountPaise,
      testMode: !isLiveMode(),
    }, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /donation-funds/:id/donate error:', err);
    return error(res, 'Internal server error', 500);
  } finally {
    client.release();
  }
});

// -- POST /admin/donation-funds (admin) --------------------------------------

router.post('/admin/donation-funds', authenticateJWT(['admin']), async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return error(res, 'Insufficient permissions', 403);
    }

    const parsed = createFundSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { name, description, targetPaise, eventId } = parsed.data;
    const { community_id } = req.user;

    const f = await queryOne(
      `INSERT INTO donation_funds (community_id, event_id, name, description, target_paise)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, target_paise, event_id, is_open`,
      [community_id, eventId || null, name, description || null, targetPaise]
    );

    return success(res, shapeFundProgress({ ...f, raised: 0, donor_count: 0 }), 201);
  } catch (err) {
    console.error('POST /admin/donation-funds error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /admin/donation-funds/:id/donors (admin) -----------------------------
//
// Admin-only. An anonymous donor's name is withheld even here — anonymity is
// a promise to the donor, not just a UI affordance — but the amount and
// donor_count/total still count it, and the row itself is still visible for
// reconciliation.
router.get('/admin/donation-funds/:id/donors', authenticateJWT(['admin']), async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return error(res, 'Insufficient permissions', 403);
    }

    const { community_id } = req.user;
    const fund = await queryOne(
      'SELECT id FROM donation_funds WHERE id = $1 AND community_id = $2',
      [req.params.id, community_id]
    );
    if (!fund) {
      return error(res, 'Donation fund not found', 404);
    }

    const rows = await queryRows(
      `SELECT id, donor_name, amount_paise, is_anonymous, unit_id, resident_id, created_at
         FROM donations
        WHERE fund_id = $1 AND status = 'paid'
        ORDER BY created_at DESC`,
      [req.params.id]
    );

    const donors = rows.map((d) => ({
      id: d.id,
      donorName: d.is_anonymous ? null : d.donor_name,
      amountPaise: Number(d.amount_paise),
      isAnonymous: Boolean(d.is_anonymous),
      unitId: d.unit_id || null,
      residentId: d.resident_id || null,
      createdAt: d.created_at,
    }));

    return success(res, donors);
  } catch (err) {
    console.error('GET /admin/donation-funds/:id/donors error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- Settlement report support ------------------------------------------------
//
// Consumed by GET /admin/settlement (routes/stalls.js), which combines the
// stall and donation ledgers into one report. Donations carry ZERO platform
// fee (see the file banner above) — po.platform_fee_paise is selected here
// purely for completeness/audit, but it is always 0 for purpose = 'donation'
// (enforced by donations.js's own insert, never overridden), so the caller
// never needs to — and must never — invent a fee for a donation row.
//
// `fromTs`/`toTs` are ISO timestamp bounds and BOTH inclusive: the caller
// (routes/stalls.js) is responsible for expanding a plain YYYY-MM-DD `to`
// date to the end of that day, or a month boundary silently drops its last
// day's donations from the report.
const SETTLEMENT_SQL = `
  SELECT po.id AS order_id, po.paid_at, d.amount_paise, po.platform_fee_paise,
         df.name AS fund_name, d.donor_name, d.is_anonymous, d.resident_id, u.unit_number
    FROM payment_orders po
    JOIN donations d ON d.id = po.subject_id
    JOIN donation_funds df ON df.id = d.fund_id
    LEFT JOIN units u ON u.id = d.unit_id
   WHERE po.community_id = $1 AND po.purpose = 'donation' AND po.status = 'paid'
     AND po.paid_at >= $2 AND po.paid_at <= $3
   ORDER BY po.paid_at ASC`;

export async function donationSettlementRows(communityId, fromTs, toTs) {
  return queryRows(SETTLEMENT_SQL, [communityId, fromTs, toTs]);
}

export default router;
