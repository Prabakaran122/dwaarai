import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing routes
vi.mock('../db.js', () => ({
  default: {},
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));

import express from 'express';
import { query, queryOne, queryRows } from '../db.js';
import routes, { normalizePlate } from '../routes.js';

// ── Test app helper ─────────────────────────────────────────────────

function createApp(userOrDevice = {}) {
  const app = express();
  app.use(express.json());
  // Inject fake user/device context
  app.use((req, _res, next) => {
    if (userOrDevice.gate_id) {
      req.device = userOrDevice;
    } else {
      req.user = userOrDevice;
    }
    next();
  });
  app.use('/', routes);
  return app;
}

async function request(app, method, path, body = undefined) {
  // Use a lightweight approach: call the express app directly
  const { default: http } = await import('http');
  const server = app.listen(0);
  const addr = server.address();
  const port = addr.port;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        server.close();
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', (err) => { server.close(); reject(err); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('normalizePlate', () => {
  it('strips spaces and uppercases', () => {
    expect(normalizePlate('KA 05 MF 1234')).toBe('KA05MF1234');
  });
  it('strips hyphens and dots', () => {
    expect(normalizePlate('ka-05.mf.1234')).toBe('KA05MF1234');
  });
  it('handles already-normalized plates', () => {
    expect(normalizePlate('KA05MF1234')).toBe('KA05MF1234');
  });
});

describe('POST /vehicles', () => {
  const adminUser = { sub: 'user-1', role: 'admin', community_id: 'c1', unit_id: 'u1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a vehicle with valid data', async () => {
    queryOne.mockResolvedValueOnce(null); // no existing
    queryOne.mockResolvedValueOnce({
      id: 'v1', plate: 'KA05MF1234', plate_display: 'KA 05 MF 1234',
      make: 'Honda', model: 'City', color: 'White', type: 'car',
    });

    const app = createApp(adminUser);
    const res = await request(app, 'POST', '/vehicles', {
      plate: 'KA 05 MF 1234',
      make: 'Honda',
      model: 'City',
      color: 'White',
      type: 'car',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.plate).toBe('KA05MF1234');
  });

  it('rejects invalid plate (empty)', async () => {
    const app = createApp(adminUser);
    const res = await request(app, 'POST', '/vehicles', {
      plate: '',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects duplicate plate', async () => {
    queryOne.mockResolvedValueOnce({ id: 'existing-v' }); // existing found

    const app = createApp(adminUser);
    const res = await request(app, 'POST', '/vehicles', {
      plate: 'KA05MF1234',
    });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /vehicles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns vehicles for resident (filtered by unit)', async () => {
    const now = new Date();
    queryRows.mockResolvedValueOnce([
      { id: 'v1', plate: 'KA05MF1234', unit_id: 'u1', created_at: now },
    ]);

    const app = createApp({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });
    const res = await request(app, 'GET', '/vehicles');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.vehicles).toHaveLength(1);
    // Verify resident filter was applied (unit_id in query)
    expect(queryRows).toHaveBeenCalledTimes(1);
    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toContain('unit_id');
    expect(params).toContain('u1');
  });

  it('returns vehicles for admin (all in community)', async () => {
    queryRows.mockResolvedValueOnce([]);

    const app = createApp({ sub: 'a1', role: 'admin', community_id: 'c1', unit_id: 'u1' });
    const res = await request(app, 'GET', '/vehicles');

    expect(res.status).toBe(200);
    const [sql] = queryRows.mock.calls[0];
    expect(sql).not.toContain('unit_id');
  });
});

describe('DELETE /vehicles/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('soft-deletes as admin', async () => {
    queryOne.mockResolvedValueOnce({ id: 'v1', is_active: true });
    query.mockResolvedValueOnce({});

    const app = createApp({ sub: 'a1', role: 'admin', community_id: 'c1' });
    const res = await request(app, 'DELETE', '/vehicles/v1');

    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });

  it('rejects non-admin', async () => {
    const app = createApp({ sub: 'r1', role: 'resident', community_id: 'c1' });
    const res = await request(app, 'DELETE', '/vehicles/v1');

    expect(res.status).toBe(403);
  });
});

