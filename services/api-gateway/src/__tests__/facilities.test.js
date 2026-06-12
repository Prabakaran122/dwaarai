import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));

vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
  sendToMultiple: vi.fn(),
  sendVisitorAlert: vi.fn(),
  sendApprovalRequest: vi.fn(),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, queryRows, query } = await import('../db/queries.js');

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
  queryOne.mockReset();
  queryRows.mockReset();
  query.mockReset();
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

// Compute date strings relative to real today for window-check tests
const today = new Date().toISOString().slice(0, 10);
const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const tenDaysOut = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });
const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });

// Reusable facility fixture (DB shape — times have HH:MM:SS format)
const fakeFacility = {
  id: 'fac-1',
  name: 'Badminton Court',
  sport: 'badminton',
  open_time: '06:00:00',
  close_time: '08:00:00',
  slot_minutes: 60,
};

// ── GET /facilities ──────────────────────────────────────────────────────────

describe('GET /facilities', () => {
  it('requires a resident token — 401 without auth', async () => {
    const { status } = await request('GET', '/api/v1/facilities');
    expect(status).toBe(401);
  });

  it('requires a resident token — 403 for guard', async () => {
    const { status } = await request('GET', '/api/v1/facilities', {
      headers: { Authorization: `Bearer ${guard}` },
    });
    expect(status).toBe(403);
  });

  it('lists facilities with correct shape', async () => {
    // queryRows call 1: facility list
    queryRows.mockResolvedValueOnce([
      {
        id: 'fac-1',
        name: 'Badminton Court',
        sport: 'badminton',
        open_time: '06:00:00',
        close_time: '22:00:00',
        slot_minutes: 60,
      },
    ]);

    const { status, json } = await request('GET', '/api/v1/facilities', {
      headers: { Authorization: `Bearer ${resident}` },
    });

    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    const f = json.data[0];
    expect(f.id).toBe('fac-1');
    expect(f.name).toBe('Badminton Court');
    expect(f.sport).toBe('badminton');
    expect(f.openTime).toBe('06:00');
    expect(f.closeTime).toBe('22:00');
    expect(f.slotMinutes).toBe(60);
  });
});

// ── GET /facilities/:id/availability ────────────────────────────────────────

describe('GET /facilities/:id/availability', () => {
  it('marks slots correctly (open and booked)', async () => {
    // Call order:
    //  1. queryOne → facility row
    //  2. queryRows → bookings for that facility+date
    queryOne.mockResolvedValueOnce(fakeFacility);
    queryRows.mockResolvedValueOnce([
      { start_time: '07:00:00', unit_id: 'u2' }, // booked by another unit
    ]);

    const { status, json } = await request(
      'GET',
      `/api/v1/facilities/fac-1/availability?date=${today}`,
      { headers: { Authorization: `Bearer ${resident}` } }
    );

    expect(status).toBe(200);
    // 06:00-08:00 with 60-min slots → two slots: 06:00 and 07:00
    expect(json.data.slots).toHaveLength(2);

    const slot06 = json.data.slots.find((s) => s.start === '06:00');
    const slot07 = json.data.slots.find((s) => s.start === '07:00');

    expect(slot06.status).toBe('open');
    expect(slot07.status).toBe('booked');
  });

  it('marks slot as "mine" when booked by the requesting unit', async () => {
    // Call order:
    //  1. queryOne → facility row
    //  2. queryRows → bookings with this unit's booking at 07:00
    queryOne.mockResolvedValueOnce(fakeFacility);
    queryRows.mockResolvedValueOnce([
      { start_time: '07:00:00', unit_id: 'u1' }, // same as req.user.unit_id
    ]);

    const { status, json } = await request(
      'GET',
      `/api/v1/facilities/fac-1/availability?date=${today}`,
      { headers: { Authorization: `Bearer ${resident}` } }
    );

    expect(status).toBe(200);
    const slot07 = json.data.slots.find((s) => s.start === '07:00');
    expect(slot07.status).toBe('mine');
  });

  it('returns 400 for a missing/invalid date param', async () => {
    const { status } = await request(
      'GET',
      '/api/v1/facilities/fac-1/availability',
      { headers: { Authorization: `Bearer ${resident}` } }
    );
    expect(status).toBe(400);
  });

  it('returns 404 when facility not found in community', async () => {
    // queryOne returns null → facility not in community
    queryOne.mockResolvedValueOnce(null);

    const { status } = await request(
      'GET',
      `/api/v1/facilities/no-such/availability?date=${today}`,
      { headers: { Authorization: `Bearer ${resident}` } }
    );
    expect(status).toBe(404);
  });
});

// ── POST /facilities/:id/book ────────────────────────────────────────────────

