import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {},
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));

import { queryOne, queryRows } from '../db.js';
import adminRoutes from '../routes/admin.js';
import { createApp, request, guardToken, adminToken, COMMUNITY_ID } from './helpers.js';

const app = createApp(adminRoutes, '/admin');

beforeEach(() => {
  vi.clearAllMocks();
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
        display_id: 'SRT-0007', plate: 'KA 03 NJ 0435', created_at: '2026-08-20T10:00:00Z',
        closed_at: '2026-08-20T18:00:00Z', status: 'final_closed', disputed: false, created_guard_name: 'Ramesh',
      },
      {
        display_id: 'SRT-0003', plate: 'KA03NJ0435', created_at: '2026-04-12T10:00:00Z',
        closed_at: '2026-04-12T20:00:00Z', status: 'final_closed', disputed: true, created_guard_name: 'Suresh',
      },
    ]);

    const res = await request(app, 'GET', '/admin/plate-history?plate=ka%2003%20nj%200435', {
      token: adminToken(),
    });

    expect(res.status).toBe(200);
    expect(res.body.visitCount).toBe(2);
    expect(res.body.disputedCount).toBe(1);
    expect(res.body.visits[0].displayId).toBe('SRT-0007');
  });

  it('matches a plate regardless of how it was spaced when entered', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/admin/plate-history?plate=ka%2003%20nj%200435', { token: adminToken() });

    expect(queryRows.mock.calls[0][1]).toEqual([COMMUNITY_ID, 'KA03NJ0435']);
  });

  it('keeps the as-entered plate on each visit alongside the normalized one', async () => {
    queryRows.mockResolvedValueOnce([{
      display_id: 'SRT-0007', plate: 'KA 03 NJ 0435', created_at: 'x', closed_at: null,
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
      { status: 'requested', count: 2 },
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
    id: 't1', display_id: 'SRT-0001', plate: 'KA 03 NJ 0435',
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

  it('returns each visit with plate, times and who took it in', async () => {
    queryRows.mockResolvedValueOnce([visitRow()]);
    queryOne.mockResolvedValueOnce(totalsRow());

    const res = await request(app, 'GET', '/admin/visits', { token: adminToken() });

    expect(res.body.visits[0]).toMatchObject({
      displayId: 'SRT-0001',
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
        display_id: 'SRT-0009', plate: 'KA 03 NJ 0435', status: 'parked' },
    ]);

    const res = await request(app, 'GET', '/admin/cards', { token: adminToken() });

    expect(res.body.cards[0].inUseBy).toEqual({
      displayId: 'SRT-0009', plate: 'KA 03 NJ 0435', status: 'parked',
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
      .mockResolvedValueOnce({ display_id: 'SRT-0009' });

    const res = await request(app, 'POST', '/admin/cards/c1/deactivate', { token: adminToken() });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('SRT-0009');
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
      display_id: 'SRT-0001', session_token: 'tok', plate: 'KA 03 NJ 0435',
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
