import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(async () => mockClient) },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/qr.js', () => ({ toDataUrl: vi.fn(async () => 'data:image/png;base64,QR') }));
vi.mock('../lib/storage.js', () => ({
  storage: { put: vi.fn(), getStream: vi.fn(), delete: vi.fn() },
  buildKey: vi.fn(() => 'valet/photo/t/key.jpg'),
  extensionFor: vi.fn(() => 'jpg'),
}));
vi.mock('../lib/realtime.js', () => ({ emitTicketUpdate: vi.fn(), getIO: vi.fn(), initRealtime: vi.fn() }));
vi.mock('../lib/expiry.js', () => ({
  schedulePhotoDeletion: vi.fn(),
  scheduleConditionMediaDeletion: vi.fn(),
}));

import pool, { query, queryOne, queryRows } from '../db.js';
import { schedulePhotoDeletion, scheduleConditionMediaDeletion } from '../lib/expiry.js';
import guardRoutes from '../routes/guard.js';
import {
  createApp, request, ticketRow, guardToken, adminToken,
  SESSION_TOKEN, TICKET_ID, COMMUNITY_ID, GUARD_ID,
} from './helpers.js';

const app = createApp(guardRoutes, '/guard');
const token = guardToken();

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValue({ rows: [] });
  mockClient.release.mockReset();
});

// --- auth -------------------------------------------------------------------

describe('authentication', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app, 'GET', '/guard/tickets');
    expect(res.status).toBe(401);
  });

  it('rejects a garbage token', async () => {
    const res = await request(app, 'GET', '/guard/tickets', { token: 'not-a-jwt' });
    expect(res.status).toBe(401);
  });

  it('rejects a resident token: valet is guard and admin work only', async () => {
    const res = await request(app, 'GET', '/guard/tickets', {
      token: guardToken({ role: 'resident' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a token that carries no community', async () => {
    const res = await request(app, 'GET', '/guard/tickets', {
      token: guardToken({ community_id: undefined }),
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_community');
  });

  it('accepts a community admin as well as a guard', async () => {
    queryRows.mockResolvedValueOnce([]);
    const res = await request(app, 'GET', '/guard/tickets', { token: adminToken() });
    expect(res.status).toBe(200);
  });
});

// --- tenancy ---------------------------------------------------------------

describe('community scoping', () => {
  it('scopes every ticket lookup to the caller\'s community, not just the token', async () => {
    // A session token leaked from another community must not resolve here.
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'GET', `/guard/tickets/${SESSION_TOKEN}`, { token });

    expect(res.status).toBe(404);
    const [, params] = queryOne.mock.calls[0];
    expect(params).toEqual([SESSION_TOKEN, COMMUNITY_ID]);
  });

  it('scopes the ticket list to the caller\'s community', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/guard/tickets', { token });

    expect(queryRows.mock.calls[0][1]).toEqual([COMMUNITY_ID]);
  });
});

// --- ticket creation -------------------------------------------------------

describe('POST /guard/tickets', () => {
  function mockCreateFlow(lastDisplayId) {
    mockClient.query
      .mockResolvedValueOnce({})                                        // BEGIN
      .mockResolvedValueOnce({ rows: lastDisplayId ? [{ display_id: lastDisplayId }] : [] })
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })             // INSERT ticket
      .mockResolvedValueOnce({})                                        // logEvent
      .mockResolvedValueOnce({});                                       // COMMIT
  }

  it('creates a ticket and returns the guest URL and QR', async () => {
    mockCreateFlow('SRT-0004');

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'ka 03 nj 0435',
        vehicleMake: 'Maruti Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.displayId).toBe('SRT-0005');
    expect(res.body.sessionToken).toHaveLength(32);
    expect(res.body.guestUrl).toContain(res.body.sessionToken);
    expect(res.body.qrDataUrl).toBe('data:image/png;base64,QR');
  });

  it('stores the plate as typed but normalizes the match key', async () => {
    mockCreateFlow(null);

    await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'ka 03 nj 0435',
        vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    const insertParams = mockClient.query.mock.calls[2][1];
    expect(insertParams[3]).toBe('KA 03 NJ 0435'); // plate, uppercased but spaced as typed
    expect(insertParams[4]).toBe('KA03NJ0435');    // plate_normalized, for matching
  });

  it('takes the community from the token, never from the request body', async () => {
    mockCreateFlow(null);

    await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA01AA1111',
        vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(),
        communityId: 'attacker-supplied-community',
      },
    });

    expect(mockClient.query.mock.calls[2][1][0]).toBe(COMMUNITY_ID);
  });

  it('rejects a stay-end in the past', async () => {
    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA01AA1111',
        vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() - 3600_000).toISOString(),
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_stay_end');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['no plate', { vehicleMake: 'Swift' }],
    ['no make', { plate: 'KA01AA1111' }],
    ['blank plate', { plate: '   ', vehicleMake: 'Swift' }],
  ])('rejects incomplete input (%s)', async (_label, body) => {
    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { stayEndAt: new Date(Date.now() + 86400000).toISOString(), ...body },
    });

    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rolls back and releases the connection when the insert fails', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('duplicate key'));

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA01AA1111',
        vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    expect(res.status).toBe(500);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// --- returning vehicle ------------------------------------------------------

