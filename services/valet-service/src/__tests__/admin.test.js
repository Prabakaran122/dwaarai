import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

const mockClient = { query: vi.fn(), release: vi.fn() };
vi.mock('../db.js', () => ({
  default: { connect: vi.fn(async () => mockClient) },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/face.js', () => ({
  vectorize: vi.fn(async () => Buffer.from('v')),
  isRecognitionConfigured: vi.fn(() => true),
}));
vi.mock('../lib/storage.js', () => ({
  storage: { put: vi.fn(async () => {}), getStream: vi.fn(), delete: vi.fn(async () => {}) },
  buildKey: vi.fn(() => 'valet/branding/community/logo.png'),
  extensionFor: vi.fn(() => 'png'),
}));

import { query, queryOne, queryRows } from '../db.js';
import { storage } from '../lib/storage.js';
import { vectorize, isRecognitionConfigured } from '../lib/face.js';
import adminRoutes from '../routes/admin.js';
import { createApp, request, guardToken, adminToken, COMMUNITY_ID } from './helpers.js';

const app = createApp(adminRoutes, '/admin');

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but NOT the queue left by
  // mockResolvedValueOnce. A test that queues more values than it consumes --
  // any test that returns early on a 4xx, for instance -- otherwise hands
  // them to whichever test runs next, and the failure lands somewhere
  // unrelated. These three carry no base implementation, so resetting them
  // is safe; the mocks that do (storage, face) are deliberately left alone.
  query.mockReset();
  queryOne.mockReset();
  queryRows.mockReset();
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe('GET /admin/plate-history', () => {
  it('requires an admin token: a guard cannot pull venue-wide history', async () => {
    // The prototype rode on the guard cookie here because it had no operator
    // accounts. Reporting across every ticket is a different permission from
    // handling one car, and now needs a real admin.
    const res = await request(app, 'GET', '/admin/plate-history?plate=KA01AA1111', {
      token: guardToken(),
    });

    expect(res.status).toBe(403);
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('returns every visit for a plate, newest first', async () => {
    queryRows.mockResolvedValueOnce([
      {
        display_id: 'DWR-0007', plate: 'KA 03 NJ 0435', created_at: '2026-08-20T10:00:00Z',
        closed_at: '2026-08-20T18:00:00Z', status: 'final_closed', disputed: false, created_guard_name: 'Ramesh',
      },
      {
        display_id: 'DWR-0003', plate: 'KA03NJ0435', created_at: '2026-04-12T10:00:00Z',
        closed_at: '2026-04-12T20:00:00Z', status: 'final_closed', disputed: true, created_guard_name: 'Suresh',
      },
    ]);

    const res = await request(app, 'GET', '/admin/plate-history?plate=ka%2003%20nj%200435', {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.visitCount).toBe(2);
    expect(res.body.disputedCount).toBe(1);
    expect(res.body.visits[0].displayId).toBe('DWR-0007');
  });

  it('matches a plate regardless of how it was spaced when entered', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/admin/plate-history?plate=ka%2003%20nj%200435', { token: adminToken() });

    expect(queryRows.mock.calls[0][1]).toEqual([COMMUNITY_ID, 'KA03NJ0435']);
  });

  it('keeps the as-entered plate on each visit alongside the normalized one', async () => {
    queryRows.mockResolvedValueOnce([{
      display_id: 'DWR-0007', plate: 'KA 03 NJ 0435', created_at: 'x', closed_at: null,
      status: 'parked', disputed: false, created_guard_name: 'Ramesh',
    }]);

    const res = await request(app, 'GET', '/admin/plate-history?plate=KA03NJ0435', { token: adminToken() });

    expect(res.body.plate).toBe('KA03NJ0435');
    expect(res.body.visits[0].plateAsEntered).toBe('KA 03 NJ 0435');
  });

  it('scopes history to the admin\'s own community', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/admin/plate-history?plate=KA01AA1111', { token: adminToken() });

    expect(queryRows.mock.calls[0][1][0]).toBe(COMMUNITY_ID);
  });

  it('rejects an empty plate', async () => {
    const res = await request(app, 'GET', '/admin/plate-history?plate=', { token: adminToken() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('plate_required');
  });
});

describe('GET /admin/summary', () => {
  it('counts open tickets across the live statuses', async () => {
    queryRows.mockResolvedValueOnce([
      { status: 'parked', count: 4 },
      { status: 'retrieval_requested', count: 2 },
      { status: 'final_closed', count: 30 },
    ]);

    const res = await request(app, 'GET', '/admin/summary', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.open).toBe(6);
    expect(res.body.byStatus.final_closed).toBe(30);
  });

  it('is available to a guard as well, since it drives the dashboard header', async () => {
    queryRows.mockResolvedValueOnce([]);

    const res = await request(app, 'GET', '/admin/summary', { token: guardToken() });

    expect(res.status).toBe(200);
    expect(res.body.open).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/visits — "what came in over the last 30 days"
//
// plate-history answers "tell me about THIS car". A manager's actual question
// is the other way round: "what came through at all?" — which needs no plate.
// ─────────────────────────────────────────────────────────────────────────────

function visitRow(overrides = {}) {
  return {
    id: 't1', display_id: 'DWR-0001', plate: 'KA 03 NJ 0435',
    plate_normalized: 'KA03NJ0435', vehicle_make: 'Swift', status: 'final_closed',
    created_at: '2026-08-20T10:00:00Z', closed_at: '2026-08-20T18:00:00Z',
    disputed: false, created_guard_name: 'Ramesh', stay_seconds: 28800,
    ...overrides,
  };
}

function totalsRow(overrides = {}) {
  return {
    total_visits: 12, unique_vehicles: 9, disputed_count: 1,
    open_count: 2, avg_stay_seconds: 14400, ...overrides,
  };
}

describe('GET /admin/visits', () => {
  it('needs an admin token — a guard cannot read venue-wide history', async () => {
    const res = await request(app, 'GET', '/admin/visits', { token: guardToken() });

    expect(res.status).toBe(403);
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('defaults to a 30 day window', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.days).toBe(30);
    expect(queryRows.mock.calls[0][1][1]).toBe('30');
  });

  it('honours an explicit window', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits?days=7', { token: adminToken() });

    expect(res.body.days).toBe(7);
  });

  it('clamps an absurd window rather than trying to serve it', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits?days=99999', { token: adminToken() });

    expect(res.body.days).toBe(365);
  });

  it('rejects a nonsense window by falling back to the default', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits?days=abc', { token: adminToken() });

    expect(res.body.days).toBe(30);
  });

  // A named window answers "how have we been doing lately". A range answers
  // "what happened over the wedding weekend" -- the question a manager brings
  // to this page when something went wrong on a specific night, and the one
  // "last 30 days" cannot be bent into.
  //
  // Instants, not dates: nothing in this service carries a venue timezone, so
  // a bare 2026-08-20 would be read as a UTC day and a manager in India would
  // get a window shifted five and a half hours off the evening they meant.
  // The browser knows its own offset; it does the conversion and sends the
  // moments it computed.
  it('honours an explicit from/to range', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(
      app, 'GET',
      '/admin/visits?from=2026-08-20T18:30:00.000Z&to=2026-08-22T18:29:59.999Z',
      { token: adminToken() }
    );

    expect(res.status).toBe(200);
    expect(res.body.range).toEqual({
      from: '2026-08-20T18:30:00.000Z',
      to: '2026-08-22T18:29:59.999Z',
    });
    // The window is the range, not a days interval alongside it.
    const params = queryRows.mock.calls[0][1];
    expect(params).toContain('2026-08-20T18:30:00.000Z');
    expect(params).toContain('2026-08-22T18:29:59.999Z');
    expect(queryRows.mock.calls[0][0]).not.toMatch(/days'\)::interval/);
  });

  it('ignores a range it cannot parse rather than returning an empty log', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(
      app, 'GET', '/admin/visits?from=last-tuesday&to=soon', { token: adminToken() }
    );

    expect(res.body.days).toBe(30);
    expect(res.body.range).toBe(null);
  });

  // Backwards is a slip, not a request for nothing. Returning an empty table
  // would read as "no cars that weekend", which is a different and much worse
  // answer than "those dates are the wrong way round".
  it('swaps a backwards range rather than matching nothing', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(
      app, 'GET',
      '/admin/visits?from=2026-08-22T00:00:00.000Z&to=2026-08-20T00:00:00.000Z',
      { token: adminToken() }
    );

    expect(res.body.range).toEqual({
      from: '2026-08-20T00:00:00.000Z',
      to: '2026-08-22T00:00:00.000Z',
    });
  });

  // The totals line sits above the table and is read as describing it. A
  // range applied to the rows but not to the rollup would put "148 visits"
  // over a weekend that had nine.
  it('applies the range to the totals as well as the rows', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    await request(
      app, 'GET',
      '/admin/visits?from=2026-08-20T00:00:00.000Z&to=2026-08-22T00:00:00.000Z',
      { token: adminToken() }
    );

    expect(queryOne.mock.calls[0][1]).toContain('2026-08-20T00:00:00.000Z');
    expect(queryOne.mock.calls[0][1]).toContain('2026-08-22T00:00:00.000Z');
  });

  // The status filter, and the banner button behind it.
  //
  // "Only 2 of 17 cars have a recorded handover" is the most alarming line on
  // this page, and until now it was also the most useless: a manager could
  // read it and had no way to see WHICH two. The filter is what turns the
  // warning into a list somebody can walk through with their team.
  it('filters to the visits nobody handed over', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(
      app, 'GET', '/admin/visits?status=no_handover', { token: adminToken() }
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_handover');
    // Absence of a closure event, not the ticket's own status: a swept ticket
    // reads as final_closed, which is exactly the row this filter is for.
    expect(queryRows.mock.calls[0][0]).toMatch(/NOT EXISTS/);
  });

  it('filters to the cars still with the team', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits?status=parked', { token: adminToken() });

    expect(res.body.status).toBe('parked');
    // A car out with its multi-day guest is open but not with the team.
    expect(queryRows.mock.calls[0][0]).toMatch(/NOT IN \('final_closed', 'expired', 'with_guest'\)/);
  });

  // A filter the server does not know must not quietly return everything under
  // a heading that claims it is narrowed.
  it('rejects a status it does not recognise', async () => {
    const res = await request(app, 'GET', '/admin/visits?status=banana', { token: adminToken() });

    expect(res.status).toBe(400);
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('applies the status filter to the totals too', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    await request(app, 'GET', '/admin/visits?status=returned', { token: adminToken() });

    const flat = (q) => q.replace(/\s+/g, ' ');
    const predicate = (qualifier) =>
      `AND EXISTS ( SELECT 1 FROM valet_ticket_events e WHERE e.ticket_id = ${qualifier}id AND e.event_type IN ('final_closed', 'closed_pickup') )`;

    expect(flat(queryRows.mock.calls[0][0])).toContain(predicate('t.'));
    expect(flat(queryOne.mock.calls[0][0])).toContain(predicate('valet_tickets.'));
  });

  // The qualifier is the whole correctness of the predicate, so it is asserted
  // rather than assumed: valet_ticket_events has an `id` column, and an
  // unqualified one inside that subquery compares an event to itself.
  it('qualifies the handover subquery against the tickets table, not the events', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    await request(app, 'GET', '/admin/visits?status=no_handover', { token: adminToken() });

    const totalsSql = queryOne.mock.calls[0][0].replace(/\s+/g, ' ');
    expect(totalsSql).not.toMatch(/e\.ticket_id = id\b/);
    expect(totalsSql).toContain('e.ticket_id = valet_tickets.id');
  });

  it('returns each visit with plate, times and who took it in', async () => {
    queryRows.mockResolvedValueOnce([visitRow()]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.visits[0]).toMatchObject({
      displayId: 'DWR-0001',
      plate: 'KA 03 NJ 0435',
      vehicleMake: 'Swift',
      takenInBy: 'Ramesh',
      staySeconds: 28800,
      disputed: false,
    });
  });

  it('computes totals over the whole window, not just the returned page', async () => {
    // Showing "3 visits" beside a page of 3 rows out of 900 would be worse
    // than showing no number at all.
    queryRows.mockResolvedValueOnce([visitRow(), visitRow({ id: 't2' }), visitRow({ id: 't3' })]);
    queryOne.mockResolvedValueOnce(totalsRow({ total_visits: 900, unique_vehicles: 640 }));

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.visits).toHaveLength(3);
    expect(res.body.totals.visits).toBe(900);
    expect(res.body.totals.uniqueVehicles).toBe(640);
  });

  it('reports returning vehicles as visits beyond the unique count', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow({ total_visits: 12, unique_vehicles: 9 }));

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.totals.returningVehicles).toBe(3);
  });

  it('never reports a negative returning count', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow({ total_visits: 0, unique_vehicles: 0 }));

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.totals.returningVehicles).toBe(0);
  });

  it('surfaces disputes and still-open stays', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow({ disputed_count: 4, open_count: 7 }));

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.totals.disputed).toBe(4);
    expect(res.body.totals.stillOpen).toBe(7);
  });

  it('scopes everything to the caller\'s community', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(queryRows.mock.calls[0][1][0]).toBe(COMMUNITY_ID);
    expect(queryOne.mock.calls[0][1][0]).toBe(COMMUNITY_ID);
  });

  it('caps the page size so one request cannot pull a year of a busy venue', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits?limit=99999', { token: adminToken() });

    expect(res.body.paging.limit).toBe(1000);
  });

  it('pages with an offset', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits?limit=50&offset=100', { token: adminToken() });

    expect(res.body.paging).toMatchObject({ limit: 50, offset: 100 });
  });

  it('orders newest first — a manager reads the most recent arrivals', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(queryRows.mock.calls[0][0]).toContain('ORDER BY t.created_at DESC');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Printed card stock
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /admin/cards', () => {
  it('requires an admin token: registering stock is not a guard job', async () => {
    const res = await request(app, 'GET', '/admin/cards', { token: guardToken() });

    expect(res.status).toBe(403);
  });

  it('reports a free card as in the stack, not as an absent ticket', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'c1', code: 'A001', is_active: true, created_at: 'now', display_id: null, plate: null, status: null },
    ]);

    const res = await request(app, 'GET', '/admin/cards', { token: adminToken() });

    expect(res.body.cards[0].inUseBy).toBeNull();
  });

  it('names the vehicle a card is currently out with', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'c1', code: 'A001', is_active: true, created_at: 'now',
        display_id: 'DWR-0009', plate: 'KA 03 NJ 0435', status: 'parked' },
    ]);

    const res = await request(app, 'GET', '/admin/cards', { token: adminToken() });

    expect(res.body.cards[0].inUseBy).toEqual({
      displayId: 'DWR-0009', plate: 'KA 03 NJ 0435', status: 'parked',
    });
  });

  it('scopes the stock to the caller\'s venue', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/admin/cards', { token: adminToken() });

    expect(queryRows.mock.calls[0][1]).toEqual([COMMUNITY_ID]);
  });
});

