import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() };
vi.mock('../../src/db/pool.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
    on: vi.fn(),
  },
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
const { default: pool } = await import('../db/pool.js');

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
  queryRows.mockResolvedValue([]);
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mockClient.release.mockReset();
  pool.connect.mockReset();
  pool.connect.mockResolvedValue(mockClient);
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

function mockRow(overrides = {}) {
  return {
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
    has_stalls: false,
    has_donations: false,
    is_featured: false,
    cover_path: null,
    stalls_available: 0,
    is_past: false,
    ...overrides,
  };
}

// -- Existing scope=upcoming|past contract must be byte-for-byte preserved --

describe('GET /community-events — legacy scope contract (unchanged)', () => {
  it('with neither scope nor filter, behaves exactly like scope=upcoming did before', async () => {
    queryRows.mockResolvedValueOnce([mockRow()]);
    const { status, json } = await request('GET', '/api/v1/community-events', { headers: residentHeader });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    const ev = json.data[0];
    expect(ev.id).toBe('ev1');
    expect(ev.title).toBe('Holi Bash');
    expect(ev.goingCount).toBe(5);
    expect(ev.myRsvp).toBe('going');
    expect(ev.authorName).toBe('Asha');

    // The SQL issued must still restrict to future events (>= NOW()), same as before.
    const sqlUsed = queryRows.mock.calls[0][0];
    expect(sqlUsed).toMatch(/starts_at >= NOW\(\)/);
  });

  it('scope=past still works and is unaffected by the new filter param', async () => {
    queryRows.mockResolvedValueOnce([]);
    const { status } = await request('GET', '/api/v1/community-events?scope=past', { headers: residentHeader });
    expect(status).toBe(200);
    const sqlUsed = queryRows.mock.calls[0][0];
    expect(sqlUsed).toMatch(/starts_at < NOW\(\)/);
  });

  it('scope=upcoming still works explicitly', async () => {
    queryRows.mockResolvedValueOnce([]);
    const { status } = await request('GET', '/api/v1/community-events?scope=upcoming', { headers: residentHeader });
    expect(status).toBe(200);
    const sqlUsed = queryRows.mock.calls[0][0];
    expect(sqlUsed).toMatch(/starts_at >= NOW\(\)/);
  });
});

// -- Admin read access (Admin Portal reads these with an admin token) --------

describe('GET /community-events — admin token access', () => {
  it('an admin token can list events (was a 403 before this widening)', async () => {
    queryRows.mockResolvedValueOnce([mockRow()]);
    const { status, json } = await request('GET', '/api/v1/community-events', { headers: adminHeader });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    // sub passed to the my_rsvp lookup must be null for an admin caller, not
    // the admin's own id (admins.id lives in a different id space than
    // residents.id and must never be used to look up an RSVP row).
    expect(queryRows.mock.calls[0][1]).toEqual(['c1', null]);
  });

  it("an admin's myRsvp is never derived from an unrelated resident's row", async () => {
    // Even if the mocked row somehow carried a resident's RSVP status, the
    // route must not have looked it up using the admin's id in the first
    // place — asserted above via the query params. Here we also confirm the
    // shaped response for an admin caller renders a null/false myRsvp when
    // the DB genuinely returns none for the (event, NULL) pair.
    queryRows.mockResolvedValueOnce([mockRow({ my_rsvp: null })]);
    const { json } = await request('GET', '/api/v1/community-events', { headers: adminHeader });
    expect(json.data[0].myRsvp).toBeNull();
  });

  it('GET /community-events/:id also accepts an admin token', async () => {
    queryOne.mockResolvedValueOnce(mockRow());
    const { status } = await request('GET', '/api/v1/community-events/ev1', { headers: adminHeader });
    expect(status).toBe(200);
    expect(queryOne.mock.calls[0][1]).toEqual(['c1', null, 'ev1']);
  });

  it("a super-admin's X-Community-Id header scopes the query instead of returning empty", async () => {
    const superAdmin = generateTestToken({ sub: 'sa1', role: 'super_admin', community_id: null });
    queryRows.mockResolvedValueOnce([mockRow()]);
    const { status, json } = await request('GET', '/api/v1/community-events', {
      headers: { Authorization: `Bearer ${superAdmin}`, 'X-Community-Id': 'c-header' },
    });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    // The community id used in the query must be the one from the header,
    // not null — otherwise a super-admin always sees an empty list.
    expect(queryRows.mock.calls[0][1]).toEqual(['c-header', null]);
  });
});

// -- New `filter` param -------------------------------------------------------

