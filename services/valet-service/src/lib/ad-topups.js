import { query } from '../db.js';

/**
 * Turn a paid Razorpay order into ad credit. The only place that does.
 *
 * Two callers reach it for the same payment, and usually both do: the admin
 * portal, the moment Checkout reports success, and Razorpay's webhook, which
 * is the one that still arrives if the venue closed the tab mid-payment.
 * Whichever is second must change nothing.
 *
 * One statement, so there is no read-then-write for a concurrent delivery to
 * race: only the call that actually flips the order from 'created' gets a row
 * out of the CTE, and only that row is inserted into the ledger. The ledger's
 * unique order_ref index is a second guard behind the first.
 *
 * The ledger is credited the NET from the order row, never the amount paid --
 * GST is tax collected, not ad credit.
 *
 * @param {object} p
 * @param {string} p.orderRef Razorpay order id
 * @param {string} p.paymentRef Razorpay payment id
 * @param {{column: 'account_id'|'community_id', id: string}} [p.owner]
 *   When set, only an order belonging to this owner is settled. The browser
 *   path passes it: a signed-in venue must not be able to settle another
 *   venue's order, even with a genuine signature for it.
 * @param {number} [p.totalPaise] When set, the amount Razorpay says was paid;
 *   an order is only settled if it matches what was asked for.
 * @returns {Promise<boolean>} true when this call credited the balance
 */
export async function settleAdOrder({ orderRef, paymentRef, owner, totalPaise }) {
  const params = [orderRef, paymentRef, `Paid via Razorpay (${paymentRef})`];
  let extra = '';
  if (owner) {
    // The column name is one of two literals from adOwner(), never user input.
    params.push(owner.id);
    extra += ` AND ${owner.column} = $${params.length}`;
  }
  if (totalPaise !== undefined) {
    params.push(totalPaise);
    extra += ` AND total_paise = $${params.length}`;
  }

  const r = await query(
    `WITH paid AS (
       UPDATE valet_ad_orders
          SET status = 'paid', payment_ref = $2, paid_at = NOW()
        WHERE order_ref = $1 AND status = 'created'${extra}
        RETURNING account_id, community_id, net_paise, order_ref
     )
     INSERT INTO valet_ad_ledger (account_id, community_id, amount_paise, kind, order_ref, note)
     SELECT account_id, community_id, net_paise, 'topup', order_ref, $3 FROM paid
     ON CONFLICT (order_ref) WHERE order_ref IS NOT NULL DO NOTHING
     RETURNING id`,
    params
  );
  return r.rowCount > 0;
}