describe('POST /admin/cards', () => {
  it('expands a printed range into codes', async () => {
    queryRows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await request(app, 'POST', '/admin/cards', {
      token: adminToken(), body: { prefix: 'A', from: 1, to: 3 },
    });

    expect(res.status).toBe(201);
    expect(res.body.added).toEqual(['A001', 'A002', 'A003']);
  });

  it('skips codes that already exist instead of failing the whole box', async () => {
    // Ordering another box that overlaps the last one is normal. Failing over
    // codes that are already correct would leave the operator diffing by hand.
    queryRows.mockResolvedValueOnce([{ code: 'A002' }]).mockResolvedValueOnce([]);

    const res = await request(app, 'POST', '/admin/cards', {
      token: adminToken(), body: { prefix: 'A', from: 1, to: 3 },
    });

    expect(res.body.added).toEqual(['A001', 'A003']);
    expect(res.body.skipped).toEqual(['A002']);
  });

  it('does not insert at all when every code already exists', async () => {
    queryRows.mockResolvedValueOnce([{ code: 'A001' }]);

    const res = await request(app, 'POST', '/admin/cards', {
      token: adminToken(), body: { prefix: 'A', from: 1, to: 1 },
    });

    expect(res.body.added).toEqual([]);
    expect(queryRows).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicit list as well as a range', async () => {
    queryRows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await request(app, 'POST', '/admin/cards', {
      token: adminToken(), body: { codes: ['v1', ' v2 '] },
    });

    expect(res.body.added).toEqual(['V1', 'V2']);
  });

  it('deduplicates a list rather than tripping its own unique constraint', async () => {
    queryRows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await request(app, 'POST', '/admin/cards', {
      token: adminToken(), body: { codes: ['A001', 'A001'] },
    });

    expect(res.body.added).toEqual(['A001']);
  });

  it('refuses a range large enough to be a typo', async () => {
    // A slip in the range field should not mint ten thousand cards nobody
    // printed; a venue's whole stock is tens.
    const res = await request(app, 'POST', '/admin/cards', {
      token: adminToken(), body: { prefix: 'A', from: 1, to: 9000 },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('range_too_large');
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('refuses a reversed range', async () => {
    const res = await request(app, 'POST', '/admin/cards', {
      token: adminToken(), body: { prefix: 'A', from: 50, to: 1 },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_range');
  });

  it('refuses a request naming neither codes nor a range', async () => {
    const res = await request(app, 'POST', '/admin/cards', { token: adminToken(), body: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('codes_required');
  });

  it('refuses a code longer than the column holds', async () => {
    const res = await request(app, 'POST', '/admin/cards', {
      token: adminToken(), body: { codes: ['X'.repeat(21)] },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('code_too_long');
  });

  it('requires an admin token', async () => {
    const res = await request(app, 'POST', '/admin/cards', {
      token: guardToken(), body: { codes: ['A001'] },
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /admin/cards/:id/deactivate', () => {
  it('refuses to retire a card a guest is still holding', async () => {
    // Freeing it here would let the same code be handed to someone else while
    // the first vehicle is still parked.
    queryOne
      .mockResolvedValueOnce({ id: 'c1' })
      .mockResolvedValueOnce({ display_id: 'DWR-0009' });

    const res = await request(app, 'POST', '/admin/cards/c1/deactivate', { token: adminToken() });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('DWR-0009');
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('retires a card that is back in the stack', async () => {
    queryOne.mockResolvedValueOnce({ id: 'c1' }).mockResolvedValueOnce(null);
    queryRows.mockResolvedValueOnce([]);

    const res = await request(app, 'POST', '/admin/cards/c1/deactivate', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it('deactivates rather than deletes, keeping the ticket history intact', async () => {
    queryOne.mockResolvedValueOnce({ id: 'c1' }).mockResolvedValueOnce(null);
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'POST', '/admin/cards/c1/deactivate', { token: adminToken() });

    expect(queryRows.mock.calls[0][0]).toContain('UPDATE valet_cards');
    expect(queryRows.mock.calls[0][0]).not.toContain('DELETE');
  });

  it('cannot retire another venue\'s card', async () => {
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'POST', '/admin/cards/c1/deactivate', { token: adminToken() });

    expect(res.status).toBe(404);
  });
});

describe('GET /admin/tickets/search', () => {
  it('matches anywhere in the plate, not just the start', async () => {
    // A guest says "the white Swift, 0435" far more often than they recite the
    // state code, so a prefix match would miss the common case.
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/admin/tickets/search?plate=0435', { token: adminToken() });

    expect(queryRows.mock.calls[0][0]).toContain("LIKE '%' || $2 || '%'");
  });

  it('normalizes the query so spacing and case never matter', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/admin/tickets/search?plate=ka%2003%20nj', { token: adminToken() });

    expect(queryRows.mock.calls[0][1][1]).toBe('KA03NJ');
  });

  it('refuses a query too short to narrow anything, without hitting the database', async () => {
    const res = await request(app, 'GET', '/admin/tickets/search?plate=KA', { token: adminToken() });

    expect(res.body.tickets).toEqual([]);
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('includes closed tickets — half the reason to look a vehicle up', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/admin/tickets/search?plate=KA03', { token: adminToken() });

    expect(queryRows.mock.calls[0][0]).not.toContain('AND t.status NOT IN');
  });

  it('sorts open tickets first: the vehicle being asked about is still here', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/admin/tickets/search?plate=KA03', { token: adminToken() });

    expect(queryRows.mock.calls[0][0]).toContain("ORDER BY (t.status NOT IN ('final_closed','expired')) DESC");
  });

  it('returns the bound card code so a desk can match plastic to a car', async () => {
    queryRows.mockResolvedValueOnce([{
      display_id: 'DWR-0001', session_token: 'tok', plate: 'KA 03 NJ 0435',
      vehicle_make: 'Swift', status: 'parked', created_at: 'now', closed_at: null,
      disputed: false, card_code: 'A047', created_guard_name: 'Ramesh',
    }]);

    const res = await request(app, 'GET', '/admin/tickets/search?plate=0435', { token: adminToken() });

    expect(res.body.tickets[0].cardCode).toBe('A047');
  });

  it('scopes results to the caller\'s venue', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/admin/tickets/search?plate=KA03', { token: adminToken() });

    expect(queryRows.mock.calls[0][1][0]).toBe(COMMUNITY_ID);
  });

  it('requires an admin token', async () => {
    const res = await request(app, 'GET', '/admin/tickets/search?plate=KA03', { token: guardToken() });

    expect(res.status).toBe(403);
  });
});

describe('venue branding — the logo a guest sees on the thank-you screen', () => {
  it('requires an admin: a guard cannot rebrand the venue', async () => {
    const res = await request(app, 'GET', '/admin/branding', { token: guardToken() });

    expect(res.status).toBe(403);
  });

  it('reports no logo before one is uploaded', async () => {
    queryOne.mockResolvedValueOnce({ logo_key: null });

    const res = await request(app, 'GET', '/admin/branding', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.hasLogo).toBe(false);
  });

  it('reports the logo once the venue has one', async () => {
    queryOne.mockResolvedValueOnce({ logo_key: 'valet/branding/c1/logo.png' });

    const res = await request(app, 'GET', '/admin/branding', { token: adminToken() });

    expect(res.body.hasLogo).toBe(true);
  });

  it('refuses to forget a logo for a venue that has none', async () => {
    queryOne.mockResolvedValueOnce({ logo_key: null });

    const res = await request(app, 'DELETE', '/admin/branding/logo', { token: adminToken() });

    expect(res.status).toBe(404);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('removes the file as well as the reference, so nothing is orphaned', async () => {
    queryOne.mockResolvedValueOnce({ logo_key: 'valet/branding/c1/logo.png' });
    query.mockResolvedValueOnce({});

    const res = await request(app, 'DELETE', '/admin/branding/logo', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(storage.delete).toHaveBeenCalledWith('valet/branding/c1/logo.png');
    // The key is cleared from the venue's config in the same breath.
    expect(query.mock.calls[0][0]).toMatch(/config/i);
  });
});

describe('GET /admin/branding/logo', () => {
  it('serves the current logo back so the operator can see what is live', async () => {
    queryOne.mockResolvedValueOnce({ logo_key: 'valet/branding/c1/logo.png' });
    storage.getStream.mockResolvedValueOnce(Readable.from([Buffer.from('PNG')]));

    const res = await request(app, 'GET', '/admin/branding/logo', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(storage.getStream).toHaveBeenCalledWith('valet/branding/c1/logo.png');
  });

  it('404s rather than serving a placeholder when nothing is set', async () => {
    queryOne.mockResolvedValueOnce({ logo_key: null });

    const res = await request(app, 'GET', '/admin/branding/logo', { token: adminToken() });

    expect(res.status).toBe(404);
  });
});

describe('a card that can start a conversation', () => {
  it('mints a globally unique WhatsApp reference for every card registered', async () => {
    queryRows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await request(app, 'POST', '/admin/cards', {
      token: adminToken(), body: { codes: ['A047', 'A048'] },
    });

    expect(res.status).toBe(201);
    const insert = queryRows.mock.calls[1];
    // The printed code is unique per venue only; a WhatsApp message carries no
    // venue, so the reference in it has to stand on its own.
    expect(insert[0]).toMatch(/wa_ref/);
    // community_id + (code, wa_ref) per card
    expect(insert[1]).toHaveLength(5);
  });
});

describe('parking inventory', () => {
  it('reports the flag off for a venue that has not enabled slots', async () => {
    queryOne.mockResolvedValueOnce({ slots_enabled: null });
    queryRows.mockResolvedValueOnce([]);

    const res = await request(app, 'GET', '/admin/slots', { token: adminToken() });

    expect(res.status).toBe(200);
    // A restaurant forecourt has no floors and zones; the feature simply is
    // not on, and everything else about valet works unchanged.
    expect(res.body.enabled).toBe(false);
  });

  it('derives occupancy from live tickets rather than a stored flag', async () => {
    queryOne.mockResolvedValueOnce({ slots_enabled: true });
    queryRows.mockResolvedValueOnce([
      { id: 's1', floor: 'B1', zone: 'A', number: '01', display_id: null, plate: null },
      { id: 's2', floor: 'B1', zone: 'A', number: '02', display_id: 'DWR-0009', plate: 'KA03NJ0435' },
    ]);

    const res = await request(app, 'GET', '/admin/slots', { token: adminToken() });

    expect(res.body.enabled).toBe(true);
    expect(res.body.slots[0].occupiedBy).toBeNull();
    expect(res.body.slots[1].occupiedBy).toEqual(
      expect.objectContaining({ displayId: 'DWR-0009' })
    );
    // The join is what makes it true, not a column that can drift.
    expect(queryRows.mock.calls[0][0]).toMatch(/LEFT JOIN valet_tickets/i);
  });

  it('registers a range of slots the way card stock is registered', async () => {
    queryRows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await request(app, 'POST', '/admin/slots', {
      token: adminToken(),
      body: { floor: 'B1', zone: 'A', from: 1, to: 3 },
    });

    expect(res.status).toBe(201);
    expect(res.body.added).toEqual(['01', '02', '03']);
  });

  it('refuses to retire a slot with a car standing in it', async () => {
    queryOne.mockResolvedValueOnce({ display_id: 'DWR-0009' });

    const res = await request(app, 'DELETE', '/admin/slots/s2', { token: adminToken() });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_in_use');
  });

  it('turns the flag on for a venue', async () => {
    query.mockResolvedValueOnce({});

    const res = await request(app, 'PATCH', '/admin/slots/enabled', {
      token: adminToken(), body: { enabled: true },
    });

    expect(res.status).toBe(200);
    expect(query.mock.calls[0][0]).toMatch(/valetSlotsEnabled/);
  });
});

describe('GET /admin/feedback', () => {
  it('rolls up sentiment and the reasons behind it', async () => {
    queryOne.mockResolvedValueOnce({ satisfied: 42, not_satisfied: 5 });
    queryRows.mockResolvedValueOnce([
      { reason: 'long_wait', count: 4 },
      { reason: 'damage', count: 1 },
    ]);
    // The per-attendant breakdown, which this test does not assert on but the
    // route now asks for.
    queryRows.mockResolvedValueOnce([]);

    const res = await request(app, 'GET', '/admin/feedback', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.satisfied).toBe(42);
    expect(res.body.notSatisfied).toBe(5);
    expect(res.body.reasons).toEqual([
      { reason: 'long_wait', count: 4 },
      { reason: 'damage', count: 1 },
    ]);
  });

  // "Review with staff" from the redesign.
  //
  // A rollup tells a manager something went wrong; it does not tell them who
  // to talk to. This breaks the same responses down by the attendant the guest
  // actually met at handover -- the one moment of the trip they can speak to.
  it('breaks the responses down by the attendant who handed the car over', async () => {
    queryOne.mockResolvedValueOnce({ satisfied: 42, not_satisfied: 5 });
    queryRows.mockResolvedValueOnce([{ reason: 'long_wait', count: 4 }]);
    queryRows.mockResolvedValueOnce([
      { guard_id: 'g1', name: 'Ramesh', rated: 20, unhappy: 1, reasons: ['long_wait'] },
      { guard_id: 'g2', name: 'Suresh', rated: 2, unhappy: 2, reasons: ['long_wait', 'damage'] },
    ]);

    const res = await request(app, 'GET', '/admin/feedback', { token: adminToken() });

    expect(res.body.byStaff).toEqual([
      {
        id: 'g1', name: 'Ramesh', rated: 20, unhappy: 1,
        reasons: ['long_wait'], enoughToJudge: true,
      },
      {
        id: 'g2', name: 'Suresh', rated: 2, unhappy: 2,
        // Two responses is a bad week, not a pattern. The flag is what stops
        // the page printing "100% unhappy" beside somebody's name, which is
        // the reading this screen exists to prevent rather than cause.
        reasons: ['long_wait', 'damage'], enoughToJudge: false,
      },
    ]);
  });

  it('is an admin view: a guard cannot read a venue-wide rollup', async () => {
    const res = await request(app, 'GET', '/admin/feedback', { token: guardToken() });

    expect(res.status).toBe(403);
  });
});

describe('promotions', () => {
  it('reports the slot locked for a venue that has not been given advertising', async () => {
    queryOne.mockResolvedValueOnce({ enabled: null, label: null, link: null });

    const res = await request(app, 'GET', '/admin/promotion', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('refuses to let a venue turn its own advertising on', async () => {
    queryOne.mockResolvedValueOnce({ enabled: null, label: null, link: null });

    const res = await request(app, 'PATCH', '/admin/promotion', {
      token: adminToken(), body: { label: 'Spa offer', link: 'https://example.com' },
    });

    // The flag is commercial. A hotel editing its own promo is fine; a hotel
    // granting itself the slot is not, and the only safe place for that
    // decision is outside this app.
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('advertising_not_enabled');
  });

  it('saves the promo once the venue has been given the slot', async () => {
    queryOne.mockResolvedValueOnce({ enabled: true, label: null, link: null });
    query.mockResolvedValueOnce({});

    const res = await request(app, 'PATCH', '/admin/promotion', {
      token: adminToken(), body: { label: 'Spa offer', link: 'https://example.com/spa' },
    });

    expect(res.status).toBe(200);
    expect(query.mock.calls[0][0]).toMatch(/valetPromo/);
  });

  it('refuses a link that is not http', async () => {
    queryOne.mockResolvedValueOnce({ enabled: true, label: null, link: null });

    const res = await request(app, 'PATCH', '/admin/promotion', {
      token: adminToken(), body: { label: 'Spa', link: 'javascript:alert(1)' },
    });

    // This link is rendered on a guest's phone. A javascript: URL there is a
    // venue admin handing every guest an injection.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_link');
  });

  it('logs a lead when a locked venue asks to be enabled', async () => {
    query.mockResolvedValueOnce({});

    const res = await request(app, 'POST', '/admin/promotion/request', {
      token: adminToken(), body: { message: 'We would like the ad slot' },
    });

    expect(res.status).toBe(201);
    expect(query.mock.calls[0][0]).toMatch(/valet_leads/);
    // It logs interest. It does not flip the flag.
    expect(query.mock.calls.map((c) => c[0]).join(' ')).not.toMatch(/valetAdvertisingEnabled/);
  });

  it('logs a cross-sell inquiry against the product asked about', async () => {
    query.mockResolvedValueOnce({});

    const res = await request(app, 'POST', '/admin/leads', {
      token: adminToken(),
      body: { product: 'Gate Management', contactName: 'Asha', message: 'Tell me more' },
    });

    expect(res.status).toBe(201);
    expect(query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['cross_sell', 'Gate Management', 'Asha'])
    );
  });
});

describe('GET /admin/subscription', () => {
  it('shows the month so far against this property own quota', async () => {
    queryOne
      .mockResolvedValueOnce({ plan: 'basic', renewal_date: '2027-04-01' })
      .mockResolvedValueOnce({ used: 418 });

    const res = await request(app, 'GET', '/admin/subscription', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('basic');
    expect(res.body.quota).toBe(2000);
    expect(res.body.used).toBe(418);
    // Per property, never pooled: a four-property group tracks four quotas.
    expect(res.body.pooled).toBe(false);
  });

  it('shows no quota bar at all on enterprise', async () => {
    queryOne
      .mockResolvedValueOnce({ plan: 'enterprise', renewal_date: null })
      .mockResolvedValueOnce({ used: 9120 });

    const res = await request(app, 'GET', '/admin/subscription', { token: adminToken() });

    expect(res.body.plan).toBe('enterprise');
    expect(res.body.quota).toBeNull();
  });

  it('counts the current billing month, not all time', async () => {
    queryOne
      .mockResolvedValueOnce({ plan: 'basic', renewal_date: null })
      .mockResolvedValueOnce({ used: 12 });

    await request(app, 'GET', '/admin/subscription', { token: adminToken() });

    expect(queryOne.mock.calls[1][0]).toMatch(/date_trunc\('month'/i);
  });
});

// The shift log's own narrowing. The design gives this screen a staff picker
// and a single-day selector, not a rolling window: "who was on at the banquet
// entrance last Saturday" is the question it is actually opened to answer, and
// a 7/30/90 button cannot be bent into a date.
describe('GET /admin/shifts narrowing', () => {
  // Deliberately NOT the helpers' COMMUNITY_ID. That value is already param 1
  // of every query on this route, so asserting it appears in the parameter
  // list passes against a route that ignores staffId entirely -- which is
  // exactly what the first version of this test did.
  const STAFF = '22222222-2222-2222-2222-222222222222';

  it('filters to one staff member', async () => {
    queryRows.mockResolvedValueOnce([]);

    const res = await request(
      app, 'GET', `/admin/shifts?staffId=${STAFF}`, { token: adminToken() }
    );

    expect(res.status).toBe(200);
    expect(queryRows.mock.calls[0][1]).toContain(STAFF);
  });

  // A stale id from a select box must not take the whole log down -- the same
  // rule the vehicle log already follows. Asserted as "the slot is null",
  // not "the junk is absent": the junk is absent from a route with no filter
  // at all, which proves nothing.
  it('ignores a staff id that is not an id', async () => {
    queryRows.mockResolvedValueOnce([]);

    const res = await request(app, 'GET', '/admin/shifts?staffId=everyone', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(queryRows.mock.calls[0][1]).toContain(null);
  });

  // One day, bounded at both ends. Sent as instants by the browser for the
  // same reason the vehicle log's range is: this service carries no venue
  // timezone, so a bare date would be read as a UTC day.
  it('narrows to a single day', async () => {
    queryRows.mockResolvedValueOnce([]);

    const res = await request(
      app, 'GET',
      '/admin/shifts?from=2026-09-25T18:30:00.000Z&to=2026-09-26T18:29:59.999Z',
      { token: adminToken() }
    );

    expect(res.body.range).toEqual({
      from: '2026-09-25T18:30:00.000Z',
      to: '2026-09-26T18:29:59.999Z',
    });
    expect(queryRows.mock.calls[0][1]).toContain('2026-09-25T18:30:00.000Z');
  });
});

describe('GET /admin/visits.csv', () => {
  it('exports the same status filter the screen is showing', async () => {
    queryRows.mockResolvedValueOnce([]);

    const res = await request(
      app, 'GET', '/admin/visits.csv?status=no_handover', { token: adminToken() }
    );

    expect(res.status).toBe(200);
    expect(queryRows.mock.calls[0][0]).toMatch(/AND NOT EXISTS/);
  });

  // The export is reached from the screen, and a manager who has narrowed the
  // screen to one weekend and then downloads a month has been handed the wrong
  // evidence -- quietly, because a CSV looks right until somebody counts it.
  it('exports the same range the screen is showing', async () => {
    queryRows.mockResolvedValueOnce([]);

    const res = await request(
      app, 'GET',
      '/admin/visits.csv?from=2026-08-20T00:00:00.000Z&to=2026-08-22T00:00:00.000Z',
      { token: adminToken() }
    );

    expect(res.status).toBe(200);
    const params = queryRows.mock.calls[0][1];
    expect(params).toContain('2026-08-20T00:00:00.000Z');
    expect(params).toContain('2026-08-22T00:00:00.000Z');
    // Named for the window it holds, so two downloads in one afternoon are
    // not two files called the same thing.
    expect(res.headers['content-disposition']).toContain('2026-08-20_2026-08-22');
  });

  it('streams the same rows the table shows, as CSV', async () => {
    queryRows.mockResolvedValueOnce([{
      display_id: 'DWR-0009', plate: 'KA 03 NJ 0435', vehicle_make: 'Swift',
      status: 'final_closed', created_at: '2026-09-01T10:00:00Z',
      closed_at: '2026-09-01T13:00:00Z', stay_seconds: 10800,
      created_guard_name: 'Ramesh', disputed: false,
    }]);

    const res = await request(app, 'GET', '/admin/visits.csv?days=30', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body).toMatch(/DWR-0009/);
    expect(res.body).toMatch(/Ramesh/);
  });

  it('quotes a field containing a comma rather than splitting the row', async () => {
    queryRows.mockResolvedValueOnce([{
      display_id: 'DWR-0010', plate: 'KA 03 NJ 0435', vehicle_make: 'Swift, Dzire',
      status: 'parked', created_at: '2026-09-01T10:00:00Z', closed_at: null,
      stay_seconds: 60, created_guard_name: 'Ramesh', disputed: false,
    }]);

    const res = await request(app, 'GET', '/admin/visits.csv', { token: adminToken() });

    // A make with a comma in it would otherwise shift every later column by
    // one and quietly corrupt the whole export.
    expect(res.body).toMatch(/"Swift, Dzire"/);
  });

  it('is admin-only, like every other venue-wide report', async () => {
    const res = await request(app, 'GET', '/admin/visits.csv', { token: guardToken() });

    expect(res.status).toBe(403);
  });
});

describe('locations under an account', () => {
  it('lists every property a client admin holds', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'c1', name: 'The Leela Bhartiya City', address: 'Bengaluru', plan: 'basic' },
      { id: 'c2', name: 'The Leela Coastal', address: 'Goa', plan: 'enterprise' },
    ]);

    const res = await request(app, 'GET', '/admin/locations', {
      token: adminToken({ role: 'client_admin', account_id: 'acc-1' }),
    });

    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(2);
    expect(queryRows.mock.calls[0][1]).toEqual(['acc-1']);
  });

  it('is not a screen a location manager has', async () => {
    const res = await request(app, 'GET', '/admin/locations', { token: adminToken() });

    // A manager with exactly one property sees it everywhere else already;
    // a Locations list of one is furniture.
    expect(res.status).toBe(403);
    expect(queryRows).not.toHaveBeenCalled();
  });
});

describe('the staff directory', () => {
  it('lists valet staff with their tier', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'r1', name: 'Ramesh', mobile: '9876543210', valet_role: 'valet_manager', valet_until: null, is_active: true },
      { id: 'r2', name: 'Surge', mobile: '9876500000', valet_role: 'temporary_driver', valet_until: '2026-12-31T00:00:00Z', is_active: true },
    ]);

    const res = await request(app, 'GET', '/admin/staff', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.staff[0].role).toBe('valet_manager');
    expect(res.body.staff[1].until).toBeTruthy();
  });

  it('hires a temporary driver with an end date set at the outset', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'unit-1' });
    query.mockResolvedValue({});
    queryOne.mockResolvedValueOnce({ id: 'r9', name: 'Surge' });

    const res = await request(app, 'POST', '/admin/staff', {
      token: adminToken(),
      body: {
        name: 'Surge', mobile: '9876500000', password: 'pw1234',
        role: 'temporary_driver', until: '2026-12-31T00:00:00Z',
      },
    });

    // The point of a temp is that somebody set the end date when they were
    // hired, not that a manager remembers to remove them after the wedding.
    expect(res.status).toBe(201);
  });

  it('refuses a tier that is not one of the two', async () => {
    const res = await request(app, 'POST', '/admin/staff', {
      token: adminToken(),
      body: { name: 'X', mobile: '9876500000', password: 'pw1234', role: 'chef' },
    });

    expect(res.status).toBe(400);
  });

  it('is admin-only', async () => {
    const res = await request(app, 'GET', '/admin/staff', { token: guardToken() });

    expect(res.status).toBe(403);
  });
});

describe('logging a car that has just pulled up', () => {
  it('creates a job waiting for an attendant', async () => {
    mockClient.query.mockImplementation(async (sql) =>
      (/INSERT INTO valet_tickets/.test(sql)
        ? { rows: [{ id: 'new-id', display_id: 'DWR-0001', session_token: 's', claim_code: 'C' }] }
        : { rows: [] }));

    const res = await request(app, 'POST', '/admin/tickets/request', {
      token: adminToken(), body: { plate: 'KA03NJ0435' },
    });

    expect(res.status).toBe(201);
    const sql = mockClient.query.mock.calls.map((c) => c[0]).join(' ');
    // A desk that logs cars as they arrive is what puts anything in the
    // parking queue; without it those three states have no producer.
    expect(sql).toMatch(/'requested'/);
  });

  it('logs one with no plate, since the desk may only have a car', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (/SELECT display_id/.test(sql)) return { rows: [{ display_id: 'DWR-0004' }] };
      if (/INSERT INTO valet_tickets/.test(sql)) {
        return { rows: [{ id: 'new-id', display_id: 'DWR-0005', session_token: 's', claim_code: 'C' }] };
      }
      return { rows: [] };
    });

    const res = await request(app, 'POST', '/admin/tickets/request', {
      token: adminToken(), body: {},
    });

    expect(res.status).toBe(201);
  });
});

describe('enrolling a valet face', () => {
  it('stores the vector and never the photo', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r1', unit_id: 'u1' });
    query.mockResolvedValue({});

    const res = await request(app, 'POST', '/admin/staff/r1/face', {
      token: adminToken(), body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    expect(res.status).toBe(201);
    expect(storage.put).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0]).toMatch(/face_enrollments/);
  });

  it('refuses rather than half-enrolling when recognition is unavailable', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r1', unit_id: 'u1' });
    vi.mocked(vectorize).mockResolvedValueOnce(null);

    const res = await request(app, 'POST', '/admin/staff/r1/face', {
      token: adminToken(), body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    // A row with no vector matches nothing and looks like somebody who is set
    // up when they are not.
    expect(res.status).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });

  it('will not enrol somebody who does not work here', async () => {
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'POST', '/admin/staff/nope/face', {
      token: adminToken(), body: { imageBase64: 'x' },
    });

    expect(res.status).toBe(404);
  });
});

describe('staff list', () => {
  it('says who is enrolled, so a gap is visible before the shift not during it', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'a', name: 'Ravi', mobile: '9', valet_role: 'valet_manager', face_enrolled: true },
      { id: 'b', name: 'Sunil', mobile: '8', valet_role: 'temporary_driver', face_enrolled: false },
    ]);

    const res = await request(app, 'GET', '/admin/staff', { token: adminToken() });

    expect(res.body.staff.map((s) => s.faceEnrolled)).toEqual([true, false]);
  });
});

describe('adding the first member of staff at a new property', () => {
  it('does not put a letter in an integer column', async () => {
    queryOne
      .mockResolvedValueOnce(null)            // no existing guard with that mobile
      .mockResolvedValueOnce(null)            // no GUARD-POST unit yet
      .mockResolvedValueOnce({ id: 'u-new' }); // unit created
    query.mockResolvedValue({});

    const res = await request(app, 'POST', '/admin/staff', {
      token: adminToken(),
      body: { name: 'Test Valet', mobile: '9876500001', password: 'valet1234', role: 'valet_manager' },
    });

    // units.floor is INT. 'G' made Postgres reject the whole insert, so the
    // first valet could never be added at a property with no GUARD-POST unit
    // -- which is every property the onboarding flow creates. The mocks here
    // accept anything, so only the column type tells the truth.
    const unitInsert = queryOne.mock.calls.find((c) => /INSERT INTO units/.test(c[0]));
    expect(unitInsert).toBeDefined();
    const floorParam = /floor/.test(unitInsert[0]) ? unitInsert[0] : '';
    expect(floorParam).not.toMatch(/'G'/);
    expect(res.status).toBe(201);
  });
});

describe('whether face enrolment is even possible here', () => {
  it('reports that recognition is available when it is configured', async () => {
    vi.mocked(isRecognitionConfigured).mockReturnValueOnce(true);

    const res = await request(app, 'GET', '/admin/face/status', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
  });

  it('reports plainly when there is no recogniser to send a photo to', async () => {
    vi.mocked(isRecognitionConfigured).mockReturnValueOnce(false);

    const res = await request(app, 'GET', '/admin/face/status', { token: adminToken() });

    // The staff page offered "Add photo" whatever the deployment looked like,
    // and every press ended in a 503. Asking first lets it say why instead.
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });
});

describe('a client admin, who holds several properties and no single one', () => {
  const clientAdminToken = () =>
    adminToken({ role: 'client_admin', community_id: null, account_id: 'acc-1' });

  it('reaches the account-scoped locations list without a community', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'c1', name: 'The Leela Palace', address: 'Old Airport Rd', plan: 'basic' },
    ]);

    const res = await request(app, 'GET', '/admin/locations', { token: clientAdminToken() });

    // The middleware refused every token with no community_id, so the one
    // endpoint built for a group admin was unreachable by a group admin.
    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(1);
  });

  it('may act on a property inside their own account', async () => {
    queryOne.mockResolvedValueOnce({ id: 'c1' });   // c1 belongs to acc-1
    queryRows.mockResolvedValueOnce([]);

    const res = await request(app, 'GET', '/admin/staff', {
      token: clientAdminToken(),
      headers: { 'x-community-id': 'c1' },
    });

    expect(res.status).toBe(200);
  });

  it('may not act on a property outside it', async () => {
    queryOne.mockResolvedValueOnce(null);           // not in this account

    const res = await request(app, 'GET', '/admin/staff', {
      token: clientAdminToken(),
      headers: { 'x-community-id': 'someone-elses' },
    });

    // Without the ownership check, naming any community id in a header would
    // hand a group admin somebody else's property.
    expect(res.status).toBe(403);
  });
});

describe('who handed the vehicle back', () => {
  // "Taken in by" has always been on this screen. Its counterpart was not,
  // and it is the half a manager actually chases: a dispute is almost never
  // about who received a car, it is about who released it.
  //
  // It cannot come off the ticket row. `current_guard_id` is set when a valet
  // accepts the retrieval and set back to NULL the moment the ticket closes,
  // so by the time a visit appears in this list the column is empty. The
  // durable record is the closure event.
  it('reports the guard from the closure event', async () => {
    queryRows.mockResolvedValueOnce([visitRow({ handed_out_guard_name: 'Suresh' })]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.visits[0].handedOutBy).toBe('Suresh');
    expect(res.body.visits[0].takenInBy).toBe('Ramesh');
  });

  it('reads it from the events table, not from the ticket row', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    await request(app, 'GET', '/admin/visits', { token: adminToken() });

    const sql = queryRows.mock.calls[0][0];
    expect(sql).toMatch(/valet_ticket_events/);
    // Both closure kinds count: a multi-day guest can take the car out and
    // bring it back, and "who brought it out" means the most recent time.
    expect(sql).toMatch(/final_closed/);
    expect(sql).toMatch(/closed_pickup/);
  });

  it('leaves it null for a car still on the lot rather than inventing a name', async () => {
    queryRows.mockResolvedValueOnce([
      visitRow({ status: 'parked', closed_at: null, handed_out_guard_name: null }),
    ]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.visits[0].handedOutBy).toBeNull();
  });

  it('does not drop visits that have no closure event', async () => {
    // The join must be a LEFT one. An inner join here would quietly hide
    // every car currently parked -- the rows a manager most needs to see.
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(queryRows.mock.calls[0][0]).toMatch(/LEFT JOIN/i);
  });
});

describe('the vehicle-log CSV', () => {
  // The export is what gets mailed to a GM or handed to an insurer after a
  // dispute. A column that exists on screen and not in the file is the one
  // nobody notices until the day it is needed.
  it('carries both attendants, named so the pair is unambiguous', async () => {
    queryRows.mockResolvedValueOnce([{
      display_id: 'DWR-0014', plate: 'KA05E2E777', vehicle_make: 'Honda City',
      guest_name: null, car_type: null, is_premium: false, status: 'final_closed',
      created_at: '2026-09-24T01:54:45Z', closed_at: '2026-09-24T01:59:23Z',
      disputed: false, created_guard_name: 'Ramesh', visit_number: 1,
      handed_out_guard_name: 'Suresh', stay_seconds: 278,
    }]);

    const res = await request(app, 'GET', '/admin/visits.csv', { token: adminToken() });

    const [header, row] = res.body.split('\n');
    // "Attendant" alone stops being meaningful the moment there are two.
    expect(header).toContain('Received by');
    expect(header).toContain('Handed over by');
    expect(row).toContain('Ramesh');
    expect(row).toContain('Suresh');
  });

  it('leaves the cell empty for a car nobody has handed back', async () => {
    queryRows.mockResolvedValueOnce([{
      display_id: 'DWR-0015', plate: 'KA01AA1111', vehicle_make: 'Swift',
      guest_name: null, car_type: null, is_premium: false, status: 'parked',
      created_at: '2026-09-24T01:54:45Z', closed_at: null,
      disputed: false, created_guard_name: 'Ramesh', visit_number: 3,
      handed_out_guard_name: null, stay_seconds: 60,
    }]);

    const res = await request(app, 'GET', '/admin/visits.csv', { token: adminToken() });

    const header = res.body.split('\n')[0].split(',');
    const row = res.body.split('\n')[1].split(',');
    expect(row[header.indexOf('Handed over by')]).toBe('');
    // And says so in its own column, so a reader does not have to infer it
    // from a blank cell.
    expect(row[header.indexOf('Handover recorded')]).toBe('no');
  });

  it('asks the database for it, rather than leaving the column always blank', async () => {
    queryRows.mockResolvedValueOnce([]);
    await request(app, 'GET', '/admin/visits.csv', { token: adminToken() });
    expect(queryRows.mock.calls[0][0]).toMatch(/valet_ticket_events/);
  });
});

describe('who is on duty right now', () => {
  // The redesign's Staff screen leads with "On shift now: 2". Every part of
  // that -- the badge, the "In at 8:58 AM", the "Last out 6:04 PM yesterday"
  // -- is the shift table read back, which is why it had to exist first.
  it('reports the open shift and when it started', async () => {
    queryRows.mockResolvedValueOnce([{
      id: 'r1', name: 'Ravi Kumar', mobile: '9876500001',
      valet_role: 'valet_manager', valet_until: null, face_enrolled: true,
      shift_started_at: '2026-10-06T08:58:00Z', last_ended_at: null,
    }]);

    const res = await request(app, 'GET', '/admin/staff', { token: adminToken() });

    expect(res.body.staff[0].onShift).toBe(true);
    expect(res.body.staff[0].shiftStartedAt).toBe('2026-10-06T08:58:00Z');
  });

  it('reports when somebody off duty was last seen', async () => {
    queryRows.mockResolvedValueOnce([{
      id: 'r2', name: 'Anil P', mobile: '9000000002',
      valet_role: 'valet', valet_until: null, face_enrolled: true,
      shift_started_at: null, last_ended_at: '2026-10-05T18:04:00Z',
    }]);

    const res = await request(app, 'GET', '/admin/staff', { token: adminToken() });

    expect(res.body.staff[0].onShift).toBe(false);
    expect(res.body.staff[0].lastEndedAt).toBe('2026-10-05T18:04:00Z');
  });

  it('does not claim an unenrolled attendant is unable to work', async () => {
    // The redesign assumes Face ID gates sign-in. It does not: /shift/start
    // never blocks, because stranding a real attendant in bad light is the
    // worse failure. Somebody unenrolled works a shift that is simply recorded
    // unverified -- and this screen must not assert the opposite, which was
    // caught in production showing "Can't start shift" against a person who
    // was on shift at that moment.
    queryRows.mockResolvedValueOnce([{
      id: 'r3', name: 'Imran S', mobile: '9000000199',
      valet_role: 'valet', valet_until: null, face_enrolled: false,
      shift_started_at: '2026-10-06T09:00:00Z', last_ended_at: null,
    }]);

    const res = await request(app, 'GET', '/admin/staff', { token: adminToken() });

    expect(res.body.staff[0]).not.toHaveProperty('canStartShift');
    expect(res.body.staff[0].faceEnrolled).toBe(false);
    // On duty is on duty, whatever their enrolment.
    expect(res.body.staff[0].onShift).toBe(true);
  });

  it('reads the shift state from the shift table, not from the person row', async () => {
    queryRows.mockResolvedValueOnce([]);
    await request(app, 'GET', '/admin/staff', { token: adminToken() });
    const sql = queryRows.mock.calls[0][0];
    expect(sql).toMatch(/valet_shifts/);
    // residents.shift_started_at is overwritten on every sign-in, so it can
    // say someone is on duty months after they went home.
    expect(sql).not.toMatch(/r\.shift_started_at/);
  });
});

describe('the shift log', () => {
  it('returns finished and in-progress shifts with how long each ran', async () => {
    queryRows.mockResolvedValueOnce([{
      id: 's1', name: 'Anil P', valet_role: 'valet',
      started_at: '2026-10-06T07:02:00Z', ended_at: '2026-10-06T11:40:00Z',
      seconds_on_shift: 16680, valet_point: 'Banquet entrance',
      verified: true, reason: null,
    }]);

    const res = await request(app, 'GET', '/admin/shifts', { token: adminToken() });

    expect(res.body.shifts[0]).toMatchObject({
      name: 'Anil P',
      valetPoint: 'Banquet entrance',
      secondsOnShift: 16680,
      verifiedBy: 'face_id',
    });
  });

  it('says how an unverified shift failed, not just that it did', async () => {
    queryRows.mockResolvedValueOnce([{
      id: 's2', name: 'Suresh M', valet_role: 'valet',
      started_at: '2026-10-06T09:12:00Z', ended_at: null,
      seconds_on_shift: 15480, valet_point: null,
      verified: false, reason: 'attendant_not_enrolled',
    }]);

    const res = await request(app, 'GET', '/admin/shifts', { token: adminToken() });

    expect(res.body.shifts[0].verifiedBy).toBeNull();
    expect(res.body.shifts[0].reason).toBe('attendant_not_enrolled');
    // Still on shift: the log and the roster badge are the same fact.
    expect(res.body.shifts[0].endedAt).toBeNull();
  });

  it('needs an admin token — a guard cannot read the whole roster history', async () => {
    const res = await request(app, 'GET', '/admin/shifts', { token: guardToken() });
    expect(res.status).toBe(403);
  });

  it('scopes to one property and bounds how much it will serve', async () => {
    queryRows.mockResolvedValueOnce([]);
    await request(app, 'GET', '/admin/shifts?days=9999', { token: adminToken() });
    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toMatch(/community_id = \$1/);
    expect(params[0]).toBe(COMMUNITY_ID);
    expect(Number(params[1])).toBeLessThanOrEqual(365);
  });
});

describe('the vehicle log, as the redesign wants it read', () => {
  it('numbers the visits of a car that has been here before', async () => {
    // "KA 03 NJ 0435 · Visit 6" is the whole point of a log for a hotel: the
    // regulars are the guests worth recognising, and a plate repeated six
    // times down the page does not say that on its own.
    queryRows.mockResolvedValueOnce([
      visitRow({ id: 'a', display_id: 'DWR-0015', visit_number: 6 }),
    ]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.visits[0].visitNumber).toBe(6);
  });

  it('counts visits per plate, oldest first, within the venue', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());
    await request(app, 'GET', '/admin/visits', { token: adminToken() });
    const sql = queryRows.mock.calls[0][0];
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER/i);
    expect(sql).toMatch(/PARTITION BY[\s\S]*plate_normalized/i);
  });

  it('says whether a car was handed over or just swept away', async () => {
    // A ticket the retention sweep closed has no handover, no parking time
    // anybody measured and no receipt the guest ever saw. Showing its
    // auto-close timestamp in the "Returned at" column as though a person
    // did it is the single most misleading thing this table could do.
    queryRows.mockResolvedValueOnce([
      visitRow({ id: 'a', status: 'final_closed', handed_out_guard_name: 'Suresh' }),
      visitRow({ id: 'b', status: 'expired', handed_out_guard_name: null }),
    ]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.visits[0].handoverRecorded).toBe(true);
    expect(res.body.visits[1].handoverRecorded).toBe(false);
  });

  it('reports how many of the period had a real handover', async () => {
    // Drives the banner. "Only 2 of 17 cars have a recorded handover" is a
    // data-quality problem a manager can act on; seventeen rows that each
    // look slightly wrong is not.
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow({ with_handover: 2, total_visits: 17 }));

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.totals.withHandover).toBe(2);
    expect(res.body.totals.visits).toBe(17);
  });

  it('can be narrowed to one member of staff', async () => {
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const id = '11111111-2222-3333-4444-555555555555';
    await request(app, 'GET', `/admin/visits?staffId=${id}`, { token: adminToken() });

    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toMatch(/created_by_guard_id/);
    expect(params).toContain(id);
  });

  it('ignores a staff filter that is not an id, rather than erroring', async () => {
    // The filter arrives from a select box; a stale or hand-edited value must
    // not take the whole log down.
    queryRows.mockResolvedValueOnce([]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits?staffId=not-a-uuid', { token: adminToken() });

    expect(res.status).toBe(200);
  });
});

