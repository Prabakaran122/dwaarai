import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Placeholder payment mode.
 *
 * The failure this guards against is a production deploy that looks healthy
 * while quietly collecting no money: stalls read as booked, donations as
 * received, and nothing ever reaches the RWA. Missing keys must therefore be
 * a startup failure in production unless someone opted in on purpose.
 */

const ORIGINAL = { ...process.env };

async function loadFresh(env) {
  vi.resetModules();
  process.env = { ...ORIGINAL, ...env };
  // Clear anything the caller wants explicitly absent.
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  return import('../lib/razorpay.js');
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe('mode selection', () => {
  it('is live when both keys are present', async () => {
    const rp = await loadFresh({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's3cret', NODE_ENV: 'test' });

    expect(rp.PAYMENTS_MODE).toBe('live');
    expect(rp.isLiveMode()).toBe(true);
    expect(rp.isPlaceholderMode()).toBe(false);
  });

  it('is placeholder when keys are absent', async () => {
    const rp = await loadFresh({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, NODE_ENV: 'test' });

    expect(rp.PAYMENTS_MODE).toBe('placeholder');
    expect(rp.isPlaceholderMode()).toBe(true);
  });

  it('needs BOTH keys to go live — a half-configured gateway is not live', async () => {
    const rp = await loadFresh({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: undefined, NODE_ENV: 'test' });

    expect(rp.isLiveMode()).toBe(false);
  });

  it('warns loudly when running as a placeholder', async () => {
    await loadFresh({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, NODE_ENV: 'test' });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('PLACEHOLDER MODE'));
  });
});

describe('production safety', () => {
  it('refuses to start in production with no keys and no explicit opt-in', async () => {
    await expect(
      loadFresh({
        RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined,
        PAYMENTS_PLACEHOLDER: undefined, NODE_ENV: 'production',
      })
    ).rejects.toThrow(/Payment gateway is not configured/);
  });

  it('allows placeholder mode in production when explicitly acknowledged', async () => {
    const rp = await loadFresh({
      RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined,
      PAYMENTS_PLACEHOLDER: 'true', NODE_ENV: 'production',
    });

    expect(rp.isPlaceholderMode()).toBe(true);
  });

  it('does not block a non-production environment', async () => {
    const rp = await loadFresh({
      RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, NODE_ENV: 'development',
    });

    expect(rp.isPlaceholderMode()).toBe(true);
  });
});

describe('placeholder orders', () => {
  it('mints an order that is identifiable as fake anywhere it surfaces', async () => {
    const rp = await loadFresh({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, NODE_ENV: 'test' });

    const order = await rp.createOrder(206000, 'stall-A1');

    expect(order.id).toMatch(/^order_placeholder_/);
    expect(order.placeholder).toBe(true);
    expect(order.test_mode).toBe(true);
  });

  it('preserves the amount exactly, so totals still reconcile', async () => {
    const rp = await loadFresh({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, NODE_ENV: 'test' });

    const order = await rp.createOrder(206000, 'stall-A1');

    expect(order.amount).toBe(206000);
    expect(order.currency).toBe('INR');
  });

  it('never calls the Razorpay API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rp = await loadFresh({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, NODE_ENV: 'test' });

    await rp.createOrder(100, 'x');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('issues a distinct id per order', async () => {
    const rp = await loadFresh({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, NODE_ENV: 'test' });

    const ids = new Set(await Promise.all(
      Array.from({ length: 50 }, () => rp.createOrder(100, 'x').then((o) => o.id))
    ));

    expect(ids.size).toBe(50);
  });

  it('exposes no key id to a client', async () => {
    const rp = await loadFresh({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, NODE_ENV: 'test' });

    expect(rp.getKeyId()).toBeNull();
  });
});

describe('webhook verification', () => {
  it('rejects everything in placeholder mode — an unsigned callback must not mark an order paid', async () => {
    const rp = await loadFresh({
      RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined,
      RAZORPAY_WEBHOOK_SECRET: undefined, NODE_ENV: 'test',
    });

    expect(rp.verifyWebhookSignature('{"any":"body"}', 'whatever')).toBe(false);
  });

  it('rejects a wrong signature when a secret is configured', async () => {
    const rp = await loadFresh({ RAZORPAY_WEBHOOK_SECRET: 'hook_secret', NODE_ENV: 'test' });

    expect(rp.verifyWebhookSignature('{"a":1}', 'deadbeef')).toBe(false);
  });

  it('accepts a correctly signed body', async () => {
    const rp = await loadFresh({ RAZORPAY_WEBHOOK_SECRET: 'hook_secret', NODE_ENV: 'test' });
    const crypto = await import('crypto');
    const body = '{"event":"payment.captured"}';
    const sig = crypto.createHmac('sha256', 'hook_secret').update(body).digest('hex');

    expect(rp.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('rejects a missing signature rather than throwing', async () => {
    const rp = await loadFresh({ RAZORPAY_WEBHOOK_SECRET: 'hook_secret', NODE_ENV: 'test' });

    expect(rp.verifyWebhookSignature('{"a":1}', '')).toBe(false);
  });
});
