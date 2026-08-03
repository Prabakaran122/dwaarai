import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({ sendNotification: vi.fn().mockResolvedValue({}), sendToMultiple: vi.fn(), sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn().mockResolvedValue({}) }));
vi.mock('../mqtt.js', () => ({ publishGateCommand: vi.fn().mockResolvedValue({}), getMqttClient: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
afterAll(() => { server.close(); });
beforeEach(() => { queryOne.mockReset(); queryRows.mockReset(); });

async function request(method, path, { headers, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: '00000000-0000-0000-0000-000000100001', name: 'Ramesh' });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1', name: 'Asha Rao' });

describe('POST /approvals', () => {
  // NAZ-029: "If resident does not respond within 3 minutes, Nazar prompts
  // guard to call the resident directly." The approval window itself must
  // therefore be 3 minutes, not the 60s it shipped with.
  it('gives the resident a 3-minute window to respond', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'u1', unit_number: 'A-204' }) // unit lookup
      .mockResolvedValueOnce({ id: '00000000-0000-0000-0000-000000100001', name: 'Main Gate' }) // gate lookup
      // Insert: echo back whatever expires_at the route actually computed and
      // passed as a bind parameter, so this test exercises the real constant
      // instead of asserting against a value we invented ourselves.
      .mockImplementationOnce((sql, params) => Promise.resolve({
        id: 'ap1', unit_id: 'u1', gate_id: '00000000-0000-0000-0000-000000100001',
        visitor_name: 'Rahul', vehicle_plate: 'KA01AB1234', expires_at: params[6],
      }));
    queryRows.mockResolvedValueOnce([]); // residents to notify

    const before = Date.now();
    const { status, json } = await request('POST', '/api/v1/approvals', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { unit_number: 'A-204', visitor_name: 'Rahul', vehicle_plate: 'KA01AB1234', gate_id: '00000000-0000-0000-0000-000000100001' },
    });
    expect(status).toBe(201);
    const windowMs = new Date(json.data.expires_at).getTime() - before;
    expect(windowMs).toBeGreaterThan(170_000);
    expect(windowMs).toBeLessThanOrEqual(181_000);
  });

  // NAZ-020..023, NAZ-028: the new-vehicle-entry flow reuses this same
  // endpoint but attaches vehicle_type/purpose/photo to the approval record.
  it('accepts and stores vehicle_type and purpose for the new-vehicle-entry flow', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'u1', unit_number: 'A-204' })
      .mockResolvedValueOnce({ id: '00000000-0000-0000-0000-000000100001', name: 'Main Gate' })
      .mockImplementationOnce((sql, params) => Promise.resolve({
        id: 'ap1', unit_id: 'u1', vehicle_type: params[7], purpose: params[8],
      }));
    queryRows.mockResolvedValueOnce([]);

    const { status, json } = await request('POST', '/api/v1/approvals', {
      headers: { Authorization: `Bearer ${guard}` },
      body: {
        unit_number: 'A-204', visitor_name: 'Unregistered vehicle', vehicle_plate: 'KA01AB1234',
        gate_id: '00000000-0000-0000-0000-000000100001', vehicle_type: 'car', purpose: 'delivery',
      },
    });
    expect(status).toBe(201);
    expect(json.data.vehicle_type).toBe('car');
    expect(json.data.purpose).toBe('delivery');
  });

  // NAZ-030..036: walk-in visitor intake reuses this endpoint with the
  // visitor's mobile + ID type instead of vehicle details.
  it('accepts and stores visitor_mobile and id_type for the walk-in-visitor flow', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'u1', unit_number: 'A-204' })
      .mockResolvedValueOnce({ id: '00000000-0000-0000-0000-000000100001', name: 'Main Gate' })
      .mockImplementationOnce((sql, params) => Promise.resolve({
        id: 'ap1', unit_id: 'u1', visitor_mobile: params[10], id_type: params[11],
      }));
    queryRows.mockResolvedValueOnce([]);

    const { status, json } = await request('POST', '/api/v1/approvals', {
      headers: { Authorization: `Bearer ${guard}` },
      body: {
        unit_number: 'A-204', visitor_name: 'Rahul Sharma', gate_id: '00000000-0000-0000-0000-000000100001',
        visitor_mobile: '9900011122', id_type: 'aadhaar',
      },
    });
    expect(status).toBe(201);
    expect(json.data.visitor_mobile).toBe('9900011122');
    expect(json.data.id_type).toBe('aadhaar');
  });
});