describe('GET /whitelist/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns vehicles and blacklist for device community', async () => {
    queryRows.mockResolvedValueOnce([
      { plate: 'KA05MF1234', rfid_uid_hash: 'abc123', unit_id: 'u1', unit_number: '301', resident_name: 'Priya' },
    ]);
    queryRows.mockResolvedValueOnce([
      { plate: 'DL01ZZ9999', rfid_uid_hash: null },
    ]);

    const app = createApp({ gate_id: 'g1', community_id: 'c1' });
    const res = await request(app, 'GET', '/whitelist/sync');

    expect(res.status).toBe(200);
    expect(res.body.data.vehicles).toHaveLength(1);
    expect(res.body.data.blacklist).toHaveLength(1);
    expect(res.body.data.vehicles[0].plate).toBe('KA05MF1234');
  });
});

describe('POST /access/check', () => {
  const device = { gate_id: 'g1', community_id: 'c1' };
  const basePayload = {
    community_id: '00000000-0000-0000-0000-000000000001',
    gate_id: '00000000-0000-0000-0000-000000100001',
    method: 'anpr',
    value: 'KA 05 MF 1234',
    confidence: 0.95,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a recognized vehicle', async () => {
    // blacklist check returns null
    queryOne.mockResolvedValueOnce(null);
    // vehicle lookup returns match
    queryOne.mockResolvedValueOnce({
      id: 'v1', unit_id: 'u1', unit_number: '301', resident_name: 'Priya Sharma',
    });
    // gate_event insert
    query.mockResolvedValueOnce({});

    const app = createApp(device);
    const res = await request(app, 'POST', '/access/check', basePayload);

    expect(res.status).toBe(200);
    expect(res.body.data.decision).toBe('allow');
    expect(res.body.data.vehicle_id).toBe('v1');
    expect(res.body.data.unit_number).toBe('301');
  });

  it('denies a blacklisted vehicle', async () => {
    // blacklist check returns match
    queryOne.mockResolvedValueOnce({ id: 'bl1' });
    // gate_event insert
    query.mockResolvedValueOnce({});

    const app = createApp(device);
    const res = await request(app, 'POST', '/access/check', basePayload);

    expect(res.status).toBe(200);
    expect(res.body.data.decision).toBe('deny');
    expect(res.body.data.reason).toBe('blacklisted');
  });

  it('returns guard_review for unknown vehicle', async () => {
    // blacklist check returns null
    queryOne.mockResolvedValueOnce(null);
    // vehicle lookup returns null
    queryOne.mockResolvedValueOnce(null);
    // gate_event insert
    query.mockResolvedValueOnce({});

    const app = createApp(device);
    const res = await request(app, 'POST', '/access/check', basePayload);

    expect(res.status).toBe(200);
    expect(res.body.data.decision).toBe('guard_review');
    expect(res.body.data.reason).toBe('not_recognized');
  });

  it('rejects invalid method', async () => {
    const app = createApp(device);
    const res = await request(app, 'POST', '/access/check', {
      ...basePayload,
      method: 'invalid',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /blacklist', () => {
  const adminUser = { sub: 'a1', role: 'admin', community_id: 'c1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a plate to blacklist', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'bl1', plate: 'DL01ZZ9999', rfid_uid_hash: null, reason: 'Bad actor',
    });

    const app = createApp(adminUser);
    const res = await request(app, 'POST', '/blacklist', {
      plate: 'DL 01 ZZ 9999',
      reason: 'Bad actor',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.plate).toBe('DL01ZZ9999');
  });

  it('rejects without plate or rfid', async () => {
    const app = createApp(adminUser);
    const res = await request(app, 'POST', '/blacklist', {
      reason: 'No identifier',
    });

    expect(res.status).toBe(400);
  });

  it('rejects non-admin', async () => {
    const app = createApp({ sub: 'r1', role: 'resident', community_id: 'c1' });
    const res = await request(app, 'POST', '/blacklist', {
      plate: 'KA05XX0000',
      reason: 'Test',
    });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /blacklist/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deactivates a blacklist entry', async () => {
    queryOne.mockResolvedValueOnce({ id: 'bl1' });
    query.mockResolvedValueOnce({});

    const app = createApp({ sub: 'a1', role: 'admin', community_id: 'c1' });
    const res = await request(app, 'DELETE', '/blacklist/bl1');

    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });

  it('returns 404 for missing entry', async () => {
    queryOne.mockResolvedValueOnce(null);

    const app = createApp({ sub: 'a1', role: 'admin', community_id: 'c1' });
    const res = await request(app, 'DELETE', '/blacklist/nonexistent');

    expect(res.status).toBe(404);
  });
});
