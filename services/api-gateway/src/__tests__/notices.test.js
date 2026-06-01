import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));

// Avoid real FCM calls.
vi.mock('../../src/lib/fcm.js', () => ({
  sendToMultiple: vi.fn().mockResolvedValue({ successCount: 0 }),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryRows, queryOne } = await import('../db/queries.js');
const { sendToMultiple } = await import('../lib/fcm.js');

let server;
let baseUrl;

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
  queryRows.mockReset();
  queryOne.mockReset();
  sendToMultiple.mockClear();
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const residentToken = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'unit1', name: 'Asha' });
const adminToken = generateTestToken({ sub: 'a1', role: 'admin', community_id: 'c1', name: 'RWA Office' });

describe('Notice board', () => {
  it('GET /notices requires auth', async () => {
    const { status } = await request('GET', '/api/v1/notices');
    expect(status).toBe(401);
  });

  it('GET /notices returns the board list', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'n1', category: 'official', title: 'Water cut', body: 'Tomorrow 10-12', author_name: 'RWA', author_unit: null, posted_by_role: 'admin', is_pinned: true, author_resident_id: null, reply_count: '2', created_at: new Date(), last_activity_at: new Date() },
    ]);
    const { status, json } = await request('GET', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].reply_count).toBe(2);
    expect(json.data[0].is_pinned).toBe(true);
  });

  it('resident POST /notices is forced to a discussion (not official/pinned)', async () => {
    queryOne
      .mockResolvedValueOnce({ unit_number: 'A-704' }) // unit lookup
      .mockResolvedValueOnce({ id: 'n2', category: 'discussion', title: 'Lift noise', body: 'Anyone else?', author_name: 'Asha', author_unit: 'A-704', posted_by_role: 'resident', is_pinned: false, author_resident_id: 'r1', created_at: new Date(), last_activity_at: new Date() });
    const { status, json } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${residentToken}` },
      body: { title: 'Lift noise', body: 'Anyone else?', category: 'official' }, // tries to force official
    });
    expect(status).toBe(201);
    expect(json.data.category).toBe('discussion');
    expect(json.data.is_pinned).toBe(false);
    expect(json.data.author_unit).toBe('A-704');
    expect(sendToMultiple).not.toHaveBeenCalled();
  });

  it('admin POST /notices creates a pinned official notice and pushes to residents', async () => {
    queryOne.mockResolvedValueOnce({ id: 'n3', category: 'official', title: 'AGM', body: 'Sunday 11am', author_name: 'RWA Office', author_unit: null, posted_by_role: 'admin', is_pinned: true, author_resident_id: null, created_at: new Date(), last_activity_at: new Date() });
    queryRows.mockResolvedValueOnce([{ fcm_token: 'tok-1' }, { fcm_token: 'tok-2' }]); // recipients
    const { status, json } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: 'AGM', body: 'Sunday 11am' },
    });
    expect(status).toBe(201);
    expect(json.data.category).toBe('official');
    expect(json.data.is_pinned).toBe(true);
    expect(sendToMultiple).toHaveBeenCalledTimes(1);
    expect(sendToMultiple.mock.calls[0][0]).toEqual(['tok-1', 'tok-2']);
  });

  it('POST reply to a missing notice returns 404', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/notices/nX/replies', {
      headers: { Authorization: `Bearer ${residentToken}` },
      body: { body: 'hi' },
    });
    expect(status).toBe(404);
  });

  it('POST reply succeeds and bumps activity', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'n1' })              // notice exists
      .mockResolvedValueOnce({ unit_number: 'A-704' })  // unit lookup
      .mockResolvedValueOnce({ id: 'rep1', notice_id: 'n1', body: 'Same here', author_name: 'Asha', author_unit: 'A-704', posted_by_role: 'resident', author_resident_id: 'r1', created_at: new Date() });
    const { status, json } = await request('POST', '/api/v1/notices/n1/replies', {
      headers: { Authorization: `Bearer ${residentToken}` },
      body: { body: 'Same here' },
    });
    expect(status).toBe(201);
    expect(json.data.body).toBe('Same here');
  });

  it('resident cannot delete another resident\'s post', async () => {
    queryOne.mockResolvedValueOnce({ id: 'n9', author_resident_id: 'someone-else' });
    const { status } = await request('DELETE', '/api/v1/notices/n9', {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    expect(status).toBe(403);
  });

  it('resident can delete their own post', async () => {
    queryOne.mockResolvedValueOnce({ id: 'n2', author_resident_id: 'r1' });
    const { status, json } = await request('DELETE', '/api/v1/notices/n2', {
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    expect(status).toBe(200);
    expect(json.data.removed).toBe(true);
  });

  it('admin can moderate (remove) any post', async () => {
    queryOne.mockResolvedValueOnce({ id: 'n2', author_resident_id: 'r1' });
    const { status, json } = await request('DELETE', '/api/v1/notices/n2', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(200);
    expect(json.data.removed).toBe(true);
  });
});
