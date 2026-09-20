import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

vi.mock('../db.js', () => ({
  default: {},
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/storage.js', () => ({
  storage: { put: vi.fn(async () => {}), getStream: vi.fn(), delete: vi.fn(async () => {}) },
  buildKey: vi.fn(() => 'valet/branding/community/logo.png'),
  extensionFor: vi.fn(() => 'png'),
}));

import { query, queryOne, queryRows } from '../db.js';
import { storage } from '../lib/storage.js';
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

    const res = await request(app, 'GET', '/admin/feedback', { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.satisfied).toBe(42);
    expect(res.body.notSatisfied).toBe(5);
    expect(res.body.reasons).toEqual([
      { reason: 'long_wait', count: 4 },
      { reason: 'damage', count: 1 },
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

describe('GET /admin/visits.csv', () => {
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