describe('GET /guard/plate-lookup', () => {
  it('reports a returning vehicle with its visit count', async () => {
    queryOne.mockResolvedValueOnce({ visit_count: 3, last_visit_at: '2026-04-12T10:00:00Z' });

    const res = await request(app, 'GET', '/guard/plate-lookup?plate=KA%2003%20NJ%200435', { token });

    expect(res.body).toEqual({
      isReturning: true,
      visitCount: 3,
      lastVisitAt: '2026-04-12T10:00:00Z',
    });
    expect(queryOne.mock.calls[0][1]).toEqual([COMMUNITY_ID, 'KA03NJ0435']);
  });

  it('reports a first-time vehicle', async () => {
    queryOne.mockResolvedValueOnce({ visit_count: 0, last_visit_at: null });

    const res = await request(app, 'GET', '/guard/plate-lookup?plate=KA01AA1111', { token });

    expect(res.body).toEqual({ isReturning: false });
  });

  it('short-circuits an empty plate without querying', async () => {
    const res = await request(app, 'GET', '/guard/plate-lookup?plate=', { token });

    expect(res.body).toEqual({ isReturning: false });
    expect(queryOne).not.toHaveBeenCalled();
  });
});

// --- state transitions ------------------------------------------------------

describe('POST /guard/tickets/:token/accept', () => {
  it('accepts a requested ticket and records the ETA', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'requested' }))
      .mockResolvedValueOnce(ticketRow({ status: 'en_route', eta_minutes: 5 }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept`, {
      token, body: { etaMinutes: 5 },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('en_route');
    expect(query.mock.calls[0][1]).toEqual([GUARD_ID, 5, TICKET_ID]);
  });

  it('allows a guard to skip the ETA, leaving the guest without a countdown', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'requested' }))
      .mockResolvedValueOnce(ticketRow({ status: 'en_route' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept`, {
      token, body: {},
    });

    expect(res.status).toBe(200);
    expect(query.mock.calls[0][1][1]).toBeNull();
  });

  it.each([[0], [61], [2.5], ['soon']])('rejects an out-of-range ETA (%s)', async (etaMinutes) => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'requested' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept`, {
      token, body: { etaMinutes },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_eta');
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses to accept a ticket nobody has requested', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept`, {
      token, body: { etaMinutes: 5 },
    });

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('parked');
  });
});

describe('POST /guard/tickets/:token/arrived', () => {
  it('marks an en-route ticket arrived', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'en_route' }))
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/arrived`, { token, body: {} });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('arrived');
  });

  it('refuses to skip straight from parked to arrived', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/arrived`, { token, body: {} });

    expect(res.status).toBe(409);
  });
});

// --- rotating QR scan -------------------------------------------------------

describe('POST /guard/tickets/:token/scan', () => {
  it('accepts the current token and consumes it', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ id: 'rt-1' });

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/scan`, {
      token, body: { rotatingToken: 'r'.repeat(24) },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('consumes the token in a single conditional UPDATE, so a concurrent scan cannot also win', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ id: 'rt-1' });

    await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/scan`, {
      token, body: { rotatingToken: 'r'.repeat(24) },
    });

    const sql = queryOne.mock.calls[1][0];
    expect(sql).toContain('UPDATE valet_rotating_tokens');
    expect(sql).toContain('used_at IS NULL');
    expect(sql).toContain('expires_at > NOW()');
  });

  it('rejects a stale, reused or wrong token and logs the failure', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce(null); // no row matched: expired, used, or superseded

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/scan`, {
      token, body: { rotatingToken: 'stale' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_or_expired');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO valet_ticket_events'),
      expect.arrayContaining(['scan_failed'])
    );
  });

  it('refuses to scan before the car has arrived', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'en_route' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/scan`, {
      token, body: { rotatingToken: 'x' },
    });

    expect(res.status).toBe(409);
  });
});

