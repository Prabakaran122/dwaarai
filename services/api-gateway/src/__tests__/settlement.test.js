import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Read-only reporting endpoints — same lightweight mock shape as
// stalls.test.js / donations.test.js's GET routes (queryRows only, no
// transaction client needed).
vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: vi.fn(), on: vi.fn() },
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
const { query, queryOne, queryRows } = await import('../db/queries.js');

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
  queryOne.mockResolvedValue(null);
  queryRows.mockReset();
  queryRows.mockResolvedValue([]);
});

async function request(method, path, { headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers } });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1', name: 'Asha' });
const residentHeader = { Authorization: `Bearer ${resident}` };

const adminC1 = generateTestToken({ sub: 'a1', role: 'community_admin', community_id: 'c1' });
const adminC1Header = { Authorization: `Bearer ${adminC1}` };

const adminC2 = generateTestToken({ sub: 'a2', role: 'community_admin', community_id: 'c2' });
const adminC2Header = { Authorization: `Bearer ${adminC2}` };

const SETTLEMENT_PATH = '/api/v1/admin/settlement?from=2026-08-01&to=2026-08-31';

describe('GET /admin/settlement', () => {
  it('401s without a token', async () => {
    const { status } = await request('GET', SETTLEMENT_PATH);
    expect(status).toBe(401);
  });

  it('403s for a non-admin resident', async () => {
    const { status } = await request('GET', SETTLEMENT_PATH, { headers: residentHeader });
    expect(status).toBe(403);
  });

  it('requires from and to as YYYY-MM-DD', async () => {
    const { status } = await request('GET', '/api/v1/admin/settlement', { headers: adminC1Header });
    expect(status).toBe(400);

    const { status: s2 } = await request('GET', '/api/v1/admin/settlement?from=2026-08-01&to=not-a-date', {
      headers: adminC1Header,
    });
    expect(s2).toBe(400);
  });

  it('only counts PAID orders — the SQL filters status = paid for both stalls and donations', async () => {
    queryRows.mockResolvedValueOnce([]); // stall rows
    queryRows.mockResolvedValueOnce([]); // donation rows
    const { status, json } = await request('GET', SETTLEMENT_PATH, { headers: adminC1Header });
    expect(status).toBe(200);
    expect(json.data.stallFeesPaise).toBe(0);
    expect(json.data.platformFeesPaise).toBe(0);
    expect(json.data.donationsPaise).toBe(0);
    expect(json.data.netToRwaPaise).toBe(0);
    expect(json.data.rows).toEqual([]);

    // Both queries must filter on status = 'paid' server-side — a 'created'
    // (never-completed) order must never reach this report.
    const stallSql = queryRows.mock.calls[0][0];
    const donationSql = queryRows.mock.calls[1][0];
    expect(stallSql).toMatch(/status = 'paid'/);
    expect(donationSql).toMatch(/status = 'paid'/);
  });

  it('a created (unpaid) stall order does not appear — only what the paid-filtered query returns is summed', async () => {
    // Simulate the DB having one paid and one created order for the same
    // event; the route must rely entirely on the SQL's status='paid' filter
    // and must not itself re-include anything beyond what queryRows returns.
    queryRows.mockResolvedValueOnce([
      {
        order_id: 'po1', paid_at: '2026-08-10T10:00:00.000Z',
        stall_fee_paise: '100000', platform_fee_paise: '3000', total_paise: '103000',
        stall_code: 'A1', event_title: 'Diwali Mela', booker_kind: 'resident',
        resident_name: 'Ravi', unit_number: 'A-101', guest_name: null, guest_mobile: null,
      },
    ]);
    queryRows.mockResolvedValueOnce([]);

    const { json } = await request('GET', SETTLEMENT_PATH, { headers: adminC1Header });
    expect(json.data.rows).toHaveLength(1);
    expect(json.data.stallFeesPaise).toBe(100000);
    expect(json.data.platformFeesPaise).toBe(3000);
    expect(json.data.netToRwaPaise).toBe(97000);
  });

  it('net = stallFees - platformFees, in integer paise, with no float drift across many rows', async () => {
    // Values chosen so a naive float implementation (e.g. summing via
    // rupees()/toFixed(2) strings, or dividing then re-multiplying by 100)
    // would visibly drift after a few thousand additions.
    const ROWS = 3000;
    const stallFeeEach = 100033; // an odd, non-round paise value
    const platformFeeEach = 3000;
    const stallRows = Array.from({ length: ROWS }, (_, i) => ({
      order_id: `po${i}`,
      paid_at: '2026-08-15T10:00:00.000Z',
      stall_fee_paise: String(stallFeeEach),
      platform_fee_paise: String(platformFeeEach),
      total_paise: String(stallFeeEach + platformFeeEach),
      stall_code: 'A1',
      event_title: 'Diwali Mela',
      booker_kind: 'guest',
      resident_name: null,
      unit_number: null,
      guest_name: 'Vendor',
      guest_mobile: '9999999999',
    }));
    queryRows.mockResolvedValueOnce(stallRows);
    queryRows.mockResolvedValueOnce([]);

    const { json } = await request('GET', SETTLEMENT_PATH, { headers: adminC1Header });

    const expectedStallFees = ROWS * stallFeeEach;
    const expectedPlatformFees = ROWS * platformFeeEach;
    expect(json.data.stallFeesPaise).toBe(expectedStallFees);
    expect(json.data.platformFeesPaise).toBe(expectedPlatformFees);
    expect(json.data.netToRwaPaise).toBe(expectedStallFees - expectedPlatformFees);
    expect(Number.isInteger(json.data.netToRwaPaise)).toBe(true);
    expect(json.data.rows).toHaveLength(ROWS);
  });

  it('donations appear with ZERO platform fee and settle 100% to the RWA', async () => {
    queryRows.mockResolvedValueOnce([]); // no stall rows
    queryRows.mockResolvedValueOnce([
      {
        order_id: 'po-d1', paid_at: '2026-08-20T09:00:00.000Z',
        amount_paise: '50100', platform_fee_paise: 0,
        fund_name: 'Ganesh Chaturthi Fund', donor_name: 'Meena', is_anonymous: false,
        resident_id: 'r2', unit_number: 'B-202',
      },
    ]);

    const { json } = await request('GET', SETTLEMENT_PATH, { headers: adminC1Header });
    expect(json.data.donationsPaise).toBe(50100);
    expect(json.data.stallFeesPaise).toBe(0);
    expect(json.data.platformFeesPaise).toBe(0); // donations never contribute a platform fee
    expect(json.data.netToRwaPaise).toBe(50100); // 100% of the donation settles to the RWA

    const donationRow = json.data.rows.find((r) => r.type === 'donation');
    expect(donationRow.platformFeePaise).toBe(0);
    expect(donationRow.netPaise).toBe(50100);
    expect(donationRow.amountPaise).toBe(50100);
  });

  it('a mix of stalls and donations combines correctly: net = (stallFees - platformFees) + donations', async () => {
    queryRows.mockResolvedValueOnce([
      {
        order_id: 'po1', paid_at: '2026-08-05T10:00:00.000Z',
        stall_fee_paise: '200000', platform_fee_paise: '6000', total_paise: '206000',
        stall_code: 'B4', event_title: 'Diwali Mela', booker_kind: 'resident',
        resident_name: 'Ravi', unit_number: 'A-101', guest_name: null, guest_mobile: null,
      },
    ]);
    queryRows.mockResolvedValueOnce([
      {
        order_id: 'po-d1', paid_at: '2026-08-06T09:00:00.000Z',
        amount_paise: '10000', platform_fee_paise: 0,
        fund_name: 'Temple Fund', donor_name: 'Meena', is_anonymous: false,
        resident_id: 'r2', unit_number: 'B-202',
      },
    ]);

    const { json } = await request('GET', SETTLEMENT_PATH, { headers: adminC1Header });
    expect(json.data.stallFeesPaise).toBe(200000);
    expect(json.data.platformFeesPaise).toBe(6000);
    expect(json.data.donationsPaise).toBe(10000);
    expect(json.data.netToRwaPaise).toBe(200000 - 6000 + 10000);
    expect(json.data.rows).toHaveLength(2);
  });

  it('the date range is INCLUSIVE of both bounds — expands `to` to end-of-day', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryRows.mockResolvedValueOnce([]);
    await request('GET', '/api/v1/admin/settlement?from=2026-07-01&to=2026-07-31', { headers: adminC1Header });

    const stallParams = queryRows.mock.calls[0][1];
    const donationParams = queryRows.mock.calls[1][1];
    // [communityId, fromTs, toTs]
    expect(stallParams[1]).toBe('2026-07-01T00:00:00.000Z');
    expect(stallParams[2]).toBe('2026-07-31T23:59:59.999Z');
    expect(donationParams[1]).toBe('2026-07-01T00:00:00.000Z');
    expect(donationParams[2]).toBe('2026-07-31T23:59:59.999Z');
  });

  it('is scoped by community_id — an admin from another community gets a different report', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryRows.mockResolvedValueOnce([]);
    await request('GET', SETTLEMENT_PATH, { headers: adminC2Header });

    const stallParams = queryRows.mock.calls[0][1];
    expect(stallParams[0]).toBe('c2');
  });
});

