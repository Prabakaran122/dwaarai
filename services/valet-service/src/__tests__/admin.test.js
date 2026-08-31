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
