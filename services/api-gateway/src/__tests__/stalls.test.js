import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
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
  queryOne.mockReset();
  queryRows.mockReset();
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

// -- GET /events/:id/stalls ---------------------------------------------------

describe('GET /events/:id/stalls', () => {
  it('returns 401 without a token', async () => {
    const { status } = await request('GET', '/api/v1/events/e1/stalls');
    expect(status).toBe(401);
  });

  it('404s when the event is not in the caller community', async () => {
    queryOne.mockResolvedValueOnce(null); // event lookup
    const { status } = await request('GET', '/api/v1/events/e1/stalls', { headers: residentHeader });
    expect(status).toBe(404);
  });

  it('lists active stalls with server-computed fee/total and derived status', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1' }); // event lookup
    queryRows.mockResolvedValueOnce([
      { id: 's1', code: 'A1', stall_type: 'standard', price_paise: 100000, row_index: 0, col_index: 0, booking_status: null },
      { id: 's2', code: 'A2', stall_type: 'premium', price_paise: 150000, row_index: 0, col_index: 1, booking_status: 'reserved' },
      { id: 's3', code: 'A3', stall_type: 'corner', price_paise: 150000, row_index: 0, col_index: 2, booking_status: 'booked' },
    ]);

    const { status, json } = await request('GET', '/api/v1/events/e1/stalls', { headers: residentHeader });
    expect(status).toBe(200);
    expect(json.data.total).toBe(3);
    expect(json.data.available).toBe(1);

    const s1 = json.data.stalls.find((s) => s.id === 's1');
    expect(s1.pricePaise).toBe(100000);
    expect(s1.platformFeePaise).toBe(3000); // 3% of 1000 rupees
    expect(s1.totalPaise).toBe(103000);
    expect(s1.status).toBe('available');
    expect(s1.row).toBe(0);
    expect(s1.col).toBe(0);

    const s2 = json.data.stalls.find((s) => s.id === 's2');
    expect(s2.status).toBe('booked'); // reserved still occupies the stall

    const s3 = json.data.stalls.find((s) => s.id === 's3');
    expect(s3.status).toBe('booked');
  });

  it('admin can also list stalls', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1' });
    queryRows.mockResolvedValueOnce([]);
    const { status } = await request('GET', '/api/v1/events/e1/stalls', { headers: adminHeader });
    expect(status).toBe(200);
  });

  it('the query never lets the client name a price — response is always server-computed', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1' });
    queryRows.mockResolvedValueOnce([
      { id: 's1', code: 'A1', stall_type: 'standard', price_paise: 125000, row_index: 0, col_index: 0, booking_status: null },
    ]);
    const { json } = await request('GET', '/api/v1/events/e1/stalls?pricePaise=1', { headers: residentHeader });
    const s1 = json.data.stalls[0];
    expect(s1.pricePaise).toBe(125000);
    expect(s1.platformFeePaise).toBe(3800);
  });
});

// -- POST /admin/events/:id/stalls --------------------------------------------

describe('POST /admin/events/:id/stalls', () => {
  const layout = {
    stalls: [
      { code: 'A1', stallType: 'standard', pricePaise: 100000, row: 0, col: 0 },
      { code: 'A2', stallType: 'premium', pricePaise: 150000, row: 0, col: 1 },
    ],
  };

  it('rejects a non-admin resident', async () => {
    const { status } = await request('POST', '/api/v1/admin/events/e1/stalls', {
      headers: residentHeader,
      body: layout,
    });
    expect(status).toBe(403);
  });

  it('404s when the event is not in the caller community', async () => {
    queryOne.mockResolvedValueOnce(null); // event lookup
    const { status } = await request('POST', '/api/v1/admin/events/e1/stalls', {
      headers: adminHeader,
      body: layout,
    });
    expect(status).toBe(404);
  });

  it('creates the layout for an admin', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1', community_id: 'c1' }); // event lookup
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { status, json } = await request('POST', '/api/v1/admin/events/e1/stalls', {
      headers: adminHeader,
      body: layout,
    });
    expect(status).toBe(201);
    expect(json.data.created).toBe(2);
  });

  it('rejects a duplicate code within the submitted layout', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1', community_id: 'c1' });
    const { status } = await request('POST', '/api/v1/admin/events/e1/stalls', {
      headers: adminHeader,
      body: {
        stalls: [
          { code: 'A1', stallType: 'standard', pricePaise: 100000, row: 0, col: 0 },
          { code: 'A1', stallType: 'standard', pricePaise: 100000, row: 0, col: 1 },
        ],
      },
    });
    expect(status).toBe(400);
  });

  it('rejects an empty layout', async () => {
    queryOne.mockResolvedValueOnce({ id: 'e1', community_id: 'c1' });
    const { status } = await request('POST', '/api/v1/admin/events/e1/stalls', {
      headers: adminHeader,
      body: { stalls: [] },
    });
    expect(status).toBe(400);
  });
});
