import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks — these are available inside vi.mock factories
const { mockConnect, mockPublishCommand } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockPublishCommand: vi.fn(),
}));

// Mock the db module before importing routes
vi.mock('../db.js', () => {
  const pool = {
    connect: mockConnect,
  };
  return {
    default: pool,
    query: vi.fn(),
    queryOne: vi.fn(),
    queryRows: vi.fn(),
  };
});

// Mock mqtt-publisher
vi.mock('../mqtt-publisher.js', () => ({
  publishCommand: mockPublishCommand,
  connect: vi.fn(),
  disconnect: vi.fn(),
  mockMode: true,
}));

import express from 'express';
import { query, queryOne, queryRows } from '../db.js';
import routes from '../routes.js';

// -- Test app helper ---------------------------------------------------------

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

// -- Test fixtures -----------------------------------------------------------

const adminUser = {
  sub: 'admin-1',
  role: 'admin',
  community_id: '00000000-0000-0000-0000-000000000001',
  unit_id: 'u1',
};

const residentUser = {
  sub: 'user-1',
  role: 'resident',
  community_id: '00000000-0000-0000-0000-000000000001',
  unit_id: 'u1',
};

const device = {
  gate_id: '00000000-0000-0000-0000-000000100001',
  community_id: '00000000-0000-0000-0000-000000000001',
};

// -- Tests -------------------------------------------------------------------

