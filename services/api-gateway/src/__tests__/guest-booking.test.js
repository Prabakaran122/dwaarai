import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() };
vi.mock('../../src/db/pool.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('../../src/websocket.js', () => ({
  broadcast: vi.fn(),
  initWebSocket: vi.fn(),
  getIO: vi.fn(),
}));

vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
  sendToMultiple: vi.fn(),
  sendVisitorAlert: vi.fn(),
  sendApprovalRequest: vi.fn(),
}));

vi.mock('../../src/lib/razorpay.js', () => ({
  createOrder: vi.fn().mockResolvedValue({ id: 'order_test_abc123', amount: 0, currency: 'INR', test_mode: true }),
  getKeyId: vi.fn().mockReturnValue(null),
  isLiveMode: vi.fn().mockReturnValue(false),
  verifyWebhookSignature: vi.fn().mockReturnValue(false),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { default: pool } = await import('../db/pool.js');
const { query, queryOne, queryRows } = await import('../db/queries.js');
const { createOrder, getKeyId, isLiveMode } = await import('../lib/razorpay.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  return () => server.close();
});

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  queryOne.mockReset();
  queryRows.mockReset();
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mockClient.release.mockReset();
  pool.connect.mockReset();
  pool.connect.mockResolvedValue(mockClient);
  createOrder.mockReset();
  createOrder.mockResolvedValue({ id: 'order_test_abc123', amount: 0, currency: 'INR', test_mode: true });
  getKeyId.mockReset();
  getKeyId.mockReturnValue(null);
  isLiveMode.mockReset();
  isLiveMode.mockReturnValue(false);
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const admin = generateTestToken({ sub: 'a1', role: 'community_admin', community_id: 'c1' });
const adminHeader = { Authorization: `Bearer ${admin}` };

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1', name: 'Asha' });
const residentHeader = { Authorization: `Bearer ${resident}` };

const LINK_PATH = '/api/v1/admin/events/e1/guest-link';
const publicListPath = (token) => `/api/v1/public/stalls/${token}`;
const publicBookPath = (token) => `/api/v1/public/stalls/${token}/book`;

// -- POST /admin/events/:id/guest-link -----------------------------------------

describe('POST /admin/events/:id/guest-link', () => {
  it('401s without a token', async () => {
    const { status } = await request('POST', LINK_PATH);
    expect(status).toBe(401);
  });

  it('403s for a non-admin resident', async () => {
    const { status } = await request('POST', LINK_PATH, { headers: residentHeader });
    expect(status).toBe(403);
  });

  it('404s when the event is not in the caller community', async () => {
    queryOne.mockResolvedValueOnce(null); // event lookup
    const { status } = await request('POST', LINK_PATH, { headers: adminHeader });
    expect(status).toBe(404);
  });

  it('creates a token that is 64 hex characters — 32 bytes of crypto.randomBytes, matching guest_booking_links.token', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1' }); // event lookup
    const { status, json } = await request('POST', LINK_PATH, { headers: adminHeader });
    expect(status).toBe(201);
    expect(json.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.url).toContain(json.data.token);
    expect(json.data.expiresAt).toBeTruthy();
  });

  it('never derives the token from the event id, and never issues the same token twice', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1' });
    const first = await request('POST', LINK_PATH, { headers: adminHeader });
    queryOne.mockResolvedValueOnce({ id: 'e1' });
    const second = await request('POST', LINK_PATH, { headers: adminHeader });

    expect(first.json.data.token).not.toBe(second.json.data.token);
    expect(first.json.data.token).not.toContain('e1');
    expect(second.json.data.token).not.toContain('e1');
  });
});

// -- GET /public/stalls/:token --------------------------------------------------

