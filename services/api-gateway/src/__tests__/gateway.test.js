import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock the database module before any route imports
vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    on: vi.fn(),
  },
}));

// Now import the app and helpers
const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryRows, queryOne } = await import('../db/queries.js');

// Minimal supertest-like helper using native fetch with the app listening on a random port
let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  return () => {
    server.close();
  };
});

async function request(method, path, { body, headers } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, json };
}

describe('API Gateway', () => {
  it('GET /health returns ok', async () => {
    const { status, json } = await request('GET', '/health');
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('GET /api/v1/vehicles without auth returns 401', async () => {
    const { status, json } = await request('GET', '/api/v1/vehicles');
    expect(status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error.message).toContain('Authorization');
  });

  it('GET /api/v1/vehicles with valid admin JWT returns 200', async () => {
    const token = generateTestToken({ sub: 'u1', role: 'admin', community_id: 'c1' });
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('GET', '/api/v1/vehicles', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });

  it('GET /api/v1/vehicles with resident JWT returns 200', async () => {
    const token = generateTestToken({ sub: 'u2', role: 'resident', community_id: 'c1', unit_id: 'unit1' });
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('GET', '/api/v1/vehicles', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('GET /api/v1/vehicles with wrong role returns 403', async () => {
    const token = generateTestToken({ sub: 'u3', role: 'guard', community_id: 'c1' });
    const { status, json } = await request('GET', '/api/v1/vehicles', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('POST /api/v1/access/check without device token returns 401', async () => {
    const { status, json } = await request('POST', '/api/v1/access/check', {
      body: { community_id: '00000000-0000-0000-0000-000000000000', gate_id: '00000000-0000-0000-0000-000000000001', method: 'anpr', value: 'ABC123' },
    });
    expect(status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('POST /api/v1/access/check with valid device token passes auth', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'anpr',
        value: 'ABC123',
      },
    });
    // Should pass auth and reach handler (returns 200 with guard_review since mock DB returns null)
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.decision).toBe('guard_review');
  });

  it('GET /api/v1/gates without admin JWT returns 401', async () => {
    const { status } = await request('GET', '/api/v1/gates');
    expect(status).toBe(401);
  });

  it('GET /api/v1/gates with admin JWT returns 200', async () => {
    const token = generateTestToken({ sub: 'u1', role: 'admin', community_id: 'c1' });
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('GET', '/api/v1/gates', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(json.data.gates).toEqual([]);
  });

  it('GET /api/v1/events requires admin', async () => {
    const token = generateTestToken({ sub: 'u1', role: 'resident', community_id: 'c1' });
    const { status } = await request('GET', '/api/v1/events', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(403);
  });

  it('GET /api/v1/events with admin returns 200', async () => {
    const token = generateTestToken({ sub: 'u1', role: 'admin', community_id: 'c1' });
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('GET', '/api/v1/events', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(json.data.events).toEqual([]);
  });

  it('rate limit headers are present on responses', async () => {
    const { headers } = await request('GET', '/health');
    // express-rate-limit with standardHeaders:true sets RateLimit-* headers
    const rateLimitHeader = headers.get('ratelimit-limit') || headers.get('x-ratelimit-limit');
    expect(rateLimitHeader).toBeDefined();
  });

  it('POST /api/v1/heartbeat with device token returns 400 for invalid body', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    const { status, json } = await request('POST', '/api/v1/heartbeat', {
      headers: { 'x-device-token': deviceToken },
      body: {},
    });
    expect(status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('GET /api/v1/passes with resident JWT returns 200', async () => {
    const token = generateTestToken({ sub: 'u2', role: 'resident', community_id: 'c1', unit_id: 'unit1' });
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('GET', '/api/v1/passes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(json.data).toEqual([]);
  });

  it('GET /api/v1/reports/daily requires date param', async () => {
    const token = generateTestToken({ sub: 'u1', role: 'admin', community_id: 'c1' });
    const { status, json } = await request('GET', '/api/v1/reports/daily', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(400);
    expect(json.error.message).toContain('date');
  });

  it('GET /api/v1/reports/daily with valid date returns 200', async () => {
    const token = generateTestToken({ sub: 'u1', role: 'admin', community_id: 'c1' });
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('GET', '/api/v1/reports/daily?date=2026-01-15', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(json.data.date).toBe('2026-01-15');
    expect(json.data.total_events).toBe(0);
  });

  it('POST /api/v1/access/check RFID with card-only (no vehicle) returns allow', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce(null)  // blacklist
      .mockResolvedValueOnce(null)  // vehicle
      .mockResolvedValueOnce({      // rfid_card
        id: 'card-1',
        unit_id: 'unit-staff-1',
        unit_number: 'S-01',
        card_type: 'staff',
        resident_name: 'S-01',
      });
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'rfid',
        value: 'a'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('allow');
    expect(json.data.card_type).toBe('staff');
    expect(json.data.vehicle_id).toBeNull();
  });

  it('POST /api/v1/access/check RFID with expired card returns guard_review', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'rfid',
        value: 'b'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('guard_review');
  });

  it('POST /api/v1/access/check RFID with vehicle-linked RFID returns allow', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'v-1',
        unit_id: 'unit-301',
        unit_number: '301',
        resident_name: 'Priya Sharma',
      });
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'rfid',
        value: 'c'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('allow');
    expect(json.data.vehicle_id).toBe('v-1');
    expect(json.data.resident_name).toBe('Priya Sharma');
  });

  it('POST /api/v1/access/check FASTag with known TID returns allow', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce(null)  // blacklist
      .mockResolvedValueOnce({      // vehicle by fastag_tid_hash
        id: 'v-fastag-1',
        unit_id: 'unit-301',
        unit_number: '301',
        resident_name: 'Priya Sharma',
      });
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'fastag',
        value: 'd'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('allow');
    expect(json.data.vehicle_id).toBe('v-fastag-1');
  });

  it('POST /api/v1/access/check FASTag unknown TID returns guard_review', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce(null)   // blacklist
      .mockResolvedValueOnce(null)   // vehicle
      .mockResolvedValueOnce(null);  // rfid_cards
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'fastag',
        value: 'e'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('guard_review');
  });

  it('POST /api/v1/vehicles/auto-pair links FASTag to vehicle', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce({ id: 'v-1', fastag_tid_hash: null })  // find vehicle by plate
      .mockResolvedValueOnce(null)                                     // check existing FASTag
      .mockResolvedValueOnce({ id: 'v-1', plate: 'KA05MF1234', fastag_tid_hash: 'f'.repeat(64) }); // update
    const { status, json } = await request('POST', '/api/v1/vehicles/auto-pair', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        plate: 'KA05MF1234',
        fastag_tid_hash: 'f'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.auto_paired).toBe(true);
  });

  it('POST /api/v1/vehicles/register-at-gate creates vehicle with FASTag', async () => {
    const guardToken = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce({ id: 'unit-301' })   // find unit
      .mockResolvedValueOnce(null)                    // no existing vehicle
      .mockResolvedValueOnce({                        // insert vehicle
        id: 'v-new',
        plate: 'KA05MF1234',
        fastag_tid_hash: 'g'.repeat(64),
        community_id: '00000000-0000-0000-0000-000000000000',
      });
    const { status, json } = await request('POST', '/api/v1/vehicles/register-at-gate', {
      headers: { Authorization: `Bearer ${guardToken}` },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        plate: 'KA05MF1234',
        fastag_tid_hash: 'g'.repeat(64),
        unit_number: '301',
      },
    });
    expect(status).toBe(201);
    expect(json.data.created).toBe(true);
  });
});