describe('GET /gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns gates for admin', async () => {
    const mockGates = [
      { id: 'g1', name: 'Main Gate', status: 'online', last_seen: new Date().toISOString() },
      { id: 'g2', name: 'Back Gate', status: 'offline', last_seen: null },
    ];
    queryRows.mockResolvedValueOnce(mockGates);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/gates');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.gates).toHaveLength(2);
    expect(res.body.data.gates[0].name).toBe('Main Gate');
  });

  it('rejects non-admin', async () => {
    const app = createApp(residentUser);
    const res = await request(app, 'GET', '/gates');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /gates/:id/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns gate status for authenticated user', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'g1',
      name: 'Main Gate',
      status: 'online',
      last_seen: '2026-03-19T10:00:00.000Z',
      is_active: true,
    });

    const app = createApp(residentUser);
    const res = await request(app, 'GET', '/gates/g1/status');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('online');
    expect(res.body.data.is_open).toBe(true);
    expect(res.body.data.last_seen).toBe('2026-03-19T10:00:00.000Z');
  });

  it('returns 404 for unknown gate', async () => {
    queryOne.mockResolvedValueOnce(null);

    const app = createApp(residentUser);
    const res = await request(app, 'GET', '/gates/unknown/status');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /gates/:id/command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes MQTT command with correct topic and TTL', async () => {
    const gateId = '00000000-0000-0000-0000-000000100001';
    const communityId = adminUser.community_id;

    // Gate exists
    queryOne.mockResolvedValueOnce({ id: gateId, community_id: communityId });
    // Insert event succeeds
    query.mockResolvedValueOnce({});

    // MQTT publish returns payload
    const fakePayload = {
      event_id: 'evt-123',
      action: 'open',
      plate: 'KA05MF1234',
      rfid_hash: null,
      method: 'manual',
      unit_id: null,
      unit_number: null,
      resident_name: null,
      ttl: Math.floor(Date.now() / 1000) + 30,
      issued_at: Math.floor(Date.now() / 1000),
    };
    mockPublishCommand.mockReturnValueOnce(fakePayload);

    const app = createApp(adminUser);
    const res = await request(app, 'POST', `/gates/${gateId}/command`, {
      action: 'open',
      plate: 'KA05MF1234',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.event_id).toBe('evt-123');
    expect(res.body.data.topic).toBe(`cg/${communityId}/gates/${gateId}/commands`);

    // Verify MQTT was called with correct args
    expect(mockPublishCommand).toHaveBeenCalledWith(communityId, gateId, {
      action: 'open',
      plate: 'KA05MF1234',
      rfid_hash: null,
      method: 'manual',
      unit_id: null,
      unit_number: null,
      resident_name: null,
    });

    // Verify event was recorded in DB
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO gate_events');
    expect(params).toContain(gateId);
    expect(params).toContain('manual'); // detection_method
  });

  it('rejects non-admin', async () => {
    const app = createApp(residentUser);
    const res = await request(app, 'POST', '/gates/g1/command', { action: 'open' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown gate', async () => {
    queryOne.mockResolvedValueOnce(null);

    const app = createApp(adminUser);
    const res = await request(app, 'POST', '/gates/unknown/command', { action: 'open' });

    expect(res.status).toBe(404);
  });

  it('rejects invalid action', async () => {
    const app = createApp(adminUser);
    const res = await request(app, 'POST', '/gates/g1/command', { action: 'destroy' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates last_seen for the gate', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });

    const app = createApp(device);
    const res = await request(app, 'POST', '/heartbeat', {
      gate_id: '00000000-0000-0000-0000-000000100001',
      community_id: '00000000-0000-0000-0000-000000000001',
      status: 'online',
      is_open: false,
      queue_depth: 0,
      uptime_s: 3600,
      ts: 1700000000.0,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ack).toBe(true);

    // Verify UPDATE query
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('UPDATE gates SET last_seen');
    expect(params).toContain('online');
    expect(params).toContain('00000000-0000-0000-0000-000000100001');
  });

  it('rejects invalid heartbeat payload', async () => {
    const app = createApp(device);
    const res = await request(app, 'POST', '/heartbeat', {
      gate_id: 'g1',
      // missing required fields
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /events/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('batch inserts offline events', async () => {
    // Mock pool.connect() for transaction
    const mockConn = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
      release: vi.fn(),
    };
    mockConnect.mockResolvedValueOnce(mockConn);

    const events = [
      {
        community_id: '00000000-0000-0000-0000-000000000001',
        gate_id: '00000000-0000-0000-0000-000000100001',
        detection_method: 'anpr',
        raw_value: 'KA05MF1234',
        access_decision: 'allow',
        event_ts: '2026-03-19T08:00:00.000Z',
      },
      {
        community_id: '00000000-0000-0000-0000-000000000001',
        gate_id: '00000000-0000-0000-0000-000000100001',
        detection_method: 'rfid',
        raw_value: 'abc123',
        access_decision: 'deny',
        deny_reason: 'not_registered',
        event_ts: '2026-03-19T08:05:00.000Z',
      },
    ];

    const app = createApp(device);
    const res = await request(app, 'POST', '/events/sync', { events });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.inserted).toBe(2);
    expect(res.body.data.total).toBe(2);

    // Verify transaction: BEGIN, 2 inserts, COMMIT
    expect(mockConn.query).toHaveBeenCalledTimes(4); // BEGIN + 2 INSERTs + COMMIT
    const beginCall = mockConn.query.mock.calls[0][0];
    expect(beginCall).toBe('BEGIN');
    const commitCall = mockConn.query.mock.calls[3][0];
    expect(commitCall).toBe('COMMIT');

    // Verify INSERTs have is_offline_event = true
    const insertCall = mockConn.query.mock.calls[1][0];
    expect(insertCall).toContain('is_offline_event');
    expect(insertCall).toContain('synced_at');

    // Verify release is called
    expect(mockConn.release).toHaveBeenCalled();
  });

  it('rejects empty events array', async () => {
    const app = createApp(device);
    const res = await request(app, 'POST', '/events/sync', { events: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated events for admin', async () => {
    const now = new Date();
    const mockEvents = [
      { id: 'e1', detection_method: 'anpr', access_decision: 'allow', event_ts: now },
      { id: 'e2', detection_method: 'rfid', access_decision: 'deny', event_ts: new Date(now - 1000) },
    ];
    queryRows.mockResolvedValueOnce(mockEvents);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/events');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.events).toHaveLength(2);
    expect(res.body.data.nextCursor).toBeNull(); // only 2 results, no more
  });

  it('applies filters correctly', async () => {
    queryRows.mockResolvedValueOnce([]);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/events?gate_id=g1&method=anpr&decision=allow&plate=KA05');

    expect(res.status).toBe(200);

    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toContain('gate_id');
    expect(sql).toContain('detection_method');
    expect(sql).toContain('access_decision');
    expect(sql).toContain('ILIKE');
    expect(params).toContain('g1');
    expect(params).toContain('anpr');
    expect(params).toContain('allow');
    expect(params).toContain('%KA05%');
  });

  it('rejects non-admin', async () => {
    const app = createApp(residentUser);
    const res = await request(app, 'GET', '/events');

    expect(res.status).toBe(403);
  });
});