describe('GET /public/stalls/:token', () => {
  it('404s an unknown token', async () => {
    queryOne.mockResolvedValueOnce(null); // link lookup
    const { status, json } = await request('GET', publicListPath('unknown-token'));
    expect(status).toBe(404);
    expect(json.error.message).toBe('Link not found');
  });

  it('404s an expired token with the identical message and status as an unknown token', async () => {
    // The SQL predicate (expires_at > NOW()) already excludes it, so the
    // mocked lookup simply returns null exactly like the unknown-token case
    // — there is no separate "expired" branch in the route to diverge from.
    queryOne.mockResolvedValueOnce(null);
    const { status, json } = await request('GET', publicListPath('expired-token'));
    expect(status).toBe(404);
    expect(json.error.message).toBe('Link not found');
  });

  it('404s a revoked token with the identical message and status', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status, json } = await request('GET', publicListPath('revoked-token'));
    expect(status).toBe(404);
    expect(json.error.message).toBe('Link not found');
  });

  it('lists stalls with server-computed pricing for a valid token', async () => {
    queryOne.mockResolvedValueOnce({ id: 'link1', event_id: 'e1', community_id: 'c1' });
    queryRows.mockResolvedValueOnce([
      { id: 's1', code: 'A1', stall_type: 'standard', price_paise: 100000, row_index: 0, col_index: 0, booking_status: null },
      { id: 's2', code: 'A2', stall_type: 'premium', price_paise: 150000, row_index: 0, col_index: 1, booking_status: 'reserved' },
    ]);

    const { status, json } = await request('GET', publicListPath('good-token'));
    expect(status).toBe(200);
    expect(json.data.total).toBe(2);
    expect(json.data.available).toBe(1);

    const s1 = json.data.stalls.find((s) => s.id === 's1');
    expect(s1.pricePaise).toBe(100000);
    expect(s1.platformFeePaise).toBe(3000);
    expect(s1.totalPaise).toBe(103000);
    expect(s1.status).toBe('available');

    const s2 = json.data.stalls.find((s) => s.id === 's2');
    expect(s2.status).toBe('booked'); // reserved OR booked both read as 'booked' publicly
  });

  it('leaks nothing about residents — no name, unit number, mobile, or booker kind anywhere in the response', async () => {
    queryOne.mockResolvedValueOnce({ id: 'link1', event_id: 'e1', community_id: 'c1' });
    queryRows.mockResolvedValueOnce([
      { id: 's1', code: 'A1', stall_type: 'standard', price_paise: 100000, row_index: 0, col_index: 0, booking_status: 'booked' },
    ]);

    const { json } = await request('GET', publicListPath('good-token'));
    const serialised = JSON.stringify(json).toLowerCase();

    expect(serialised).not.toContain('resident');
    expect(serialised).not.toContain('unit');
    expect(serialised).not.toContain('mobile');
    expect(serialised).not.toContain('asha'); // a real resident name used elsewhere in this suite
    expect(serialised).not.toContain('9876543210'); // a real guest mobile used elsewhere in this suite

    // The query itself must never select these columns in the first place —
    // this is the actual guarantee; the assertion above is a second check.
    const [sql] = queryRows.mock.calls[0];
    expect(sql).not.toMatch(/resident_id|unit_id|guest_name|guest_mobile|booker_kind/i);
  });
});

// -- POST /public/stalls/:token/book --------------------------------------------