// --- pickup confirmation ----------------------------------------------------

describe('POST /guard/tickets/:token/confirm-pickup', () => {
  const arrival = { created_at: '2026-08-30T10:00:00Z' };

  it('requires a successful scan first', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce(arrival)
      .mockResolvedValueOnce(null); // no verified scan

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, {
      token, body: {},
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('scan_required');
  });

  it('requires return condition media even when the scan succeeded', async () => {
    // Enforced server-side, not just in the UI: an empty return record defeats
    // the point of capturing condition media at all.
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce(arrival)
      .mockResolvedValueOnce({ id: 'rt-1' })
      .mockResolvedValueOnce(null); // no return capture

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, {
      token, body: {},
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('return_condition_required');
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('final_closed'), expect.anything());
  });

  it('scopes the required return capture to this arrival, not an earlier pickup', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce(arrival)
      .mockResolvedValueOnce({ id: 'rt-1' })
      .mockResolvedValueOnce({ id: 'cond-1' })
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }));

    await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, { token, body: {} });

    const [sql, params] = queryOne.mock.calls[3];
    expect(sql).toContain("stage = 'return'");
    expect(sql).toContain('captured_at >= $2');
    expect(params[1]).toBe(arrival.created_at);
  });

  it('parks the car again by default, keeping the same URL alive for a multi-day stay', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce(arrival)
      .mockResolvedValueOnce({ id: 'rt-1' })
      .mockResolvedValueOnce({ id: 'cond-1' })
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, {
      token, body: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('parked_again');
    // Media retention is not scheduled while the ticket can still be used.
    expect(schedulePhotoDeletion).not.toHaveBeenCalled();
  });

  it('closes the ticket and schedules media retention on a final checkout', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce(arrival)
      .mockResolvedValueOnce({ id: 'rt-1' })
      .mockResolvedValueOnce({ id: 'cond-1' })
      .mockResolvedValueOnce(ticketRow({ status: 'final_closed' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, {
      token, body: { final: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('final_closed');
    expect(schedulePhotoDeletion).toHaveBeenCalledWith(TICKET_ID);
    expect(scheduleConditionMediaDeletion).toHaveBeenCalledWith(TICKET_ID);
  });

  it('does not accept a truthy-but-not-true value as a final checkout', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce(arrival)
      .mockResolvedValueOnce({ id: 'rt-1' })
      .mockResolvedValueOnce({ id: 'cond-1' })
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, {
      token, body: { final: 'yes' },
    });

    expect(res.body.status).toBe('parked_again');
  });
});

// --- dispute and expiry -----------------------------------------------------