describe('GET /community-events?filter=', () => {
  it('rejects an unknown filter with 400 and never reaches SQL', async () => {
    const { status } = await request('GET', '/api/v1/community-events?filter=bogus', { headers: residentHeader });
    expect(status).toBe(400);
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('filter=all lists events with no time restriction', async () => {
    queryRows.mockResolvedValueOnce([mockRow()]);
    const { status } = await request('GET', '/api/v1/community-events?filter=all', { headers: residentHeader });
    expect(status).toBe(200);
    const sqlUsed = queryRows.mock.calls[0][0];
    const whereClause = sqlUsed.slice(sqlUsed.indexOf('WHERE e.community_id'));
    expect(whereClause).not.toMatch(/AND e\.starts_at (>=|<) NOW\(\)/);
  });

  it('filter=upcoming behaves like scope=upcoming', async () => {
    queryRows.mockResolvedValueOnce([]);
    const { status } = await request('GET', '/api/v1/community-events?filter=upcoming', { headers: residentHeader });
    expect(status).toBe(200);
    const sqlUsed = queryRows.mock.calls[0][0];
    expect(sqlUsed).toMatch(/starts_at >= NOW\(\)/);
  });

  it('filter=past lists events but flags them unbookable', async () => {
    queryRows.mockResolvedValueOnce([mockRow({ is_past: true })]);
    const { status, json } = await request('GET', '/api/v1/community-events?filter=past', { headers: residentHeader });
    expect(status).toBe(200);
    expect(json.data[0].bookable).toBe(false);
    const sqlUsed = queryRows.mock.calls[0][0];
    expect(sqlUsed).toMatch(/starts_at < NOW\(\)/);
  });

  it('filter=stalls restricts to events with an AVAILABLE stall, not merely has_stalls', async () => {
    queryRows.mockResolvedValueOnce([mockRow({ has_stalls: true, stalls_available: 2 })]);
    const { status, json } = await request('GET', '/api/v1/community-events?filter=stalls', { headers: residentHeader });
    expect(status).toBe(200);
    expect(json.data[0].hasStalls).toBe(true);
    expect(json.data[0].stallsAvailable).toBe(2);

    const sqlUsed = queryRows.mock.calls[0][0];
    // Must require has_stalls AND an unbooked stall to exist — not just the flag.
    expect(sqlUsed).toMatch(/has_stalls\s*=\s*true/);
    expect(sqlUsed).toMatch(/stall_bookings/);
    expect(sqlUsed).toMatch(/status\s*<>\s*'released'/);
  });

  it('filter=donations restricts to events with has_donations', async () => {
    queryRows.mockResolvedValueOnce([mockRow({ has_donations: true })]);
    const { status, json } = await request('GET', '/api/v1/community-events?filter=donations', { headers: residentHeader });
    expect(status).toBe(200);
    expect(json.data[0].hasDonations).toBe(true);
    const sqlUsed = queryRows.mock.calls[0][0];
    expect(sqlUsed).toMatch(/has_donations\s*=\s*true/);
  });

  it('every event gains hasStalls, hasDonations, isFeatured, coverUrl, stallsAvailable', async () => {
    queryRows.mockResolvedValueOnce([mockRow({
      has_stalls: true, has_donations: true, is_featured: true, cover_path: '/uploads/events/cover.jpg', stalls_available: 3,
    })]);
    const { json } = await request('GET', '/api/v1/community-events?filter=all', { headers: residentHeader });
    const ev = json.data[0];
    expect(ev.hasStalls).toBe(true);
    expect(ev.hasDonations).toBe(true);
    expect(ev.isFeatured).toBe(true);
    expect(ev.coverUrl).toBe('/uploads/events/cover.jpg');
    expect(ev.stallsAvailable).toBe(3);
    expect(ev.bookable).toBe(true);
  });
});

// -- POST /admin/events/:id/feature -------------------------------------------

describe('POST /admin/events/:id/feature', () => {
  const FEATURE_PATH = '/api/v1/admin/events/ev1/feature';

  it('returns 401 without a token', async () => {
    const { status } = await request('POST', FEATURE_PATH);
    expect(status).toBe(401);
  });

  it('returns 403 for a non-admin token', async () => {
    const { status } = await request('POST', FEATURE_PATH, { headers: residentHeader });
    expect(status).toBe(403);
  });

  it('404s when the event is not in the caller community', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // event lookup — not found
    const { status } = await request('POST', FEATURE_PATH, { headers: adminHeader });
    expect(status).toBe(404);
  });

  it('unfeatures the previous event and features the new one in one transaction', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'ev1' }] }) // event lookup
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // clear previous featured event
      .mockResolvedValueOnce({ rows: [{ id: 'ev1' }] }) // set this event featured
      .mockResolvedValueOnce({}); // COMMIT

    const { status, json } = await request('POST', FEATURE_PATH, { headers: adminHeader });
    expect(status).toBe(200);
    expect(json.data.isFeatured).toBe(true);
    expect(json.data.eventId).toBe('ev1');

    const calls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('COMMIT');
    // The clear-then-set order matters: an UPDATE ... SET is_featured = false
    // must run before the UPDATE that sets the new event to featured, or the
    // partial unique index (uniq_featured_event_per_community) raises 23505.
    const clearIdx = calls.findIndex((sql) => /SET is_featured\s*=\s*false/i.test(sql));
    const setIdx = calls.findIndex((sql) => /SET is_featured\s*=\s*true/i.test(sql));
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(clearIdx);
  });

  it('turns a 23505 from the SET step into a 409, never a 500', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'ev1' }] }) // event lookup
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // clear previous featured event
      .mockImplementationOnce(() => {
        const err = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        throw err;
      }) // set — races into a conflict
      .mockResolvedValueOnce({}); // ROLLBACK

    const { status } = await request('POST', FEATURE_PATH, { headers: adminHeader });
    expect(status).toBe(409);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
