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

const authHeader = { Authorization: `Bearer ${resident}` };

// -- GET /community-events ---------------------------------------------------

describe('GET /community-events', () => {
  it('returns 401 without a token', async () => {
    const { status } = await request('GET', '/api/v1/community-events');
    expect(status).toBe(401);
  });

  it('returns 403 with a non-resident token', async () => {
    const adminToken = generateTestToken({ sub: 'a1', role: 'admin', community_id: 'c1', unit_id: 'u1' });
    const { status } = await request('GET', '/api/v1/community-events', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(403);
  });

  it('lists upcoming events with goingCount and myRsvp mapped', async () => {
    queryRows.mockResolvedValueOnce([
      {
        id: 'ev1',
        title: 'Holi Bash',
        description: 'Come celebrate!',
        location: 'Clubhouse',
        category: 'festival',
        starts_at: new Date('2026-06-20T17:00:00Z'),
        ends_at: new Date('2026-06-20T21:00:00Z'),
        author_name: 'Asha',
        going_count: 5,
        my_rsvp: 'going',
      },
    ]);
    const { status, json } = await request('GET', '/api/v1/community-events', { headers: authHeader });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    const ev = json.data[0];
    expect(ev.id).toBe('ev1');
    expect(ev.title).toBe('Holi Bash');
    expect(ev.goingCount).toBe(5);
    expect(ev.myRsvp).toBe('going');
    expect(ev.authorName).toBe('Asha');
  });

  it('accepts scope=past', async () => {
    queryRows.mockResolvedValueOnce([]);
    const { status } = await request('GET', '/api/v1/community-events?scope=past', { headers: authHeader });
    expect(status).toBe(200);
  });
});

// -- POST /community-events --------------------------------------------------

describe('POST /community-events', () => {
  it('returns 400 for a bad startsAt (not a date)', async () => {
    const { status, json } = await request('POST', '/api/v1/community-events', {
      headers: authHeader,
      body: { title: 'Test Event', startsAt: 'not-a-date' },
    });
    expect(status).toBe(400);
  });

  it('returns 400 for an invalid category', async () => {
    const { status } = await request('POST', '/api/v1/community-events', {
      headers: authHeader,
      body: { title: 'Test Event', startsAt: '2026-07-01T10:00:00Z', category: 'badcat' },
    });
    expect(status).toBe(400);
  });

  it('creates an event and returns 201 with shaped fields', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'ev2',
      title: 'Society Meet',
      description: null,
      location: 'Hall',
      category: 'meeting',
      starts_at: new Date('2026-07-01T10:00:00Z'),
      ends_at: null,
      author_name: 'Asha',
    });
    const { status, json } = await request('POST', '/api/v1/community-events', {
      headers: authHeader,
      body: { title: 'Society Meet', startsAt: '2026-07-01T10:00:00Z', category: 'meeting', location: 'Hall' },
    });
    expect(status).toBe(201);
    expect(json.data.title).toBe('Society Meet');
    expect(json.data.goingCount).toBe(0);
    expect(json.data.myRsvp).toBeNull();
  });
});

// -- POST /community-events/:id/rsvp -----------------------------------------

describe('POST /community-events/:id/rsvp', () => {
  it('returns 404 when event is not in community', async () => {
    queryOne.mockResolvedValueOnce(null); // event not found
    const { status, json } = await request('POST', '/api/v1/community-events/nonexistent-id/rsvp', {
      headers: authHeader,
      body: { status: 'going' },
    });
    expect(status).toBe(404);
  });

  it('upserts RSVP and returns eventId + status', async () => {
    queryOne.mockResolvedValueOnce({ id: 'ev1' }); // event found
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // upsert
    const { status, json } = await request('POST', '/api/v1/community-events/ev1/rsvp', {
      headers: authHeader,
      body: { status: 'going' },
    });
    expect(status).toBe(200);
    expect(json.data.eventId).toBe('ev1');
    expect(json.data.status).toBe('going');
  });
});

// -- GET /community-events/:id -----------------------------------------------

describe('GET /community-events/:id', () => {
  it('returns 404 when event is not found or not in community', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('GET', '/api/v1/community-events/missing-id', { headers: authHeader });
    expect(status).toBe(404);
  });

  it('returns the event when found', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'ev3',
      title: 'Sports Day',
      description: 'Annual event',
      location: 'Ground',
      category: 'sports',
      starts_at: new Date('2026-08-15T08:00:00Z'),
      ends_at: null,
      author_name: 'RWA',
      going_count: 10,
      my_rsvp: null,
    });
    const { status, json } = await request('GET', '/api/v1/community-events/ev3', { headers: authHeader });
    expect(status).toBe(200);
    expect(json.data.title).toBe('Sports Day');
    expect(json.data.goingCount).toBe(10);
    expect(json.data.myRsvp).toBeNull();
  });
});