describe('POST /guard/tickets/:token/dispute', () => {
  it('flags the ticket so its condition media survives the retention sweep', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow())
      .mockResolvedValueOnce({ disputed_at: '2026-08-30T12:00:00Z' });

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/dispute`, { token, body: {} });

    expect(res.status).toBe(200);
    expect(res.body.disputed).toBe(true);
  });
});

describe('POST /guard/tickets/:token/expire', () => {
  it('force-closes an open ticket and schedules retention', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'parked' }))
      .mockResolvedValueOnce(ticketRow({ status: 'expired' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/expire`, { token, body: {} });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('expired');
    expect(schedulePhotoDeletion).toHaveBeenCalledWith(TICKET_ID);
  });

  it.each([['final_closed'], ['expired']])('refuses to re-close a %s ticket', async (status) => {
    queryOne.mockResolvedValueOnce(ticketRow({ status }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/expire`, { token, body: {} });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_closed');
  });
});

// --- listing ----------------------------------------------------------------

describe('GET /guard/tickets', () => {
  it('hides closed tickets by default', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/guard/tickets', { token });

    expect(queryRows.mock.calls[0][0]).toContain("NOT IN ('final_closed', 'expired')");
  });

  it('includes them with ?all=true', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/guard/tickets?all=true', { token });

    expect(queryRows.mock.calls[0][0]).not.toContain('NOT IN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Physical valet cards, and plate search
// ─────────────────────────────────────────────────────────────────────────────

describe('binding a printed card at intake', () => {
  function mockCreateWithCard({ cardFound = true, cardInUse = false } = {}) {
    mockClient.query
      .mockResolvedValueOnce({})                                                   // BEGIN
      .mockResolvedValueOnce({ rows: cardFound ? [{ id: 'card-1', code: 'A047' }] : [] })
      .mockResolvedValueOnce({ rows: cardInUse ? [{ display_id: 'SRT-0009' }] : [] })
      .mockResolvedValueOnce({ rows: [] })                                          // display id
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })                          // insert
      .mockResolvedValueOnce({})                                                     // logEvent
      .mockResolvedValueOnce({});                                                    // COMMIT
  }

  const body = (extra = {}) => ({
    plate: 'KA01AA1111',
    vehicleMake: 'Swift',
    stayEndAt: new Date(Date.now() + 86400000).toISOString(),
    ...extra,
  });

  it('binds the card and returns its code', async () => {
    mockCreateWithCard();

    const res = await request(app, 'POST', '/guard/tickets', { token, body: body({ cardCode: 'A047' }) });

    expect(res.status).toBe(201);
    expect(res.body.cardCode).toBe('A047');
  });

  it('stores the card on the ticket row', async () => {
    mockCreateWithCard();

    await request(app, 'POST', '/guard/tickets', { token, body: body({ cardCode: 'A047' }) });

    const insertParams = mockClient.query.mock.calls[4][1];
    expect(insertParams[8]).toBe('card-1');   // card_id
    expect(insertParams[9]).toBe('A047');     // card_code
  });

  it('refuses a card already on an open ticket, naming which one', async () => {
    // Reuse is the entire risk of physical cards: without this, two guests
    // would hold the same card pointing at different vehicles.
    mockCreateWithCard({ cardInUse: true });

    const res = await request(app, 'POST', '/guard/tickets', { token, body: body({ cardCode: 'A047' }) });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('card_in_use');
    expect(res.body.message).toContain('SRT-0009');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('refuses a card that belongs to no venue', async () => {
    mockCreateWithCard({ cardFound: false });

    const res = await request(app, 'POST', '/guard/tickets', { token, body: body({ cardCode: 'ZZZZ' }) });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('unknown_card');
  });

  it('still creates a ticket with no card at all — screen QR keeps working', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(app, 'POST', '/guard/tickets', { token, body: body() });

    expect(res.status).toBe(201);
    expect(res.body.cardCode).toBeNull();
    expect(res.body.qrDataUrl).toBe('data:image/png;base64,QR');
  });

  it('scopes the card lookup to the caller\'s community', async () => {
    mockCreateWithCard();

    await request(app, 'POST', '/guard/tickets', { token, body: body({ cardCode: 'A047' }) });

    expect(mockClient.query.mock.calls[1][1][0]).toBe(COMMUNITY_ID);
  });
});

describe('GET /guard/tickets/search', () => {
  it('finds tickets by plate prefix', async () => {
    queryRows.mockResolvedValueOnce([ticketRow()]);

    const res = await request(app, 'GET', '/guard/tickets/search?plate=KA03', { token });

    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(queryRows.mock.calls[0][1]).toEqual([COMMUNITY_ID, 'KA03']);
  });

  it('ignores spacing and case, like every other plate path', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/guard/tickets/search?plate=ka%2003%20nj', { token });

    expect(queryRows.mock.calls[0][1][1]).toBe('KA03NJ');
  });

  it('refuses a query too short to narrow anything, without hitting the database', async () => {
    const res = await request(app, 'GET', '/guard/tickets/search?plate=KA', { token });

    expect(res.body.tickets).toEqual([]);
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('puts open tickets above closed ones — the valet is looking for a car that is here', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/guard/tickets/search?plate=KA03', { token });

    expect(queryRows.mock.calls[0][0]).toContain("status NOT IN ('final_closed','expired')) DESC");
  });

  it('is scoped to the caller\'s community', async () => {
    queryRows.mockResolvedValueOnce([]);

    await request(app, 'GET', '/guard/tickets/search?plate=KA03', { token });

    expect(queryRows.mock.calls[0][1][0]).toBe(COMMUNITY_ID);
  });
});
