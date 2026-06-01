import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { createOrder, verifyWebhookSignature, getKeyId, isLiveMode } from '../lib/razorpay.js';
import { sendNotification } from '../lib/fcm.js';

const router = Router();

function isAdmin(user) {
  return user.role === 'admin' || user.role === 'community_admin' || user.role === 'super_admin';
}

function rupees(n) {
  return Number(n || 0);
}

function shapeDue(d) {
  const base = rupees(d.base_amount);
  const penalty = rupees(d.penalty_amount);
  return {
    id: d.id,
    period: d.period,
    description: d.description || null,
    base_amount: base,
    penalty_amount: penalty,
    total_amount: Number((base + penalty).toFixed(2)),
    due_date: d.due_date,
    status: d.status,
    is_overdue: d.due_date ? d.status === 'pending' && new Date(d.due_date) < new Date() : false,
    created_at: d.created_at,
    paid_at: d.paid_at || null,
  };
}

// -- GET /dues (resident) — current outstanding for the unit ------------------

router.get('/dues', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const rows = await queryRows(
      `SELECT * FROM dues
        WHERE community_id = $1 AND unit_id = $2 AND status = 'pending'
        ORDER BY due_date ASC NULLS LAST, created_at ASC`,
      [user.community_id, user.unit_id]
    );
    const dues = rows.map(shapeDue);
    const outstanding = Number(dues.reduce((sum, d) => sum + d.total_amount, 0).toFixed(2));
    return success(res, { dues, outstanding });
  } catch (err) {
    console.error('GET /dues error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /dues/history (resident) — past payments ----------------------------

router.get('/dues/history', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const rows = await queryRows(
      `SELECT p.id, p.amount, p.gateway, p.receipt_no, p.status, p.paid_at, p.created_at,
              d.period, d.description
         FROM due_payments p
         JOIN dues d ON p.due_id = d.id
        WHERE p.community_id = $1 AND p.unit_id = $2 AND p.status = 'paid'
        ORDER BY p.paid_at DESC NULLS LAST
        LIMIT 100`,
      [user.community_id, user.unit_id]
    );
    return success(res, rows.map((p) => ({
      id: p.id,
      amount: rupees(p.amount),
      gateway: p.gateway,
      receipt_no: p.receipt_no,
      period: p.period,
      description: p.description || null,
      paid_at: p.paid_at,
    })));
  } catch (err) {
    console.error('GET /dues/history error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /dues/:id/pay (resident) — create a payment order ------------------

router.post('/dues/:id/pay', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const due = await queryOne(
      `SELECT * FROM dues WHERE id = $1 AND community_id = $2 AND unit_id = $3`,
      [req.params.id, user.community_id, user.unit_id]
    );
    if (!due) return error(res, 'Due not found', 404);
    if (due.status === 'paid') return error(res, 'This due is already paid', 409);

    const total = rupees(due.base_amount) + rupees(due.penalty_amount);
    const amountPaise = Math.round(total * 100);
    if (amountPaise <= 0) return error(res, 'Nothing to pay', 400);

    const receipt = `due_${String(due.id).slice(0, 8)}`;
    const order = await createOrder(amountPaise, receipt);

    const payment = await queryOne(
      `INSERT INTO due_payments
         (due_id, community_id, unit_id, resident_id, amount, gateway, gateway_order_id, status)
       VALUES ($1, $2, $3, $4, $5, 'razorpay', $6, 'created')
       RETURNING id`,
      [due.id, user.community_id, user.unit_id, user.sub, total, order.id]
    );

    return success(res, {
      payment_id: payment.id,
      order_id: order.id,
      amount: amountPaise,
      currency: 'INR',
      key_id: getKeyId(),
      test_mode: !isLiveMode(),
    }, 201);
  } catch (err) {
    console.error('POST /dues/:id/pay error:', err);
    return error(res, 'Could not start payment', 500);
  }
});

// -- GET /dues/payments/:id (resident) — poll payment status -----------------

router.get('/dues/payments/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const p = await queryOne(
      `SELECT id, status, receipt_no, amount FROM due_payments
        WHERE id = $1 AND community_id = $2 AND unit_id = $3`,
      [req.params.id, user.community_id, user.unit_id]
    );
    if (!p) return error(res, 'Payment not found', 404);
    return success(res, { id: p.id, status: p.status, receipt_no: p.receipt_no, amount: rupees(p.amount) });
  } catch (err) {
    console.error('GET /dues/payments/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /dues/payments/:id/receipt (resident) — PDF receipt -----------------

router.get('/dues/payments/:id/receipt', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const p = await queryOne(
      `SELECT p.*, d.period, d.description, u.unit_number, c.name AS community_name
         FROM due_payments p
         JOIN dues d ON p.due_id = d.id
         JOIN units u ON p.unit_id = u.id
         JOIN communities c ON p.community_id = c.id
        WHERE p.id = $1 AND p.community_id = $2 AND p.unit_id = $3`,
      [req.params.id, user.community_id, user.unit_id]
    );
    if (!p) return error(res, 'Payment not found', 404);
    if (p.status !== 'paid') return error(res, 'Receipt available once payment is confirmed', 409);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${p.receipt_no || p.id}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    doc.fontSize(20).text('Payment Receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).fillColor('#444');
    doc.text(`Community: ${p.community_name}`);
    doc.text(`Unit: ${p.unit_number}`);
    doc.text(`Receipt No: ${p.receipt_no || '-'}`);
    doc.text(`Period: ${p.period}`);
    if (p.description) doc.text(`Description: ${p.description}`);
    doc.text(`Amount Paid: INR ${rupees(p.amount).toFixed(2)}`);
    doc.text(`Payment Method: ${p.gateway}`);
    doc.text(`Paid On: ${p.paid_at ? new Date(p.paid_at).toLocaleString('en-IN') : '-'}`);
    doc.moveDown();
    doc.fontSize(9).fillColor('#888').text('This is a system-generated receipt from Dwaar AI.', { align: 'center' });
    doc.end();
  } catch (err) {
    console.error('GET /dues/payments/:id/receipt error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /dues (admin) — treasurer sets a due for a unit ---------------------

const createDueSchema = z.object({
  unit_number: z.string().min(1),
  period: z.string().min(1).max(20),
  description: z.string().max(200).optional(),
  base_amount: z.number().positive(),
  penalty_amount: z.number().min(0).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post('/dues', authenticateJWT(['admin']), async (req, res) => {
  try {
    const parsed = createDueSchema.safeParse(req.body);
    if (!parsed.success) return error(res, 'Validation error', 400, parsed.error.issues);
    const user = req.user;
    const { unit_number, period, description, base_amount, penalty_amount, due_date } = parsed.data;

    const unit = await queryOne(
      'SELECT id FROM units WHERE community_id = $1 AND unit_number = $2',
      [user.community_id, unit_number]
    );
    if (!unit) return error(res, `Unit ${unit_number} not found`, 404);

    const due = await queryOne(
      `INSERT INTO dues (community_id, unit_id, period, description, base_amount, penalty_amount, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [user.community_id, unit.id, period, description || null, base_amount, penalty_amount || 0, due_date || null]
    );
    return success(res, shapeDue(due), 201);
  } catch (err) {
    console.error('POST /dues error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /dues/:id/mark-paid (admin) — record an offline (cash/cheque) payment

router.post('/dues/:id/mark-paid', authenticateJWT(['admin']), async (req, res) => {
  try {
    const user = req.user;
    const due = await queryOne(
      'SELECT * FROM dues WHERE id = $1 AND community_id = $2',
      [req.params.id, user.community_id]
    );
    if (!due) return error(res, 'Due not found', 404);
    if (due.status === 'paid') return error(res, 'Already paid', 409);

    const total = rupees(due.base_amount) + rupees(due.penalty_amount);
    const receiptNo = `DW-${Date.now().toString(36).toUpperCase()}`;

    await query("UPDATE dues SET status = 'paid', paid_at = NOW() WHERE id = $1", [due.id]);
    await query(
      `INSERT INTO due_payments
         (due_id, community_id, unit_id, amount, gateway, receipt_no, status, paid_at)
       VALUES ($1, $2, $3, $4, 'manual', $5, 'paid', NOW())`,
      [due.id, user.community_id, due.unit_id, total, receiptNo]
    );
    return success(res, { id: due.id, status: 'paid', receipt_no: receiptNo });
  } catch (err) {
    console.error('POST /dues/:id/mark-paid error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /payments/webhook (public, signature-verified) ---------------------
// Authoritative confirmation: a due is only marked paid when Razorpay confirms.

router.post('/payments/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhookSignature(req.rawBody, signature)) {
      return error(res, 'Invalid signature', 401);
    }

    const event = req.body?.event;
    const entity = req.body?.payload?.payment?.entity || req.body?.payload?.order?.entity;
    const orderId = entity?.order_id || entity?.id;
    const paymentId = req.body?.payload?.payment?.entity?.id || null;

    if ((event === 'payment.captured' || event === 'order.paid') && orderId) {
      const payment = await queryOne(
        "SELECT * FROM due_payments WHERE gateway_order_id = $1 AND status != 'paid'",
        [orderId]
      );
      if (payment) {
        const receiptNo = `DW-${Date.now().toString(36).toUpperCase()}`;
        await query(
          "UPDATE due_payments SET status = 'paid', gateway_payment_id = $1, receipt_no = $2, paid_at = NOW() WHERE id = $3",
          [paymentId, receiptNo, payment.id]
        );
        await query("UPDATE dues SET status = 'paid', paid_at = NOW() WHERE id = $1", [payment.due_id]);

        if (payment.resident_id) {
          const resident = await queryOne('SELECT fcm_token FROM residents WHERE id = $1', [payment.resident_id]);
          if (resident?.fcm_token) {
            sendNotification(resident.fcm_token, 'Payment received', `Your maintenance payment of ₹${rupees(payment.amount).toFixed(2)} is confirmed.`, {
              type: 'payment', payment_id: payment.id,
            }).catch((e) => console.error('[Push] payment confirm failed:', e.message));
          }
        }
      }
    }

    // Always 200 so Razorpay doesn't retry indefinitely on handled events.
    return success(res, { received: true });
  } catch (err) {
    console.error('POST /payments/webhook error:', err);
    return error(res, 'Webhook processing error', 500);
  }
});

export default router;
