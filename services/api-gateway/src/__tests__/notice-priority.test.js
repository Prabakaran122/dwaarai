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

import { NOTICE_PRIORITIES, isUrgent } from '../routes/notices.js';

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

const ownerToken = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'unit1', name: 'Asha' });
const tenantToken = generateTestToken({ sub: 'r2', role: 'resident', community_id: 'c1', unit_id: 'unit2', name: 'Ravi' });
const committeeToken = generateTestToken({ sub: 'r3', role: 'resident', community_id: 'c1', unit_id: 'unit3', name: 'Meena' });
const adminToken = generateTestToken({ sub: 'a1', role: 'admin', community_id: 'c1', name: 'RWA Office' });
const guardToken = generateTestToken({ sub: 'g1', role: 'resident', community_id: 'c1', unit_id: 'unit4', name: 'Guard' });

describe('announcement priority', () => {
  it('supports exactly normal and urgent', () => {
    expect(NOTICE_PRIORITIES).toEqual(['normal', 'urgent']);
  });

  it('identifies urgent announcements, which the feed renders differently', () => {
    expect(isUrgent('urgent')).toBe(true);
    expect(isUrgent('normal')).toBe(false);
    expect(isUrgent(undefined)).toBe(false);
  });
});

describe('POST /notices — committee-only, with priority', () => {
  it('a portal admin can still post an announcement (regression guard)', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'n1', category: 'official', title: 'AGM', body: 'Sunday 11am',
      author_name: 'RWA Office', author_unit: null, posted_by_role: 'Admin',
      is_pinned: true, priority: 'urgent', author_resident_id: null,
      created_at: new Date(), last_activity_at: new Date(),
    });
    queryRows.mockResolvedValueOnce([{ fcm_token: 'tok-1' }]);
    const { status, json } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: 'AGM', body: 'Sunday 11am', priority: 'urgent' },
    });
    expect(status).toBe(201);
    expect(json.data.category).toBe('official');
    expect(json.data.is_pinned).toBe(true);
    // No residents lookup should gate an admin token.
    expect(sendToMultiple).toHaveBeenCalledTimes(1);
  });

  // posted_by_role is NOT NULL and the shipped resident app renders the "RWA"
  // badge on the literal 'admin', so these two assert the value actually bound
  // to the INSERT. The DB is mocked, so a canned response row would happily
  // hide both a constraint violation and a changed vocabulary.
  it('stores posted_by_role as the literal "admin" the resident app matches on', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'n1', category: 'official', title: 'AGM', body: 'Sunday 11am',
      author_name: 'RWA Office', author_unit: null, posted_by_role: 'admin',
      is_pinned: true, priority: 'normal', author_resident_id: null,
      created_at: new Date(), last_activity_at: new Date(),
    });
    queryRows.mockResolvedValueOnce([]);
    await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: 'AGM', body: 'Sunday 11am' },
    });
    const insert = queryOne.mock.calls.find(([sql]) => /INSERT INTO notices/i.test(sql));
    expect(insert[1]).toContain('admin');
  });

  it('never binds a null posted_by_role for a plain resident starting a discussion', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'r1', name: 'Asha', resident_type: 'owner', committee_role: null }) // actor
      .mockResolvedValueOnce({ unit_number: 'A-704' }) // unit
      .mockResolvedValueOnce({
        id: 'n9', category: 'discussion', title: 'Lift noise', body: 'Anyone else?',
        author_name: 'Asha', author_unit: 'A-704', posted_by_role: 'resident',
        is_pinned: false, priority: 'normal', author_resident_id: 'r1',
        created_at: new Date(), last_activity_at: new Date(),
      });
    const { status } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { title: 'Lift noise', body: 'Anyone else?', category: 'discussion' },
    });
    expect(status).toBe(201);
    const insert = queryOne.mock.calls.find(([sql]) => /INSERT INTO notices/i.test(sql));
    const postedByRole = insert[1][7];
    expect(postedByRole).not.toBeNull();
    expect(typeof postedByRole).toBe('string');
    expect(postedByRole).toBe('resident');
  });

  it('a resident committee member can post, and the row records their real role label', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'r3', name: 'Meena', resident_type: 'owner', committee_role: 'secretary' }) // actor lookup
      .mockResolvedValueOnce({ unit_number: 'A-101' }) // unit lookup
      .mockResolvedValueOnce({
        id: 'n2', category: 'official', title: 'Water cut', body: 'Tomorrow',
        author_name: 'Meena', author_unit: 'A-101', posted_by_role: 'Secretary',
        is_pinned: true, priority: 'normal', author_resident_id: 'r3',
        created_at: new Date(), last_activity_at: new Date(),
      });
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${committeeToken}` },
      body: { title: 'Water cut', body: 'Tomorrow' },
    });
    expect(status).toBe(201);
    expect(json.data.posted_by_role).toBe('Secretary');

    const insertCall = queryOne.mock.calls[2];
    // params[7] is posted_by_role per the INSERT column order.
    expect(insertCall[1][7]).toBe('Secretary');
  });

  it('a plain owner (non-committee) is 403', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r1', name: 'Asha', resident_type: 'owner', committee_role: null });
    const { status, json } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { title: 'Hi', body: 'Hello' },
    });
    expect(status).toBe(403);
    expect(json.error.message).toMatch(/committee/i);
  });

  it('a tenant is 403', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r2', name: 'Ravi', resident_type: 'tenant', committee_role: null });
    const { status } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { title: 'Hi', body: 'Hello' },
    });
    expect(status).toBe(403);
  });

  it('a guard is 403', async () => {
    queryOne.mockResolvedValueOnce({ id: 'g1', name: 'Guard', resident_type: 'guard', committee_role: null });
    const { status } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${guardToken}` },
      body: { title: 'Hi', body: 'Hello' },
    });
    expect(status).toBe(403);
  });

  it('an unknown priority is 400', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r3', name: 'Meena', resident_type: 'owner', committee_role: 'secretary' });
    const { status, json } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${committeeToken}` },
      body: { title: 'Hi', body: 'Hello', priority: 'critical' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/validation/i);
  });

  it('omitting priority defaults to normal', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'r3', name: 'Meena', resident_type: 'owner', committee_role: 'secretary' })
      .mockResolvedValueOnce(null) // unit lookup (no unit_id set on this token)
      .mockResolvedValueOnce({
        id: 'n4', category: 'official', title: 'Hi', body: 'Hello',
        author_name: 'Meena', author_unit: null, posted_by_role: 'Secretary',
        is_pinned: true, priority: 'normal', author_resident_id: 'r3',
        created_at: new Date(), last_activity_at: new Date(),
      });
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('POST', '/api/v1/notices', {
      headers: { Authorization: `Bearer ${committeeToken}` },
      body: { title: 'Hi', body: 'Hello' },
    });
    expect(status).toBe(201);
    expect(json.data.priority).toBe('normal');
    const insertCall = queryOne.mock.calls[2];
    expect(insertCall[1][9]).toBe('normal'); // priority param
  });
});
