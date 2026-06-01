import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() } }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { query, queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { query.mockReset(); queryOne.mockReset(); queryRows.mockReset(); });

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

describe('Daily staff roster', () => {
  it('GET /staff requires a guard', async () => {
    expect((await request('GET', '/api/v1/staff')).status).toBe(401);
    expect((await request('GET', '/api/v1/staff', { headers: { Authorization: `Bearer ${resident}` } })).status).toBe(403);
  });

  it('GET /staff returns the roster with today arrival status', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'rp1', visitor_name: 'Lakshmi', visitor_role: 'maid', time_from: '08:00', time_until: '10:00', unit_number: 'A-704', today_status: 'arrived', today_arrived_at: new Date() },
      { id: 'rp2', visitor_name: 'Ravi', visitor_role: 'driver', time_from: '07:00', time_until: '09:00', unit_number: 'B-101', today_status: null, today_arrived_at: null },
    ]);
    const { status, json } = await request('GET', '/api/v1/staff', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].arrived).toBe(true);
    expect(json.data[1].arrived).toBe(false);
  });

  it('check-in returns 404 for an unknown pass', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/staff/zzz/checkin', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(404);
  });

  it('check-in marks an existing scheduled visit arrived', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'rp1', unit_id: 'u1', visitor_name_normalized: 'lakshmi', visitor_role: 'maid', time_from: '08:00', time_until: '10:00' }) // pass
      .mockResolvedValueOnce({ id: 'ev1', status: 'expected' }); // existing visit
    const { status, json } = await request('POST', '/api/v1/staff/rp1/checkin', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data.checked_in).toBe(true);
    expect(json.data.off_schedule).toBe(false);
  });

  it('check-in creates an off-schedule arrival when no visit exists today', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'rp1', unit_id: 'u1', visitor_name_normalized: 'lakshmi', visitor_role: 'maid', time_from: '08:00', time_until: '10:00' }) // pass
      .mockResolvedValueOnce(null); // no existing visit
    const { status, json } = await request('POST', '/api/v1/staff/rp1/checkin', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data.off_schedule).toBe(true);
  });

  it('check-in is idempotent when already arrived', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'rp1', unit_id: 'u1', visitor_name_normalized: 'lakshmi', visitor_role: 'maid', time_from: '08:00', time_until: '10:00' })
      .mockResolvedValueOnce({ id: 'ev1', status: 'arrived' });
    const { status, json } = await request('POST', '/api/v1/staff/rp1/checkin', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data.already).toBe(true);
  });
});