// -- GET /admin/events/:id/bookings -------------------------------------------

describe('GET /admin/events/:id/bookings', () => {
  const PATH = '/api/v1/admin/events/e1/bookings';

  it('401s without a token', async () => {
    const { status } = await request('GET', PATH);
    expect(status).toBe(401);
  });

  it('403s for a non-admin resident', async () => {
    const { status } = await request('GET', PATH, { headers: residentHeader });
    expect(status).toBe(403);
  });

  it('404s when the event is not in the caller community', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('GET', PATH, { headers: adminC1Header });
    expect(status).toBe(404);
  });

  it('shows stall code, resident booker + flat, amount, time and status', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1' });
    queryRows.mockResolvedValueOnce([
      {
        id: 'b1', stall_code: 'A1', booker_kind: 'resident',
        stall_fee_paise: 100000, platform_fee_paise: 3000, total_paise: 103000,
        status: 'booked', created_at: '2026-08-10T09:00:00.000Z', booked_at: '2026-08-10T09:05:00.000Z',
        resident_name: 'Ravi', unit_number: 'A-101', guest_name: null, guest_mobile: null,
      },
    ]);
    const { status, json } = await request('GET', PATH, { headers: adminC1Header });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      stallCode: 'A1',
      bookerKind: 'resident',
      bookerName: 'Ravi',
      unitNumber: 'A-101',
      totalPaise: 103000,
      status: 'booked',
    });
  });

  it('shows guest name + phone for a guest booker, with no unit number', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1' });
    queryRows.mockResolvedValueOnce([
      {
        id: 'b2', stall_code: 'B4', booker_kind: 'guest',
        stall_fee_paise: 50000, platform_fee_paise: 1500, total_paise: 51500,
        status: 'reserved', created_at: '2026-08-11T09:00:00.000Z', booked_at: null,
        resident_name: null, unit_number: null, guest_name: 'Vendor Co', guest_mobile: '9999999999',
      },
    ]);
    const { json } = await request('GET', PATH, { headers: adminC1Header });
    expect(json.data[0]).toMatchObject({
      bookerKind: 'guest',
      bookerName: 'Vendor Co',
      guestMobile: '9999999999',
      unitNumber: null,
      status: 'reserved',
    });
  });
});