describe('POST /approvals/:id/respond — walk-in visitor pass (NAZ-037..043)', () => {
  it('issues a one-time visitor pass valid 4 hours when approving a walk-in visitor', async () => {
    queryOne
      .mockResolvedValueOnce({
        id: 'ap1', community_id: 'c1', unit_id: 'u1', gate_id: 'g1', status: 'pending',
        expires_at: new Date(Date.now() + 60_000), visitor_name: 'Rahul Sharma', visitor_mobile: '9900011122',
        vehicle_plate: null,
      })
      .mockImplementationOnce((sql, params) => Promise.resolve({
        id: 'ap1', community_id: 'c1', unit_id: 'u1', gate_id: 'g1', status: 'approved',
        visitor_name: 'Rahul Sharma', visitor_mobile: '9900011122', vehicle_plate: null,
      }))
      .mockImplementationOnce((sql, params) => Promise.resolve({
        id: 'pass1', otp: params[5], valid_until: params[7],
      }));

    const before = Date.now();
    const { status, json } = await request('POST', '/api/v1/approvals/ap1/respond', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { action: 'approve' },
    });
    expect(status).toBe(200);
    expect(json.data.visitor_pass).toBeTruthy();
    expect(json.data.visitor_pass.otp).toMatch(/^\d{6}$/);
    const validWindowMs = new Date(json.data.visitor_pass.valid_until).getTime() - before;
    expect(validWindowMs).toBeGreaterThan(3.9 * 60 * 60 * 1000);
    expect(validWindowMs).toBeLessThanOrEqual(4.1 * 60 * 60 * 1000);
  });

  it('does not attempt to open the vehicle gate for a walk-in visitor with no plate', async () => {
    const { publishGateCommand } = await import('../mqtt.js');
    publishGateCommand.mockClear();
    queryOne
      .mockResolvedValueOnce({
        id: 'ap2', community_id: 'c1', unit_id: 'u1', gate_id: 'g1', status: 'pending',
        expires_at: new Date(Date.now() + 60_000), visitor_name: 'Rahul Sharma', visitor_mobile: '9900011122',
        vehicle_plate: null,
      })
      .mockImplementationOnce(() => Promise.resolve({
        id: 'ap2', community_id: 'c1', unit_id: 'u1', gate_id: 'g1', status: 'approved',
        visitor_name: 'Rahul Sharma', visitor_mobile: '9900011122', vehicle_plate: null,
      }))
      .mockImplementationOnce((sql, params) => Promise.resolve({ id: 'pass2', otp: params[5], valid_until: params[7] }));

    const { status } = await request('POST', '/api/v1/approvals/ap2/respond', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { action: 'approve' },
    });
    expect(status).toBe(200);
    expect(publishGateCommand).not.toHaveBeenCalled();
  });
});

describe('GET /approvals/:id', () => {
  // NAZ-029: after 3 minutes of silence, Nazar shows the resident's phone
  // number so the guard can call directly.
  it('includes the unit primary resident’s name and mobile for the phone fallback', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'ap1', community_id: 'c1', unit_id: 'u1', status: 'pending',
      expires_at: new Date(Date.now() + 60_000), resident_name: 'Asha Rao', resident_mobile: '9900000000',
    });
    const { status, json } = await request('GET', '/api/v1/approvals/ap1', { headers: { Authorization: `Bearer ${guard}` } });
    expect(status).toBe(200);
    expect(json.data.resident_name).toBe('Asha Rao');
    expect(json.data.resident_mobile).toBe('9900000000');
  });
});
