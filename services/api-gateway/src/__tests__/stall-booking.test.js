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
  isPlaceholderMode: vi.fn().mockReturnValue(true),
  verifyWebhookSignature: vi.fn().mockReturnValue(false),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { default: pool } = await import('../db/pool.js');
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

const resident = generateTestToken({
  sub: 'r1',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u1',
  name: 'Asha',
});
const residentHeader = { Authorization: `Bearer ${resident}` };

const admin = generateTestToken({
  sub: 'a1',
  role: 'community_admin',
  community_id: 'c1',
});
const adminHeader = { Authorization: `Bearer ${admin}` };

const BOOK_PATH = '/api/v1/events/e1/stalls/s1/book';

describe('POST /events/:id/stalls/:stallId/book', () => {
  it('returns 401 without a token', async () => {
    const { status } = await request('POST', BOOK_PATH);
    expect(status).toBe(401);
  });

  it('404s when the event is not in the caller community', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // event lookup — not found
    const { status } = await request('POST', BOOK_PATH, { headers: residentHeader });
    expect(status).toBe(404);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('404s when the stall is not found for this event', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] }) // event lookup
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // stall FOR UPDATE — not found
      .mockResolvedValueOnce({}); // ROLLBACK

    const { status } = await request('POST', BOOK_PATH, { headers: residentHeader });
    expect(status).toBe(404);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('reserves the stall, creates an order, and leaves the booking reserved — not booked', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] }) // event lookup
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'A1', price_paise: 100000 }] }) // stall FOR UPDATE
      .mockResolvedValueOnce({}) // release expired reservations on this stall
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1' }] }) // insert stall_bookings
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] }) // insert payment_orders
      .mockResolvedValueOnce({}) // update payment_orders gateway_order_id
      .mockResolvedValueOnce({}) // update stall_bookings order_id
      .mockResolvedValueOnce({}); // COMMIT

    const { status, json } = await request('POST', BOOK_PATH, { headers: residentHeader });
    expect(status).toBe(201);
    expect(json.data.bookingId).toBe('booking-1');
    expect(json.data.orderId).toBe('order-1');
    expect(json.data.gatewayOrderId).toBe('order_test_abc123');
    expect(json.data.testMode).toBe(true);
    expect(json.data.keyId).toBe(null);

    // Server-computed amount: stall fee 100000 + 3% platform fee (3000) = 103000.
    expect(json.data.amountPaise).toBe(103000);
    expect(createOrder).toHaveBeenCalledWith(103000, expect.stringContaining('stall_'));

    // The INSERT into stall_bookings must set status = 'reserved', never 'booked'.
    const insertBookingCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO stall_bookings')
    );
    expect(insertBookingCall[0]).toMatch(/'reserved'/);
    expect(insertBookingCall[0]).not.toMatch(/'booked'/);

    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('computes stall_fee/platform_fee/total from the LOCKED stall row, never from the request body', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'A1', price_paise: 125000 }] })
      .mockResolvedValueOnce({}) // release expired reservations on this stall
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { json } = await request('POST', BOOK_PATH, {
      headers: residentHeader,
      // A client trying to name its own price must be ignored entirely.
      body: { pricePaise: 1, stallFeePaise: 1, totalPaise: 1 },
    });

    // 125000 * 3% = 3750 -> rounds to nearest rupee -> 3800; total 128800.
    expect(json.data.amountPaise).toBe(128800);
    expect(createOrder).toHaveBeenCalledWith(128800, expect.any(String));

    const insertBookingCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO stall_bookings')
    );
    // params: [stall.id, event_id, community_id, resident_id, unit_id, stallFeePaise, platformFee, totalPaise]
    expect(insertBookingCall[1]).toEqual(['s1', 'e1', 'c1', 'r1', 'u1', 125000, 3800, 128800]);
  });

  it('returns 409 naming the stall when uniq_live_booking_per_stall (23505) is raised — the actual race', async () => {
    const conflictErr = new Error('duplicate key value violates unique constraint "uniq_live_booking_per_stall"');
    conflictErr.code = '23505';

    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] }) // event lookup
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'A1', price_paise: 100000 }] }) // stall FOR UPDATE
      .mockResolvedValueOnce({}) // release expired reservations on this stall
      .mockRejectedValueOnce(conflictErr) // insert stall_bookings -> 23505 (the race, not app logic)
      .mockResolvedValueOnce({}); // ROLLBACK

    const { status, json } = await request('POST', BOOK_PATH, { headers: residentHeader });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/A1/);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('a second booking on an already-reserved stall also gets the 409, not a 500', async () => {
    const conflictErr = new Error('duplicate key');
    conflictErr.code = '23505';

    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'B2', price_paise: 50000 }] })
      .mockResolvedValueOnce({}) // release expired reservations on this stall
      .mockRejectedValueOnce(conflictErr)
      .mockResolvedValueOnce({});

    const { status, json } = await request('POST', BOOK_PATH, { headers: residentHeader });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/B2/);
    expect(status).not.toBe(500);
  });

  it('rolls back and returns 500 (not a partial commit) when order creation throws', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'A1', price_paise: 100000 }] })
      .mockResolvedValueOnce({}) // release expired reservations on this stall
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({}); // ROLLBACK
    createOrder.mockRejectedValueOnce(new Error('gateway unreachable'));

    const { status } = await request('POST', BOOK_PATH, { headers: residentHeader });
    expect(status).toBe(500);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('a released booking frees the stall — the INSERT is allowed to succeed again', async () => {
    // From the route's perspective a released booking is invisible: the
    // uniq_live_booking_per_stall index only guards non-released rows, so
    // the INSERT simply succeeds (no 23505) and a new reservation is made.
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'A1', price_paise: 100000 }] })
      .mockResolvedValueOnce({}) // release expired reservations on this stall
      .mockResolvedValueOnce({ rows: [{ id: 'booking-2' }] }) // insert succeeds — no conflict
      .mockResolvedValueOnce({ rows: [{ id: 'order-2' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { status, json } = await request('POST', BOOK_PATH, { headers: residentHeader });
    expect(status).toBe(201);
    expect(json.data.bookingId).toBe('booking-2');
  });
});

// An unpaid reservation must not hold a stall forever. Nothing ever wrote
// 'released', so before this a resident who reserved and closed the app
// blocked the stall permanently.
describe('abandoned reservations', () => {
  it('reclaims an expired reservation on the stall before inserting', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 's1', code: 'A1', price_paise: 100000 }] })
      .mockResolvedValueOnce({}) // release expired reservations
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { status } = await request('POST', BOOK_PATH, { headers: residentHeader });
    expect(status).toBe(201);

    const release = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && /UPDATE stall_bookings/.test(c[0]) && /released/.test(c[0])
    );
    expect(release).toBeTruthy();
    // Only unpaid holds expire — a booked stall means money moved.
    expect(release[0]).toMatch(/status = 'reserved'/);
    expect(release[0]).toMatch(/created_at </);
    expect(release[1][0]).toBe('s1');
  });
});
