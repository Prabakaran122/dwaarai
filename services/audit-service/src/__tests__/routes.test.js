import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing routes
vi.mock('../db.js', () => {
  return {
    default: { connect: vi.fn() },
    query: vi.fn(),
    queryOne: vi.fn(),
    queryRows: vi.fn(),
  };
});

// Mock pdfkit — return a fake stream-like object
vi.mock('pdfkit', () => {
  const { PassThrough } = require('stream');
  class FakePDFDocument extends PassThrough {
    constructor() {
      super();
    }
    fontSize() { return this; }
    text() { return this; }
    moveDown() { return this; }
    fillColor() { return this; }
    end() {
      // Write fake PDF bytes then close the stream
      super.write(Buffer.from('%PDF-1.4 fake content'));
      super.end();
    }
  }
  return { default: FakePDFDocument };
});

import express from 'express';
import { queryRows } from '../db.js';
import routes from '../routes.js';

// -- Test app helper ---------------------------------------------------------

function createApp(user = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/', routes);
  return app;
}

async function request(app, method, path) {
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
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk); });
      res.on('end', () => {
        server.close();
        const raw = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        let body;
        if (contentType.includes('application/json')) {
          try { body = JSON.parse(raw.toString()); } catch { body = raw.toString(); }
        } else {
          body = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', (err) => { server.close(); reject(err); });
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

// -- Tests -------------------------------------------------------------------

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
    expect(res.body.data.hasMore).toBe(false);
    expect(res.body.data.cursor).toBeNull();
  });

  it('returns cursor when more events exist', async () => {
    // Default limit is 50, so return 51 items to trigger hasMore
    const now = new Date();
    const mockEvents = Array.from({ length: 51 }, (_, i) => ({
      id: `e${i}`,
      detection_method: 'anpr',
      access_decision: 'allow',
      event_ts: new Date(now - i * 1000),
    }));
    queryRows.mockResolvedValueOnce(mockEvents);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/events');

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(50);
    expect(res.body.data.hasMore).toBe(true);
    expect(res.body.data.cursor).toBeTruthy();
  });

  it('applies detection_method filter', async () => {
    queryRows.mockResolvedValueOnce([]);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/events?detection_method=anpr');

    expect(res.status).toBe(200);

    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toContain('detection_method');
    expect(params).toContain('anpr');
  });

  it('applies access_decision filter', async () => {
    queryRows.mockResolvedValueOnce([]);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/events?access_decision=deny');

    expect(res.status).toBe(200);

    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toContain('access_decision');
    expect(params).toContain('deny');
  });

  it('applies date range filters', async () => {
    queryRows.mockResolvedValueOnce([]);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/events?date_from=2026-03-01&date_to=2026-03-19');

    expect(res.status).toBe(200);

    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toContain('event_ts >=');
    expect(sql).toContain('event_ts <=');
    expect(params).toContain('2026-03-01');
    expect(params).toContain('2026-03-19');
  });

  it('applies plate ILIKE filter', async () => {
    queryRows.mockResolvedValueOnce([]);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/events?plate=KA05');

    expect(res.status).toBe(200);

    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toContain('ILIKE');
    expect(params).toContain('%KA05%');
  });

  it('rejects non-admin', async () => {
    const app = createApp(residentUser);
    const res = await request(app, 'GET', '/events');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /reports/daily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns PDF with correct content-type', async () => {
    queryRows.mockResolvedValueOnce([
      {
        id: 'e1',
        detection_method: 'anpr',
        access_decision: 'allow',
        event_ts: new Date('2026-03-18T10:00:00Z'),
        raw_value: 'KA05MF1234',
        deny_reason: null,
      },
    ]);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/reports/daily?date=2026-03-18');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('report-2026-03-18.pdf');
    // Body should be a Buffer with PDF content
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('returns 400 when date parameter is missing', async () => {
    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/reports/daily');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('date');
  });

  it('returns 400 when date format is invalid', async () => {
    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/reports/daily?date=not-a-date');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects non-admin', async () => {
    const app = createApp(residentUser);
    const res = await request(app, 'GET', '/reports/daily?date=2026-03-18');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('generates report for date with no events', async () => {
    queryRows.mockResolvedValueOnce([]);

    const app = createApp(adminUser);
    const res = await request(app, 'GET', '/reports/daily?date=2026-03-18');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });
});
