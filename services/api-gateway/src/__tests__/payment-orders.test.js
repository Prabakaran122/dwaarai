/**
 * payment-orders.test.js — the endpoint the app polls after checkout.
 *
 * The Razorpay callback is not proof of payment; the webhook is. These tests
 * pin the behaviour the client depends on to tell the difference.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn(), on: vi.fn() },
}));

vi.mock('../../src/websocket.js', () => ({
  broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn(),
}));

vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn(), sendToMultiple: vi.fn(),
  sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn(),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne } = await import('../db/queries.js');

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

beforeEach(() => { queryOne.mockReset(); });

const token = generateTestToken({
  sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1', name: 'Asha',
});

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const paidRow = {
  id: 'o1', purpose: 'stall', status: 'paid', subject_id: 'b1',
  amount_paise: 206000, platform_fee_paise: 6000, test_mode: false,
  paid_at: '2026-08-21T10:00:00.000Z',
};

describe('GET /payment-orders/:id', () => {
  it('FR-STL-07: reports a paid order so the app can confirm from the server', async () => {
    queryOne.mockResolvedValueOnce(paidRow);
    const { status, json } = await get('/api/v1/payment-orders/o1');
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      status: 'paid', purpose: 'stall', amountPaise: 206000, platformFeePaise: 6000,
    });
  });

  it('FR-STL-07: reports an unpaid order as still created, not as success', async () => {
    queryOne.mockResolvedValueOnce({ ...paidRow, status: 'created', paid_at: null });
    const { json } = await get('/api/v1/payment-orders/o1');
    expect(json.data.status).toBe('created');
  });

  // A 403 would confirm the id exists, which is what enumeration wants.
  it('FR-STL-07: 404s another community order rather than admitting it exists', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await get('/api/v1/payment-orders/someone-elses');
    expect(status).toBe(404);
  });

  it('FR-STL-07: scopes the lookup by community in the query itself', async () => {
    queryOne.mockResolvedValueOnce(paidRow);
    await get('/api/v1/payment-orders/o1');
    expect(queryOne).toHaveBeenCalledWith(
      expect.stringContaining('community_id = $2'), ['o1', 'c1']
    );
  });

  it('FR-STL-07: requires authentication', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payment-orders/o1`);
    expect(res.status).toBe(401);
  });
});