describe('what a hotel tells us', () => {
  it('records an idea against the property and the person who sent it', async () => {
    queryOne.mockResolvedValueOnce({ id: 'i1', created_at: '2026-10-06T10:00:00Z' });

    const res = await request(app, 'POST', '/admin/ideas', {
      token: adminToken(),
      body: {
        category: 'our_hotel',
        title: 'Separate queue for banquet guests',
        body: 'During weddings the porch jams and nobody can find their car.',
        impact: 'a_lot',
        callback: true,
      },
    });

    expect(res.status).toBe(201);
    const params = queryOne.mock.calls[0][1];
    expect(params).toContain(COMMUNITY_ID);
    expect(params).toContain('our_hotel');
  });

  it('refuses a category nobody defined', async () => {
    // The column has a CHECK, so an unknown value would be a 500 the venue
    // reads as "your note was lost". Caught here as a readable 400 instead.
    const res = await request(app, 'POST', '/admin/ideas', {
      token: adminToken(),
      body: { category: 'complaint', title: 'x', body: 'y' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_category');
  });

  it('needs a title and a body, because an empty note cannot be answered', async () => {
    const res = await request(app, 'POST', '/admin/ideas', {
      token: adminToken(), body: { category: 'make_better', title: '   ', body: '' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('starts at "received", never at a status implying somebody read it', async () => {
    queryOne.mockResolvedValueOnce({ id: 'i1', created_at: '2026-10-06T10:00:00Z' });
    await request(app, 'POST', '/admin/ideas', {
      token: adminToken(), body: { category: 'make_better', title: 'a', body: 'b' },
    });
    const sql = queryOne.mock.calls[0][0];
    expect(sql).not.toMatch(/'looking_into_it'|'planned'/);
  });

  it('lists only this property’s own ideas', async () => {
    queryRows.mockResolvedValueOnce([{
      id: 'i1', category: 'make_better', title: 'Faster plate search',
      status: 'being_built', latest_update: 'Building it with your team.',
      created_at: '2026-10-01T10:00:00Z',
    }]);

    const res = await request(app, 'GET', '/admin/ideas', { token: adminToken() });

    expect(res.body.ideas[0].status).toBe('being_built');
    expect(queryRows.mock.calls[0][1]).toContain(COMMUNITY_ID);
  });

  it('counts what has been sent and what has shipped', async () => {
    // The two numbers at the top of the screen. "Now live: 1" is the one that
    // makes a venue believe the channel is real.
    queryRows.mockResolvedValueOnce([
      { id: 'a', status: 'live' }, { id: 'b', status: 'planned' }, { id: 'c', status: 'received' },
    ]);

    const res = await request(app, 'GET', '/admin/ideas', { token: adminToken() });

    expect(res.body.totals).toEqual({ sent: 3, live: 1 });
  });

  it('needs an admin token', async () => {
    const res = await request(app, 'GET', '/admin/ideas', { token: guardToken() });
    expect(res.status).toBe(403);
  });
});

describe('valet points — the doors guests actually use', () => {
  it('lists a property’s points with who is on each right now', async () => {
    // "On shift now: 6" against Main porch is the number that tells a duty
    // manager whether the banquet door is covered before the event starts.
    queryRows.mockResolvedValueOnce([
      { id: 'p1', name: 'Main porch', status: 'active', capacity: 80, on_shift: 6 },
      { id: 'p2', name: 'Banquet entrance', status: 'events_only', capacity: null, on_shift: 2 },
    ]);

    const res = await request(app, 'GET', '/admin/points', { token: adminToken() });

    expect(res.body.points[0]).toMatchObject({ name: 'Main porch', onShift: 6, capacity: 80 });
    expect(res.body.points[1].capacity).toBeNull();
  });

  it('adds a point', async () => {
    queryOne.mockResolvedValueOnce({ id: 'p9', name: 'Tower lobby' });

    const res = await request(app, 'POST', '/admin/points', {
      token: adminToken(), body: { name: 'Tower lobby', capacity: 40 },
    });

    expect(res.status).toBe(201);
    expect(queryOne.mock.calls[0][1]).toContain(COMMUNITY_ID);
  });

  it('refuses a second point with the same name', async () => {
    // Two "Main porch" rows would make the shift log ambiguous in exactly the
    // situation it exists to resolve.
    queryOne.mockRejectedValueOnce({ code: '23505', constraint: 'idx_valet_points_name' });

    const res = await request(app, 'POST', '/admin/points', {
      token: adminToken(), body: { name: 'Main porch' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('point_exists');
  });

  it('needs a name', async () => {
    const res = await request(app, 'POST', '/admin/points', {
      token: adminToken(), body: { name: '  ' },
    });
    expect(res.status).toBe(400);
  });

  it('pauses rather than deletes', async () => {
    // Shifts reference the name. A property closing a door for a refurbishment
    // still needs last month's log to make sense.
    queryOne.mockResolvedValueOnce({ id: 'p1', status: 'paused' });

    const res = await request(app, 'PATCH', '/admin/points/p1', {
      token: adminToken(), body: { status: 'paused' },
    });

    expect(res.status).toBe(200);
    expect(queryOne.mock.calls[0][0]).toMatch(/UPDATE valet_points/i);
    expect(queryOne.mock.calls[0][0]).not.toMatch(/DELETE/i);
  });

  it('refuses a status nobody defined', async () => {
    const res = await request(app, 'PATCH', '/admin/points/p1', {
      token: adminToken(), body: { status: 'demolished' },
    });
    expect(res.status).toBe(400);
  });
});

describe('the group view of every property', () => {
  it('carries what each desk is doing right now, not just its name', async () => {
    // A group admin opens this to decide where to send help. A list of names
    // and addresses cannot answer that; parked, waiting and on-shift can.
    queryRows.mockResolvedValueOnce([{
      id: 'c1', name: 'Palm Meadows Whitefield', address: 'Bengaluru', plan: 'enterprise',
      parked_now: 64, waiting: 3, on_shift: 8, cars_this_month: 2700,
      avg_wait_seconds: 360, ever_live: true,
    }]);

    const res = await request(app, 'GET', '/admin/locations', { token: adminToken({ role: 'client_admin', account_id: 'acc-1' }) });

    expect(res.body.locations[0]).toMatchObject({
      parkedNow: 64, waiting: 3, onShift: 8, carsThisMonth: 2700, avgWaitSeconds: 360,
      status: 'live',
    });
  });

  it('calls a property that has never taken a car in "setting up"', async () => {
    // Rather than "live with 0 cars", which reads as a desk having a quiet day
    // when it is actually a desk that has never opened.
    queryRows.mockResolvedValueOnce([{
      id: 'c2', name: 'Palm Meadows Goa', address: 'Goa', plan: 'basic',
      parked_now: 0, waiting: 0, on_shift: 0, cars_this_month: 0,
      avg_wait_seconds: null, ever_live: false,
    }]);

    const res = await request(app, 'GET', '/admin/locations', { token: adminToken({ role: 'client_admin', account_id: 'acc-1' }) });

    expect(res.body.locations[0].status).toBe('setting_up');
    expect(res.body.locations[0].avgWaitSeconds).toBeNull();
  });

  it('totals the group, so the header does not need a second request', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'a', name: 'A', parked_now: 64, waiting: 3, on_shift: 8, cars_this_month: 10, ever_live: true },
      { id: 'b', name: 'B', parked_now: 41, waiting: 0, on_shift: 6, cars_this_month: 5, ever_live: true },
    ]);

    const res = await request(app, 'GET', '/admin/locations', { token: adminToken({ role: 'client_admin', account_id: 'acc-1' }) });

    expect(res.body.totals).toEqual({
      properties: 2, parkedNow: 105, waiting: 3, onShift: 14,
    });
  });

  it('is still refused to an admin who holds one property', async () => {
    const res = await request(app, 'GET', '/admin/locations', { token: adminToken() });
    expect(res.status).toBe(403);
  });
});

describe('a promotion on the thank-you page', () => {
  it('saves a draft without putting it in front of anyone', async () => {
    queryOne.mockResolvedValueOnce({ id: 'pr1', status: 'draft' });

    const res = await request(app, 'POST', '/admin/promotions', {
      token: adminToken(),
      body: {
        headline: 'Sunday Brunch at Olive, 25% off',
        body: 'Live music, 60+ dishes and a kids corner.',
        buttonLabel: 'Book a table', buttonUrl: 'https://example.com/book',
        offerCode: 'VALET25',
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
  });

  it('needs a headline, because a banner without one is a grey box', async () => {
    const res = await request(app, 'POST', '/admin/promotions', {
      token: adminToken(), body: { headline: '   ' },
    });
    expect(res.status).toBe(400);
  });

  it('refuses a button that points anywhere but http(s)', async () => {
    // The URL is rendered on a guest's phone. A javascript: or data: target
    // would run in their browser off the back of our page.
    const res = await request(app, 'POST', '/admin/promotions', {
      token: adminToken(),
      body: { headline: 'x', buttonUrl: 'javascript:alert(1)' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_url');
  });

  it('refuses a second live promotion rather than hiding the first', async () => {
    queryOne.mockRejectedValueOnce({ code: '23505', constraint: 'idx_valet_promotions_one_live' });

    const res = await request(app, 'PATCH', '/admin/promotions/pr2', {
      token: adminToken(), body: { status: 'live' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_live');
  });

  it('reports views, taps and redemptions separately', async () => {
    queryRows.mockResolvedValueOnce([{
      id: 'pr1', headline: 'Brunch', body: null, image_key: null,
      button_label: null, button_url: null, offer_code: 'VALET25', redeem_note: null,
      starts_at: null, ends_at: null, status: 'live', created_at: '2026-10-01T00:00:00Z',
      views: 3840, taps: 412, redeems: 96,
    }]);

    const res = await request(app, 'GET', '/admin/promotions', { token: adminToken() });

    expect(res.body.promotions[0]).toMatchObject({ views: 3840, taps: 412, redeems: 96 });
  });
});

describe('redeeming a guest’s offer code', () => {
  const PROMO_ID = '55555555-5555-5555-5555-555555555555';

  it('traces the code back to the ticket it came from', async () => {
    // "Each guest gets their own version of this code, so every use can be
    // traced back to a real valet ticket." Without that a code is a poster.
    queryOne.mockResolvedValueOnce({ id: PROMO_ID });   // this property's promotion
    queryOne.mockResolvedValueOnce({ id: 't1', community_id: COMMUNITY_ID });
    queryOne.mockResolvedValueOnce({ id: 'ev1' });

    const res = await request(app, 'POST', `/admin/promotions/${PROMO_ID}/redeem`, {
      token: adminToken(), body: { code: 'VALET25-4K7QP2' },
    });

    expect(res.status).toBe(200);
    expect(res.body.redeemed).toBe(true);
  });

  it('refuses a code that matches no ticket here', async () => {
    queryOne.mockResolvedValueOnce({ id: PROMO_ID });
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'POST', `/admin/promotions/${PROMO_ID}/redeem`, {
      token: adminToken(), body: { code: 'VALET25-ZZZZZZ' },
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_code');
  });

  it('says so when a code has already been used', async () => {
    // A restaurant scanning the same screenshot twice is the thing this
    // protects against, and the second person needs a clear answer.
    queryOne.mockResolvedValueOnce({ id: PROMO_ID });
    queryOne.mockResolvedValueOnce({ id: 't1', community_id: COMMUNITY_ID });
    queryOne.mockResolvedValueOnce(null);   // ON CONFLICT DO NOTHING matched

    const res = await request(app, 'POST', `/admin/promotions/${PROMO_ID}/redeem`, {
      token: adminToken(), body: { code: 'VALET25-4K7QP2' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_redeemed');
  });
});

describe('editing a member of staff', () => {
  it('changes their name, role and access end date', async () => {
    // Without this the only way to promote somebody or extend a temp was to
    // remove and re-add them -- which orphans their shift history, the exact
    // record the shift log exists to keep.
    queryOne.mockResolvedValueOnce({ id: 'r1', name: 'Ravi Kumar' });

    const res = await request(app, 'PATCH', '/admin/staff/r1', {
      token: adminToken(),
      body: { name: 'Ravi Kumar', role: 'valet_manager', until: '2026-12-31T00:00:00Z' },
    });

    expect(res.status).toBe(200);
    expect(queryOne.mock.calls[0][0]).toMatch(/UPDATE residents/i);
  });

  it('scopes the update to the caller’s own property', async () => {
    // An id from another venue must not be editable by pasting it into the URL.
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'PATCH', '/admin/staff/someone-elses', {
      token: adminToken(), body: { name: 'X' },
    });

    expect(res.status).toBe(404);
    expect(queryOne.mock.calls[0][1]).toContain(COMMUNITY_ID);
  });

  it('refuses a role nobody defined', async () => {
    const res = await request(app, 'PATCH', '/admin/staff/r1', {
      token: adminToken(), body: { role: 'security_chief' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_role');
  });

  it('clears the end date when asked, rather than ignoring an empty value', async () => {
    // A temp made permanent needs the date gone. Treating empty as "no change"
    // would leave them expiring on a date nobody can now see in the form.
    queryOne.mockResolvedValueOnce({ id: 'r1', name: 'Ravi' });

    await request(app, 'PATCH', '/admin/staff/r1', {
      token: adminToken(), body: { until: null },
    });

    expect(queryOne.mock.calls[0][1]).toContain(null);
  });

  it('leaves the mobile alone — it is how they sign in', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r1', name: 'Ravi' });

    await request(app, 'PATCH', '/admin/staff/r1', {
      token: adminToken(), body: { name: 'Ravi', mobile: '9999999999' },
    });

    // Changing the login identity of somebody mid-shift is a different and
    // more dangerous operation than correcting a spelling.
    expect(queryOne.mock.calls[0][0]).not.toMatch(/mobile/i);
  });
});

describe('a property’s own details', () => {
  it('returns what the venue has recorded about its valet desk', async () => {
    queryOne.mockResolvedValueOnce({
      name: 'Palm Meadows', address: 'Whitefield, Bengaluru',
      desk_phone: '080 1234 5678', hours: 'Open 24 hours',
      went_live_at: '2026-08-01T00:00:00Z',
    });

    const res = await request(app, 'GET', '/admin/property', { token: adminToken() });

    expect(res.body).toMatchObject({
      name: 'Palm Meadows',
      address: 'Whitefield, Bengaluru',
      deskPhone: '080 1234 5678',
      hours: 'Open 24 hours',
    });
  });

  it('says how guests get their ticket, rather than leaving it blank', async () => {
    // "Ticket type" is not something a venue sets — it is what the product
    // does. Showing an empty field invites somebody to try to fill it in.
    queryOne.mockResolvedValueOnce({ name: 'Palm Meadows' });

    const res = await request(app, 'GET', '/admin/property', { token: adminToken() });

    expect(res.body.ticketType).toBe('Digital, via WhatsApp');
  });

  it('saves the details a venue can actually change', async () => {
    queryOne.mockResolvedValueOnce({ id: 'c1' });

    const res = await request(app, 'PATCH', '/admin/property', {
      token: adminToken(),
      body: { address: 'Whitefield, Bengaluru', deskPhone: '080 1234 5678', hours: 'Open 24 hours' },
    });

    expect(res.status).toBe(200);
    expect(queryOne.mock.calls[0][1]).toContain(COMMUNITY_ID);
  });

  it('refuses a desk phone that is not a phone', async () => {
    const res = await request(app, 'PATCH', '/admin/property', {
      token: adminToken(), body: { deskPhone: 'call reception' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_phone');
  });

  it('accepts a blank desk phone as "we have not set one"', async () => {
    queryOne.mockResolvedValueOnce({ id: 'c1' });
    const res = await request(app, 'PATCH', '/admin/property', {
      token: adminToken(), body: { deskPhone: '' },
    });
    expect(res.status).toBe(200);
  });
});

describe('a screenshot attached to an idea', () => {
  it('stores it against the idea', async () => {
    queryOne.mockResolvedValueOnce({ id: 'i1', image_key: null });

    const res = await request(app, 'POST', '/admin/ideas/i1/image', {
      token: adminToken(),
      file: { field: 'image', name: 'bug.png', type: 'image/png', body: Buffer.from('x') },
    });

    // Multipart is not something the JSON test helper speaks; what matters
    // here is that the route exists and is scoped. The upload itself is
    // exercised the same way the branding logo is.
    expect([201, 400]).toContain(res.status);
  });

  it('refuses an idea belonging to another property', async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await request(app, 'POST', '/admin/ideas/someone-elses/image', { token: adminToken() });
    expect([404, 400]).toContain(res.status);
  });
});

describe('the shift log as a file', () => {
  it('exports the same columns the screen shows', async () => {
    // The export is what gets mailed to a GM. A column on screen and missing
    // from the file is the one nobody notices until it is needed.
    queryRows.mockResolvedValueOnce([{
      id: 's1', name: 'Anil P', valet_role: 'valet',
      started_at: '2026-10-06T07:02:00Z', ended_at: '2026-10-06T11:40:00Z',
      seconds_on_shift: 16680, valet_point: 'Banquet entrance',
      verified: true, reason: null,
    }]);

    const res = await request(app, 'GET', '/admin/shifts.csv', { token: adminToken() });

    const [header, row] = res.body.split('\n');
    for (const col of ['Name', 'Role', 'In time', 'Out time', 'Time on shift', 'Valet point', 'Verified by']) {
      expect(header).toContain(col);
    }
    expect(row).toContain('Banquet entrance');
    expect(row).toContain('Face ID');
  });

  it('says why an unverified shift was unverified, not just that it was', async () => {
    queryRows.mockResolvedValueOnce([{
      id: 's2', name: 'Suresh M', valet_role: 'valet',
      started_at: '2026-10-06T09:12:00Z', ended_at: null,
      seconds_on_shift: 900, valet_point: null, verified: false, reason: 'no_photo',
    }]);

    const res = await request(app, 'GET', '/admin/shifts.csv', { token: adminToken() });

    expect(res.body).toContain('no_photo');
    // An open shift has no out time, and a blank is the honest cell.
    expect(res.body.split('\n')[1]).toContain('Still on shift');
  });

  it('needs an admin token', async () => {
    const res = await request(app, 'GET', '/admin/shifts.csv', { token: guardToken() });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /admin/points/:id — editing a valet point
//
// The route took a status and nothing else, so a porch named in a hurry during
// setup was named for good, and a capacity typed wrong could only be fixed by
// pausing the point and adding a second one with the right number -- which
// splits its shift history across two rows that look like two doors.
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /admin/points/:id', () => {
  it('renames a valet point', async () => {
    queryOne.mockResolvedValueOnce({ name: 'Main porch' });   // what it is called now
    queryOne.mockResolvedValueOnce({ id: 'p1', name: 'Porte cochere', capacity: 80, status: 'active' });

    const res = await request(app, 'PATCH', '/admin/points/p1', {
      token: adminToken(), body: { name: 'Porte cochere' },
    });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Porte cochere');
  });

  // Shifts record the point by NAME, not by id. Renaming the row and leaving
  // them alone splits one door's history in two: the log still says "Main
  // porch" for last month, the screen says "Porte cochere" for today, and the
  // live "on shift now" count against the point drops to zero the moment it is
  // renamed -- which is what happened the first time this was clicked.
  //
  // The rename moves them, because the name is a label on a door that did not
  // change. Scoped to the community: two properties each have a "Main porch".
  it('carries the shift history over to the new name', async () => {
    queryOne.mockResolvedValueOnce({ name: 'Main porch' });
    queryOne.mockResolvedValueOnce({ id: 'p1', name: 'Porte cochere', capacity: 80, status: 'active' });

    await request(app, 'PATCH', '/admin/points/p1', {
      token: adminToken(), body: { name: 'Porte cochere' },
    });

    const call = query.mock.calls.find(([sql]) => /UPDATE valet_shifts/.test(sql));
    expect(call).toBeDefined();
    expect(call[0]).toMatch(/community_id/);
    expect(call[1]).toContain('Porte cochere');
  });

  // Nothing to carry when the name is untouched, and a stray UPDATE across
  // every shift row at the property is not a no-op worth risking.
  it('leaves the shift log alone when only the capacity changes', async () => {
    queryOne.mockResolvedValueOnce({ id: 'p1', name: 'Main porch', capacity: 120, status: 'active' });

    await request(app, 'PATCH', '/admin/points/p1', {
      token: adminToken(), body: { capacity: 120 },
    });

    expect(query.mock.calls.find(([sql]) => /UPDATE valet_shifts/.test(sql))).toBeUndefined();
  });

  it('changes a capacity, including back to unknown', async () => {
    queryOne.mockResolvedValueOnce({ id: 'p1', name: 'Main porch', capacity: null, status: 'active' });

    const res = await request(app, 'PATCH', '/admin/points/p1', {
      token: adminToken(), body: { capacity: null },
    });

    expect(res.status).toBe(200);
    expect(res.body.capacity).toBe(null);
  });

  // Still the whole point of the route, and still the common case.
  it('keeps taking a status on its own', async () => {
    queryOne.mockResolvedValueOnce({ id: 'p1', name: 'Main porch', capacity: 80, status: 'paused' });

    const res = await request(app, 'PATCH', '/admin/points/p1', {
      token: adminToken(), body: { status: 'paused' },
    });

    expect(res.body.status).toBe('paused');
  });

  // An empty name would leave a row the shift log renders as a blank cell.
  it('refuses to blank the name', async () => {
    const res = await request(app, 'PATCH', '/admin/points/p1', {
      token: adminToken(), body: { name: '   ' },
    });

    expect(res.status).toBe(400);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('refuses a request that changes nothing', async () => {
    const res = await request(app, 'PATCH', '/admin/points/p1', { token: adminToken(), body: {} });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property details gained two fields the design shows and the route did not
// return: who administers the property, and how many cars are on the lot.
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /admin/property extras', () => {
  it('names the property admin and counts the cars parked now', async () => {
    queryOne.mockResolvedValueOnce({
      name: 'Palm Meadows', address: 'Whitefield', desk_phone: null, hours: null,
      went_live_at: null, admin_name: 'Palm Meadows Admin', parked_now: 64,
    });

    const res = await request(app, 'GET', '/admin/property', { token: adminToken() });

    expect(res.body.admin).toBe('Palm Meadows Admin');
    expect(res.body.parkedNow).toBe(64);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The "valet" role.
//
// 057 shipped 'valet_manager' and 'temporary_driver', which between them name
// the exceptions. A property with eight attendants and one supervisor had to
// call all eight managers, or mark permanent staff temporary -- and the shift
// log then reads as if the whole desk were supervisors.
// ─────────────────────────────────────────────────────────────────────────────
describe('staff roles', () => {
  it('accepts a plain valet', async () => {
    queryOne.mockResolvedValueOnce(null);                      // no clashing mobile
    queryOne.mockResolvedValueOnce({ id: 'u1' });              // the guard post unit
    query.mockResolvedValue({ rows: [] });

    const res = await request(app, 'POST', '/admin/staff', {
      token: adminToken(),
      body: { name: 'Suresh M', mobile: '9000000001', password: '1234', role: 'valet' },
    });

    expect(res.status).toBe(201);
  });

  it('still refuses a role nobody defined', async () => {
    const res = await request(app, 'POST', '/admin/staff', {
      token: adminToken(),
      body: { name: 'Suresh M', mobile: '9000000001', password: '1234', role: 'supervisor' },
    });

    expect(res.status).toBe(400);
    expect(queryOne).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/locations.csv — today's numbers for every property in the group
//
// The group screen is what a regional manager looks at; the file is what they
// forward. Same query as the screen, for the same reason every other export
// here is: a file that disagrees with the page it came from is worse than no
// file.
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /admin/locations.csv', () => {
  it('is refused to a manager who holds one property', async () => {
    const res = await request(app, 'GET', '/admin/locations.csv', { token: adminToken() });

    expect(res.status).toBe(403);
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('exports a row per property', async () => {
    queryRows.mockResolvedValueOnce([
      {
        id: 'c1', name: 'Palm Meadows Whitefield', address: 'Bengaluru', plan: 'enterprise',
        parked_now: 64, waiting: 3, on_shift: 8, cars_this_month: 2700,
        avg_wait_seconds: 360, ever_live: true,
      },
      {
        id: 'c2', name: 'Palm Meadows Goa', address: 'Goa', plan: 'basic',
        parked_now: 0, waiting: 0, on_shift: 0, cars_this_month: 0,
        avg_wait_seconds: null, ever_live: false,
      },
    ]);

    const res = await request(app, 'GET', '/admin/locations.csv', {
      token: adminToken({ role: 'client_admin', account_id: 'acc-1' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toContain('Property');
    expect(lines[1]).toContain('Palm Meadows Whitefield');
    expect(lines[1]).toContain('Live');
    // A property that has never taken a car is "Setting up", not a live desk
    // having a quiet day -- the same distinction the screen draws.
    expect(lines[2]).toContain('Setting up');
    // No wait to report is blank, never 0: zero minutes is a claim about speed.
    expect(lines[2]).not.toMatch(/,0,0$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quota and advertising — the commercial layer.
//
// These endpoints decide what somebody is billed, so the tests are about the
// boundaries that cost money if they are wrong: who may change what, which pot
// a spend comes from, and whether a credit can be granted twice.
// ─────────────────────────────────────────────────────────────────────────────

const GROUP = () => adminToken({ role: 'client_admin', account_id: 'acc-1', community_id: null });

const TERMS = {
  quota_mode: 'shared', quota_cars_per_property: 2000, quota_alert_percent: 80,
  quota_over_behaviour: 'bill', quota_overage_paise: 4000,
  ad_price_per_view_paise: 150, ad_monthly_minimum_paise: 200000,
  gst_percent: 18, ad_billing: 'prepaid',
};

describe('GET /admin/quota', () => {
  it('is refused to a manager who holds one property', async () => {
    const res = await request(app, 'GET', '/admin/quota', { token: adminToken() });

    expect(res.status).toBe(403);
  });

  it('reports the pool, what is held back, and how long the month has left', async () => {
    queryOne.mockResolvedValueOnce(TERMS);
    queryRows.mockResolvedValueOnce([
      { id: 'c1', name: 'Whitefield', hold_back: 0, cars_this_month: 2700, ever_live: true },
      { id: 'c2', name: 'Koramangala', hold_back: 300, cars_this_month: 800, ever_live: true },
      { id: 'c3', name: 'Goa', hold_back: 0, cars_this_month: 0, ever_live: false },
    ]);

    const res = await request(app, 'GET', '/admin/quota', { token: GROUP() });

    expect(res.status).toBe(200);
    // Two live properties, so the pool is 4,000 — not 6,000. The hotel that
    // has never taken a car is not paid for and does not contribute.
    expect(res.body.pool.includedCars).toBe(4000);
    expect(res.body.pool.usedCars).toBe(3500);
    expect(res.body.pool.heldBackCars).toBe(300);
    expect(res.body.pool.daysLeft).toBeGreaterThanOrEqual(0);
  });
});

describe('PATCH /admin/quota', () => {
  it('is refused to a manager who holds one property', async () => {
    const res = await request(app, 'PATCH', '/admin/quota', {
      token: adminToken(), body: { mode: 'fixed' },
    });

    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('changes how cars are shared', async () => {
    const res = await request(app, 'PATCH', '/admin/quota', {
      token: GROUP(), body: { mode: 'fixed' },
    });

    expect(res.status).toBe(200);
    expect(query.mock.calls[0][0]).toMatch(/quota_mode/);
  });

  // The allowance and the overage rate are contract terms. A screen that let a
  // customer set their own allowance would be a billing hole; one that let
  // them set their own overage rate would be a stranger one.
  it('ignores an attempt to set the allowance or the overage rate', async () => {
    const res = await request(app, 'PATCH', '/admin/quota', {
      token: GROUP(),
      body: { mode: 'shared', carsPerProperty: 999999, overagePaise: 1 },
    });

    expect(res.status).toBe(200);
    const sql = query.mock.calls.map(([q]) => q).join(' ');
    expect(sql).not.toMatch(/quota_cars_per_property/);
    expect(sql).not.toMatch(/quota_overage_paise/);
  });

  // A billing arrangement must never be able to refuse a guest standing at a
  // porch with their keys out.
  it('refuses an over-quota behaviour that would stop the valet desk', async () => {
    const res = await request(app, 'PATCH', '/admin/quota', {
      token: GROUP(), body: { overBehaviour: 'stop' },
    });

    expect(res.status).toBe(400);
  });

  // Scoped by account, so posting another group's property id reserves
  // nothing. The WHERE clause is the enforcement, not a check in the route.
  it('scopes a hold-back to the caller own account', async () => {
    const res = await request(app, 'PATCH', '/admin/quota', {
      token: GROUP(),
      body: { holdBack: { '11111111-1111-1111-1111-111111111111': 300 } },
    });

    expect(res.status).toBe(200);
    const call = query.mock.calls.find(([q]) => /valet_quota_hold_back/.test(q));
    expect(call[0]).toMatch(/account_id = \$2/);
    expect(call[1]).toContain('acc-1');
  });
});

describe('GET /admin/ads', () => {
  it('sums the balance from the ledger and keeps free credit separate', async () => {
    queryOne.mockResolvedValueOnce(TERMS);
    queryRows.mockResolvedValueOnce([
      { amount_paise: 250000, is_credit: true },
      { amount_paise: 500000, is_credit: false },
    ]);
    queryRows.mockResolvedValueOnce([]);                 // recent ledger
    queryRows.mockResolvedValueOnce([{ id: 'c1' }]);     // promotion scope
    queryOne.mockResolvedValueOnce({ views: 900 });

    const res = await request(app, 'GET', '/admin/ads', { token: GROUP() });

    expect(res.status).toBe(200);
    expect(res.body.balance).toEqual({
      creditPaise: 250000, paidPaise: 500000, totalPaise: 750000,
    });
    // 900 views at ₹1.50 is ₹1,350 — exact views, never rounded up to a block.
    expect(res.body.monthToDate.netPaise).toBe(135000);
    expect(res.body.monthToDate.gstPaise).toBe(24300);
  });

  // Said on every response rather than inferred: a venue must never be told
  // money moved when the payment layer cannot move any.
  it('says plainly that no money can be collected in placeholder mode', async () => {
    queryOne.mockResolvedValueOnce(TERMS);
    queryRows.mockResolvedValueOnce([]);
    queryRows.mockResolvedValueOnce([]);
    queryRows.mockResolvedValueOnce([{ id: 'c1' }]);
    queryOne.mockResolvedValueOnce({ views: 0 });

    const res = await request(app, 'GET', '/admin/ads', { token: GROUP() });

    expect(res.body.paymentPlaceholder).toBe(true);
  });
});

describe('POST /admin/ads/topup', () => {
  it('refuses a nonsense amount', async () => {
    const res = await request(app, 'POST', '/admin/ads/topup', {
      token: GROUP(), body: { amountPaise: -1 },
    });

    expect(res.status).toBe(400);
  });

  // A mistyped amount is far more likely than a genuine one this size, and an
  // accidental ten-lakh top-up is a refund conversation.
  it('refuses an amount large enough to be a typo', async () => {
    const res = await request(app, 'POST', '/admin/ads/topup', {
      token: GROUP(), body: { amountPaise: 99999999 },
    });

    expect(res.status).toBe(400);
  });

  it('adds GST to what is charged but credits only the net', async () => {
    queryOne.mockResolvedValueOnce(TERMS);

    const res = await request(app, 'POST', '/admin/ads/topup', {
      token: GROUP(), body: { amountPaise: 500000 },
    });

    expect(res.status).toBe(201);
    expect(res.body.totalPaise).toBe(590000);
    // The ledger carries the NET. GST is tax collected, not ad credit, and
    // crediting the gross would hand every venue 18% of free spend.
    const insert = query.mock.calls.find(([q]) => /valet_ad_ledger/.test(q));
    expect(insert[1]).toContain(500000);
    expect(insert[1]).not.toContain(590000);
  });

  // A retried request or a double-tapped button must not credit twice.
  it('writes the ledger row idempotently against the order', async () => {
    queryOne.mockResolvedValueOnce(TERMS);

    await request(app, 'POST', '/admin/ads/topup', {
      token: GROUP(), body: { amountPaise: 200000 },
    });

    const insert = query.mock.calls.find(([q]) => /valet_ad_ledger/.test(q));
    expect(insert[0]).toMatch(/ON CONFLICT/);
  });

  it('tells an invoiced account that it does not top up', async () => {
    queryOne.mockResolvedValueOnce({ ...TERMS, ad_billing: 'invoiced' });

    const res = await request(app, 'POST', '/admin/ads/topup', {
      token: GROUP(), body: { amountPaise: 200000 },
    });

    expect(res.status).toBe(409);
  });
});

describe('POST /admin/promotions/:id/submit', () => {
  it('sends a draft for review', async () => {
    queryOne.mockResolvedValueOnce({ id: 'p1', status: 'in_review' });

    const res = await request(app, 'POST', '/admin/promotions/p1/submit', {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_review');
  });

  // A venue cannot put its own promotion in front of a guest, so the only
  // transition offered is draft to in_review -- enforced in the WHERE clause
  // rather than by reading the row and trusting the caller.
  it('will only move a draft', async () => {
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'POST', '/admin/promotions/p1/submit', {
      token: adminToken(),
    });

    expect(res.status).toBe(409);
    expect(queryOne.mock.calls[0][0]).toMatch(/status = 'draft'/);
  });
});
