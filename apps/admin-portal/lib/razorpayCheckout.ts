/**
 * Razorpay Checkout, loaded on demand.
 *
 * The script is fetched only when somebody actually pays, rather than on every
 * admin page, and once per page load however many top-ups follow.
 *
 * The result is one of three outcomes and never a throw, so the caller always
 * has something to tell the venue: paid (with what the server needs to verify
 * it), closed without paying, or failed with Razorpay's own reason.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export type CheckoutResult =
  | { kind: 'paid'; orderId: string; paymentId: string; signature: string }
  | { kind: 'dismissed' }
  | { kind: 'failed'; reason: string };

type RazorpayCtor = new (options: Record<string, unknown>) => {
  open: () => void;
  on: (event: string, cb: (resp: { error?: { description?: string } }) => void) => void;
};

let loading: Promise<RazorpayCtor> | null = null;

function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('Razorpay did not load')));
      s.onerror = () => {
        // Forget the failed attempt so the next click tries again.
        loading = null;
        reject(new Error('Could not reach Razorpay. Check the connection and try again.'));
      };
      document.body.appendChild(s);
    });
  }
  return loading;
}

export async function payWithRazorpay(opts: {
  keyId: string;
  orderId: string;
  amountPaise: number;
  description: string;
}): Promise<CheckoutResult> {
  let Razorpay: RazorpayCtor;
  try {
    Razorpay = await loadCheckout();
  } catch (err) {
    return { kind: 'failed', reason: err instanceof Error ? err.message : 'Razorpay did not load' };
  }

  return new Promise<CheckoutResult>((resolve) => {
    // Checkout can report a failure and then let the payer retry inside the
    // same window, so the first outcome is not necessarily the last. Settle
    // on success or close; remember a failure only to explain the close.
    let lastFailure: string | null = null;
    let settled = false;
    const done = (r: CheckoutResult) => { if (!settled) { settled = true; resolve(r); } };

    const rzp = new Razorpay({
      key: opts.keyId,
      order_id: opts.orderId,
      amount: opts.amountPaise,
      currency: 'INR',
      name: 'DwaarAI',
      description: opts.description,
      theme: { color: '#0f766e' },
      handler: (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        done({
          kind: 'paid',
          orderId: resp.razorpay_order_id,
          paymentId: resp.razorpay_payment_id,
          signature: resp.razorpay_signature,
        }),
      modal: {
        ondismiss: () => done(lastFailure ? { kind: 'failed', reason: lastFailure } : { kind: 'dismissed' }),
      },
    });
    rzp.on('payment.failed', (resp) => {
      lastFailure = resp.error?.description || 'The payment did not go through';
    });
    rzp.open();
  });
}