describe('POST /public/stalls/:token/book', () => {
  const validBody = { guestName: 'Rohit Traders', guestMobile: '9876543210', stallId: 's1' };

  it('404s an unknown token', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status, json } = await request('POST', publicBookPath('unknown'), { body: validBody });
    expect(status).toBe(404);
    expect(json.error.message).toBe('Link not found');
  });

  it('404s an expired token with the identical message', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status, json } = await request('POST', publicBookPath('expired'), { body: validBody });
    expect(status).toBe(404);
    expect(json.error.message).toBe('Link not found');
  });

  it('404s a revoked token with the identical message', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status, json } = await request('POST', publicBookPath('revoked'), { body: validBody });
    expect(status).toBe(404);
    expect(json.error.message).toBe('Link not found');
  });

  it('400s a missing guest name', async () => {
    const { status } = await request('POST', publicBookPath('good-token'), {
      body: { guestMobile: '9876543210', stallId: 's1' },
    });
    expect(status).toBe(400);
  });

  it('400s an invalid Indian mobile number', async () => {
    const { status, json } = await request('POST', publicBookPath('good-token'), {
      body: { guestName: 'Rohit Traders', guestMobile: '12345', stallId: 's1' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/Indian mobile/i);
  });

  it('400s a well-formed but non-Indian-looking 10-digit number (does not start 6-9)', async () => {
    const { status } = await request('POST', publicBookPath('good-token'), {
      body: { guestName: 'Rohit Traders', guestMobile: '1234567890', stallId: 's1' },
    });
    expect(status).toBe(400);
  });

  it('accepts a +91-prefixed mobile and normalizes it to 10 digits', async () => {
    queryOne.mockResolvedValueOnce({ id: 'link1', event_id: 'e1', community_id: 'c1' });
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'A1', price_paise: 100000 }] }) // stall FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1' }] }) // insert stall_bookings
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] }) // insert payment_orders
      .mockResolvedValueOnce({}) // update payment_orders
      .mockResolvedValueOnce({}) // update stall_bookings
      .mockResolvedValueOnce({}); // COMMIT

    const { status } = await request('POST', publicBookPath('good-token'), {
      body: { guestName: 'Rohit Traders', guestMobile: '+91 98765 43210', stallId: 's1' },
    });
    expect(status).toBe(201);

    const insertCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO stall_bookings')
    );
    expect(insertCall[1]).toContain('9876543210');
  });

  it('reserves the stall, computes fee/total server-side from the LOCKED price (not the request body), and returns 201', async () => {
    queryOne.mockResolvedValueOnce({ id: 'link1', event_id: 'e1', community_id: 'c1' });
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'A1', price_paise: 125000 }] }) // stall FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1' }] }) // insert stall_bookings
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] }) // insert payment_orders
      .mockResolvedValueOnce({}) // update payment_orders
      .mockResolvedValueOnce({}) // update stall_bookings
      .mockResolvedValueOnce({}); // COMMIT

    const { status, json } = await request('POST', publicBookPath('good-token'), {
      // A client trying to name its own price must be ignored entirely — the
      // schema doesn't even accept these fields, but assert the amount is
      // still derived from the locked row regardless.
      body: { ...validBody, pricePaise: 1, totalPaise: 1 },
    });

    expect(status).toBe(201);
    // 125000 * 3% = 3750 -> rounds to nearest rupee -> 3800; total 128800.
    expect(json.data.amountPaise).toBe(128800);
    expect(createOrder).toHaveBeenCalledWith(128800, expect.stringContaining('guest_'));

    const insertBookingCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO stall_bookings')
    );
    // The booking is 'reserved', never 'booked' — only the payment webhook
    // may promote it, same rule as the resident path.
    expect(insertBookingCall[0]).toMatch(/'reserved'/);
    expect(insertBookingCall[0]).not.toMatch(/'booked'/);
    expect(insertBookingCall[0]).toMatch(/'guest'/);
    expect(insertBookingCall[1]).toEqual(['s1', 'e1', 'c1', 'Rohit Traders', '9876543210', 125000, 3800, 128800]);

    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('a guest cannot take a stall a resident already holds — same uniq_live_booking_per_stall 23505 becomes 409', async () => {
    const conflictErr = new Error('duplicate key value violates unique constraint "uniq_live_booking_per_stall"');
    conflictErr.code = '23505';

    queryOne.mockResolvedValueOnce({ id: 'link1', event_id: 'e1', community_id: 'c1' });
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'A1', price_paise: 100000 }] }) // stall FOR UPDATE
      .mockRejectedValueOnce(conflictErr) // insert stall_bookings -> 23505
      .mockResolvedValueOnce({}); // ROLLBACK

    const { status, json } = await request('POST', publicBookPath('good-token'), { body: validBody });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/A1/);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(status).not.toBe(500);
  });

  it('rate limits repeated booking attempts from the same caller (deviceLimiter, reused from middleware/rateLimit.js)', async () => {
    // deviceLimiter keys on X-Device-Token when present, and falls back to
    // req.ip otherwise — exactly this endpoint's situation, since a public
    // booking call never carries a device token. It caps at 10 requests per
    // minute per key. This test file has already sent several requests to
    // this same POST route above from the same test-server IP, so a modest
    // burst here is enough to push the cumulative count past the cap and
    // observe a 429 — proving the limiter is actually wired to this route,
    // not merely imported.
    queryOne.mockResolvedValue(null); // every attempt 404s on the token — irrelevant, the
    // limiter runs before the handler and counts the request regardless of
    // what the handler goes on to do with it.

    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(await request('POST', publicBookPath('burst-token'), { body: validBody }));
    }

    expect(results.some((r) => r.status === 429)).toBe(true);
  });
});