describe('POST /facilities/:id/book', () => {
  it('rejects a date outside booking window (10 days out) → 400', async () => {
    // Call order:
    //  1. queryOne → facility (must load facility before window check in handler)
    queryOne.mockResolvedValueOnce(fakeFacility);

    const { status, json } = await request(
      'POST',
      '/api/v1/facilities/fac-1/book',
      {
        headers: { Authorization: `Bearer ${resident}` },
        body: { date: tenDaysOut, start: '06:00' },
      }
    );
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/Outside booking window/i);
  });

  it('rejects a slot already booked → 409', async () => {
    // Call order:
    //  1. queryOne → facility
    //  2. queryOne → slot conflict check (returns existing booking)
    queryOne
      .mockResolvedValueOnce(fakeFacility)         // facility load
      .mockResolvedValueOnce({ id: 'bk-existing' }); // slot conflict

    const { status, json } = await request(
      'POST',
      '/api/v1/facilities/fac-1/book',
      {
        headers: { Authorization: `Bearer ${resident}` },
        body: { date: inThreeDays, start: '06:00' },
      }
    );
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/Slot already booked/i);
  });

  it('enforces one-per-sport-per-day per unit → 409', async () => {
    // Call order:
    //  1. queryOne → facility
    //  2. queryOne → slot conflict (null — slot is free)
    //  3. queryOne → sport conflict (returns existing booking for this sport today)
    queryOne
      .mockResolvedValueOnce(fakeFacility)     // facility load
      .mockResolvedValueOnce(null)             // no slot conflict
      .mockResolvedValueOnce({ id: 'bk-sport' }); // sport conflict

    const { status, json } = await request(
      'POST',
      '/api/v1/facilities/fac-1/book',
      {
        headers: { Authorization: `Bearer ${resident}` },
        body: { date: inThreeDays, start: '06:00' },
      }
    );
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/already have a slot for this sport/i);
  });

  it('creates a booking and returns 201 with correct shape', async () => {
    // Call order:
    //  1. queryOne → facility
    //  2. queryOne → slot conflict (null)
    //  3. queryOne → sport conflict (null)
    //  4. queryOne → INSERT RETURNING booking row
    queryOne
      .mockResolvedValueOnce(fakeFacility)   // facility load
      .mockResolvedValueOnce(null)           // no slot conflict
      .mockResolvedValueOnce(null)           // no sport conflict
      .mockResolvedValueOnce({              // newly inserted booking
        id: 'bk-new',
        facility_id: 'fac-1',
        booking_date: inThreeDays,
        start_time: '06:00:00',
        end_time: '07:00:00',
      });

    const { status, json } = await request(
      'POST',
      '/api/v1/facilities/fac-1/book',
      {
        headers: { Authorization: `Bearer ${resident}` },
        body: { date: inThreeDays, start: '06:00' },
      }
    );

    expect(status).toBe(201);
    expect(json.data.id).toBe('bk-new');
    expect(json.data.facilityId).toBe('fac-1');
    expect(json.data.date).toBe(inThreeDays);
    expect(json.data.start).toBe('06:00');
    expect(json.data.end).toBe('07:00');
    expect(json.data.status).toBe('booked');
  });

  it('rejects invalid body (bad date format) → 400', async () => {
    const { status } = await request(
      'POST',
      '/api/v1/facilities/fac-1/book',
      {
        headers: { Authorization: `Bearer ${resident}` },
        body: { date: 'not-a-date', start: '06:00' },
      }
    );
    expect(status).toBe(400);
  });
});

// ── GET /facilities/mine ─────────────────────────────────────────────────────

describe('GET /facilities/mine', () => {
  it('requires a resident token — 401 without auth', async () => {
    const { status } = await request('GET', '/api/v1/facilities/mine');
    expect(status).toBe(401);
  });

  it('returns upcoming bookings with correct shape', async () => {
    queryRows.mockResolvedValueOnce([
      {
        id: 'bk-1',
        facility_name: 'Badminton Court',
        sport: 'badminton',
        date: inThreeDays,
        start: '06:00',
        end: '07:00',
      },
    ]);

    const { status, json } = await request('GET', '/api/v1/facilities/mine', {
      headers: { Authorization: `Bearer ${resident}` },
    });

    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    const b = json.data[0];
    expect(b.id).toBe('bk-1');
    expect(b.facilityName).toBe('Badminton Court');
    expect(b.sport).toBe('badminton');
  });
});

// ── DELETE /facilities/bookings/:id ─────────────────────────────────────────

describe('DELETE /facilities/bookings/:id', () => {
  it('returns 404 when booking not found for this unit', async () => {
    queryOne.mockResolvedValueOnce(null); // not found

    const { status } = await request('DELETE', '/api/v1/facilities/bookings/bk-999', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    expect(status).toBe(404);
  });

  it('returns 409 "Too late to cancel" when slot is within 1 hour', async () => {
    // booking_date = today, start_time = 00:00:00 (clearly in the past → within 1h window)
    // Call order:
    //  1. queryOne → booking row
    queryOne.mockResolvedValueOnce({
      id: 'bk-past',
      booking_date: today,
      start_time: '00:00:00',
    });

    const { status, json } = await request('DELETE', '/api/v1/facilities/bookings/bk-past', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/Too late to cancel/i);
  });

  it('cancels a future booking and returns { cancelled: true }', async () => {
    // booking_date = inThreeDays → well outside the 1-hour cutoff
    // Call order:
    //  1. queryOne → booking row
    //  2. query    → UPDATE status = 'cancelled'
    queryOne.mockResolvedValueOnce({
      id: 'bk-future',
      booking_date: inThreeDays,
      start_time: '10:00:00',
    });
    query.mockResolvedValueOnce({ rowCount: 1 });

    const { status, json } = await request('DELETE', '/api/v1/facilities/bookings/bk-future', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    expect(status).toBe(200);
    expect(json.data).toEqual({ cancelled: true });
  });
});
