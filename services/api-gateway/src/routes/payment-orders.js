import { Router } from 'express';
import { queryOne } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

export function shapeOrder(o) {
  return {
    id: o.id,
    purpose: o.purpose,
    status: o.status,
    subjectId: o.subject_id,
    amountPaise: Number(o.amount_paise),
    platformFeePaise: Number(o.platform_fee_paise),
    testMode: Boolean(o.test_mode),
    paidAt: o.paid_at || null,
  };
}

// -- GET /payment-orders/:id (resident) ---------------------------------------
//
// The client must not treat the Razorpay callback as proof of payment — only
// the webhook is authoritative, and it may land after checkout returns. The
// app polls this to find out what actually happened before showing anyone a
// confirmation.
router.get('/payment-orders/:id', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    // Scoped by community in the query itself. Fetch-then-compare would work
    // too, but this cannot be got wrong by a later edit.
    const order = await queryOne(
      `SELECT id, purpose, status, subject_id, amount_paise, platform_fee_paise, test_mode, paid_at
         FROM payment_orders
        WHERE id = $1 AND community_id = $2`,
      [req.params.id, req.user.community_id]
    );

    // 404 rather than 403 for someone else's order: a 403 would confirm the id
    // exists, which is exactly what an enumeration attempt is looking for.
    if (!order) return error(res, 'Payment order not found', 404);

    return success(res, shapeOrder(order));
  } catch (err) {
    console.error('GET /payment-orders/:id error:', err.message);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
