import * as api from '../api/client';

/**
 * Razorpay checkout, shared by dues, stall booking and donations.
 *
 * The module is a native one, so it only exists in a real build — `require`
 * is deliberate and optional so the app still runs in Expo Go rather than
 * failing to import. DuesScreen pioneered this shape; it lives here now so
 * there is one copy of the rule instead of one per payment surface.
 */
export function getRazorpayCheckout(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-razorpay').default;
  } catch {
    return null;
  }
}

export interface CheckoutOrder {
  orderId: string;
  paymentOrderId: string;
  amount: number;
  currency: string;
  keyId: string | null;
  testMode: boolean;
}

export interface Payer {
  name?: string | null;
  phone?: string | null;
}

export type PayOutcome =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'cancelled' | 'failed'; message?: string };

/**
 * Open the gateway sheet. A successful return means the SDK reported a
 * payment id — NOT that money moved. Confirm with confirmPayment() before
 * telling anyone their booking succeeded.
 */
export async function payWithRazorpay(
  order: CheckoutOrder,
  payer: Payer,
  description: string,
): Promise<PayOutcome> {
  const Checkout = getRazorpayCheckout();
  if (!Checkout || !order.keyId) {
    return { ok: false, reason: 'unavailable' };
  }

  try {
    const result = await Checkout.open({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency || 'INR',
      name: 'Dwaar AI',
      description,
      prefill: { name: payer.name ?? undefined, contact: payer.phone ?? undefined },
      theme: { color: '#1B3A4B' },
    });
    return result?.razorpay_payment_id ? { ok: true } : { ok: false, reason: 'cancelled' };
  } catch (err: any) {
    // The SDK throws on user cancellation as well as on real errors, and the
    // two must not read the same to the person holding the phone.
    const code = err?.code ?? err?.error?.code;
    if (code === 0 || /cancel/i.test(String(err?.description ?? err?.message ?? ''))) {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'failed', message: err?.description ?? err?.message };
  }
}

export type ConfirmResult = 'paid' | 'pending' | 'failed';

/**
 * Poll the server until the webhook has settled the order.
 *
 * Returns 'pending' rather than 'paid' when the window runs out: the payment
 * may still land, and claiming success for a booking the server has not
 * confirmed is the one outcome worth avoiding.
 */
export async function confirmPayment(
  paymentOrderId: string,
  { attempts = 6, delayMs = 1500 }: { attempts?: number; delayMs?: number } = {},
): Promise<ConfirmResult> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await api.getPaymentOrder(paymentOrderId);
      const status = res.data?.data?.status;
      if (status === 'paid') return 'paid';
      if (status === 'failed') return 'failed';
    } catch {
      // Transient — the webhook may not have arrived yet. Keep polling.
    }
    if (i < attempts - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return 'pending';
}
