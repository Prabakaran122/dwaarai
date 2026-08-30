import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {},
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));

import { queryRows } from '../db.js';
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
