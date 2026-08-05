import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { bookingPolicy } from '../routes/facilities.js';

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
const { sendNotification } = await import('../lib/fcm.js');

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
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({});
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const today = new Date().toISOString().slice(0, 10);
const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const tenDaysOut = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

// ── bookingPolicy (pure function) ────────────────────────────────────────────

describe('bookingPolicy (pure function)', () => {
  it('applies the historical hardcoded defaults when a facility has no overrides', () => {
    expect(bookingPolicy({})).toEqual({
      advanceDays: 7,
      cancelCutoffMinutes: 60,
      maxPerUnitPerDay: 1,
    });
  });

  it('applies the historical defaults when the columns are explicitly null', () => {
    expect(bookingPolicy({ advance_days: null, cancel_cutoff_minutes: null, max_per_unit_per_day: null }))
      .toEqual({ advanceDays: 7, cancelCutoffMinutes: 60, maxPerUnitPerDay: 1 });
  });

  it('reads per-facility overrides from the row', () => {
    expect(bookingPolicy({ advance_days: 14, cancel_cutoff_minutes: 0, max_per_unit_per_day: 2 }))
      .toEqual({ advanceDays: 14, cancelCutoffMinutes: 0, maxPerUnitPerDay: 2 });
  });
});

// ── POST /facilities/:id/book — configurable advance window ────────────────

describe('POST /facilities/:id/book — configurable advance_days', () => {
  it('accepts a booking 10 days out when the facility allows a 14-day window', async () => {
    const facility = {
      id: 'fac-1', name: 'Badminton Court', sport: 'badminton',
      open_time: '06:00:00', close_time: '22:00:00', slot_minutes: 60,
      advance_days: 14, cancel_cutoff_minutes: 60, max_per_unit_per_day: 1,
    };
    queryOne
      .mockResolvedValueOnce(facility)   // facility load
      .mockResolvedValueOnce(null)       // no slot conflict
      .mockResolvedValueOnce(null)       // no sport conflict
      .mockResolvedValueOnce({
        id: 'bk-new', facility_id: 'fac-1', booking_date: tenDaysOut,
        start_time: '06:00:00', end_time: '07:00:00',
      });
    queryRows.mockResolvedValueOnce([]); // fcm token lookup for the push, if any

    const { status } = await request('POST', '/api/v1/facilities/fac-1/book', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { date: tenDaysOut, start: '06:00' },
    });
    expect(status).toBe(201);
  });

  it('still rejects the same 10-day-out booking on a facility with the default 7-day window', async () => {
    const facility = {
      id: 'fac-1', name: 'Badminton Court', sport: 'badminton',
      open_time: '06:00:00', close_time: '22:00:00', slot_minutes: 60,
      advance_days: 7, cancel_cutoff_minutes: 60, max_per_unit_per_day: 1,
    };
    queryOne.mockResolvedValueOnce(facility);

    const { status, json } = await request('POST', '/api/v1/facilities/fac-1/book', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { date: tenDaysOut, start: '06:00' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/Outside booking window/i);
  });
});

// ── POST /facilities/:id/book — max_per_unit_per_day ────────────────────────

describe('POST /facilities/:id/book — configurable max_per_unit_per_day', () => {
  it('allows a second same-sport booking on the same day when the facility allows 2 per unit per day', async () => {
    const facility = {
      id: 'fac-1', name: 'Badminton Court', sport: 'badminton',
      open_time: '06:00:00', close_time: '22:00:00', slot_minutes: 60,
      advance_days: 7, cancel_cutoff_minutes: 60, max_per_unit_per_day: 2,
    };
    queryOne
      .mockResolvedValueOnce(facility)     // facility load
      .mockResolvedValueOnce(null)         // no slot conflict
      .mockResolvedValueOnce({ n: 1 })     // one existing same-sport booking today — but cap is 2
      .mockResolvedValueOnce({
        id: 'bk-new', facility_id: 'fac-1', booking_date: inThreeDays,
        start_time: '06:00:00', end_time: '07:00:00',
      });
    queryRows.mockResolvedValueOnce([]);

    const { status } = await request('POST', '/api/v1/facilities/fac-1/book', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { date: inThreeDays, start: '06:00' },
    });
    expect(status).toBe(201);
  });

  it('still rejects a second same-sport booking when the facility keeps the default cap of 1', async () => {
    const facility = {
      id: 'fac-1', name: 'Badminton Court', sport: 'badminton',
      open_time: '06:00:00', close_time: '22:00:00', slot_minutes: 60,
      advance_days: 7, cancel_cutoff_minutes: 60, max_per_unit_per_day: 1,
    };
    queryOne
      .mockResolvedValueOnce(facility)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ n: 1 });

    const { status, json } = await request('POST', '/api/v1/facilities/fac-1/book', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { date: inThreeDays, start: '06:00' },
    });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/already have a slot for this sport/i);
  });
});

// ── DELETE /facilities/bookings/:id — configurable cancel_cutoff_minutes ───

describe('DELETE /facilities/bookings/:id — configurable cancel_cutoff_minutes', () => {
  it('allows cancelling right up to the start when cancel_cutoff_minutes = 0', async () => {
    // booking starts in 2 minutes — inside the old 60-minute cutoff, but the
    // facility now allows cancellation up to the very start of the slot.
    // The handler anchors booking_date/start_time to IST (see facilities.js's
    // own istNow/istNowHHMM), so build the fixture the same way it would be
    // interpreted: shift "now" by the IST offset before formatting.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const target = new Date(Date.now() + 2 * 60000);
    const istTarget = new Date(target.getTime() + IST_OFFSET_MS);
    const dateStr = istTarget.toISOString().slice(0, 10);
    const hhmm = istTarget.toISOString().slice(11, 16);

    queryOne.mockResolvedValueOnce({
      id: 'bk-soon',
      booking_date: dateStr,
      start_time: `${hhmm}:00`,
      cancel_cutoff_minutes: 0,
    });
    query.mockResolvedValueOnce({ rowCount: 1 });

    const { status } = await request('DELETE', '/api/v1/facilities/bookings/bk-soon', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    // Loosen: just assert it is not rejected purely by the old fixed 60-minute
    // cutoff (i.e. it must not be the generic 409 "Too late to cancel" case
    // for a 0-cutoff facility this close but not yet past).
    expect(status).toBe(200);
  });

  it('still rejects a cancellation within the default 60-minute cutoff', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'bk-past',
      booking_date: today,
      start_time: '00:00:00',
      cancel_cutoff_minutes: 60,
    });

    const { status, json } = await request('DELETE', '/api/v1/facilities/bookings/bk-past', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/Too late to cancel/i);
  });
});

// ── POST /facilities/:id/book — booking confirmation push ──────────────────

describe('POST /facilities/:id/book — confirmation push', () => {
  const facility = {
    id: 'fac-1', name: 'Badminton Court', sport: 'badminton',
    open_time: '06:00:00', close_time: '22:00:00', slot_minutes: 60,
    advance_days: 7, cancel_cutoff_minutes: 60, max_per_unit_per_day: 1,
  };

  it('still returns 201 when the push fails, and never throws out of the request', async () => {
    queryOne
      .mockResolvedValueOnce(facility)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bk-new', facility_id: 'fac-1', booking_date: inThreeDays,
        start_time: '06:00:00', end_time: '07:00:00',
      });
    queryRows.mockRejectedValueOnce(new Error('token lookup exploded'));

    const { status, json } = await request('POST', '/api/v1/facilities/fac-1/book', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { date: inThreeDays, start: '06:00' },
    });
    expect(status).toBe(201);
    expect(json.data.id).toBe('bk-new');
  });
});
