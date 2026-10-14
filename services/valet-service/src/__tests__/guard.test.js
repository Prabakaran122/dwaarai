import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
vi.mock('../lib/anpr.js', () => ({ readPlate: vi.fn(async () => null), isConfigured: vi.fn(() => true) }));
vi.mock('../lib/whatsapp-guest.js', () => ({ notifyGuest: vi.fn(async () => ({ status: 'sent' })) }));
vi.mock('../lib/sms.js', () => ({ sendClaimCode: vi.fn(async () => ({ status: 'sent' })) }));
vi.mock('../lib/realtime.js', () => ({ emitTicketUpdate: vi.fn(), getIO: vi.fn(), initRealtime: vi.fn() }));
vi.mock('../lib/expiry.js', () => ({
  schedulePhotoDeletion: vi.fn(),
  scheduleConditionMediaDeletion: vi.fn(),
}));

import pool, { query, queryOne, queryRows } from '../db.js';
import { schedulePhotoDeletion, scheduleConditionMediaDeletion } from '../lib/expiry.js';
import { sendClaimCode } from '../lib/sms.js';
import { notifyGuest } from '../lib/whatsapp-guest.js';
import { readPlate, isConfigured as plateReaderConfigured } from '../lib/anpr.js';
import { toDataUrl } from '../lib/qr.js';
import guardRoutes, { conditionSchema } from '../routes/guard.js';
import { readFileSync } from 'node:fs';
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
  // A card is mandatory now, so every create here resolves one first: the
  // lookup and the "is it already on an open ticket" check both run before
  // the advisory lock.
  function mockCreateFlow(lastDisplayId) {
    mockClient.query
      .mockResolvedValueOnce({})                                        // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A001' }] }) // card lookup
      .mockResolvedValueOnce({ rows: [] })                              // card not in use
      .mockResolvedValueOnce({})                                        // advisory lock
      .mockResolvedValueOnce({ rows: lastDisplayId ? [{ display_id: lastDisplayId }] : [] })
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })             // INSERT ticket
      .mockResolvedValueOnce({})                                        // logEvent
      .mockResolvedValueOnce({});                                       // COMMIT
  }

  it('creates a ticket and returns the guest URL and QR', async () => {
    mockCreateFlow('DWR-0004');

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'ka 03 nj 0435',
        vehicleMake: 'Maruti Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(),
        cardCode: 'A001',
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.displayId).toBe('DWR-0005');
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
        cardCode: 'A001',
      },
    });

    const insertParams = mockClient.query.mock.calls[5][1];  // +2: card lookup and in-use check
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
        cardCode: 'A001',
        communityId: 'attacker-supplied-community',
      },
    });

    expect(mockClient.query.mock.calls[3][1][0]).toBe(COMMUNITY_ID);
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
      body: { stayEndAt: new Date(Date.now() + 86400000).toISOString(), cardCode: 'A001', ...body },
    });

    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('serialises display-id allocation with an advisory lock, per venue', async () => {
    // A row lock here does not serialise: two transactions lock the same
    // existing last row, and the loser resumes with a result set computed
    // before the winner's row existed, picks the same number and violates
    // UNIQUE (community_id, display_id) — a 500 for a guard mid-intake. With
    // no tickets yet there is no row to lock at all. The advisory lock exists
    // regardless of rows and is held to commit.
    mockCreateFlow('DWR-0004');

    await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA01AA1111',
        vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(),
        cardCode: 'A001',
      },
    });

    const [sql, params] = mockClient.query.mock.calls[3];  // +2: card lookup and in-use check
    expect(sql).toContain('pg_advisory_xact_lock');
    // Keyed per community, so two venues never wait on each other.
    expect(params).toEqual([COMMUNITY_ID]);
    // And taken before the number is read, not after.
    expect(mockClient.query.mock.calls[2][0]).toContain('SELECT display_id');
  });

  it('no longer takes a row lock that never serialised anything', async () => {
    mockCreateFlow('DWR-0004');

    await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA01AA1111',
        vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(),
        cardCode: 'A001',
      },
    });

    expect(mockClient.query.mock.calls[2][0]).not.toContain('FOR UPDATE');
  });

  it('rolls back and releases the connection when the insert fails', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A001' }] }) // card lookup
      .mockResolvedValueOnce({ rows: [] })                              // card not in use
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('duplicate key'));

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA01AA1111',
        vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(),
        cardCode: 'A001',
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
      // Present but empty: this visit recorded no make, name or type. The app
      // prefills nothing from an empty object, which is the same outcome as
      // before the field existed.
      lastSeen: {},
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
      .mockResolvedValueOnce(ticketRow({ status: 'retrieval_requested' }))
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
      .mockResolvedValueOnce(ticketRow({ status: 'retrieval_requested' }))
      .mockResolvedValueOnce(ticketRow({ status: 'en_route' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept`, {
      token, body: {},
    });

    expect(res.status).toBe(200);
    expect(query.mock.calls[0][1][1]).toBeNull();
  });

  it.each([[0], [61], [2.5], ['soon']])('rejects an out-of-range ETA (%s)', async (etaMinutes) => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'retrieval_requested' }));

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
      .mockResolvedValueOnce({ id: 'photo-1' })
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }));

    await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, { token, body: {} });

    const [sql, params] = queryOne.mock.calls[3];
    expect(sql).toContain("stage = 'return'");
    expect(sql).toContain('captured_at >= $2');
    expect(params[1]).toBe(arrival.created_at);
  });

  // The car has just been handed to the guest. It used to go straight to
  // 'parked_again', so the lot, the slot and the guest's own page all said it
  // was parked while the guest was driving it; it is 'with_guest' until a
  // valet checks it back in (POST /tickets/:token/returned).
  it('marks the car as with the guest by default, keeping the URL alive for a multi-day stay', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce(arrival)
      .mockResolvedValueOnce({ id: 'rt-1' })
      .mockResolvedValueOnce({ id: 'cond-1' })
      .mockResolvedValueOnce({ id: 'photo-1' })
      .mockResolvedValueOnce(ticketRow({ status: 'with_guest' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, {
      token, body: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('with_guest');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'with_guest'"), [TICKET_ID]);
    // Media retention is not scheduled while the ticket can still be used.
    expect(schedulePhotoDeletion).not.toHaveBeenCalled();
  });

  it('closes the ticket and schedules media retention on a final checkout', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce(arrival)
      .mockResolvedValueOnce({ id: 'rt-1' })
      .mockResolvedValueOnce({ id: 'cond-1' })
      .mockResolvedValueOnce({ id: 'photo-1' })
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
      .mockResolvedValueOnce({ id: 'photo-1' })
      .mockResolvedValueOnce(ticketRow({ status: 'with_guest' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, {
      token, body: { final: 'yes' },
    });

    expect(res.body.status).toBe('with_guest');
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
      .mockResolvedValueOnce({ rows: cardInUse ? [{ display_id: 'DWR-0009' }] : [] })
      .mockResolvedValueOnce({})                                                    // advisory lock
      .mockResolvedValueOnce({ rows: [] })                                          // display id
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })                          // insert
      .mockResolvedValueOnce({})                                                     // logEvent
      .mockResolvedValueOnce({});                                                    // COMMIT
  }

  const body = (extra = {}) => ({
    plate: 'KA01AA1111',
    vehicleMake: 'Swift',
    stayEndAt: new Date(Date.now() + 86400000).toISOString(),
    cardCode: 'A001',
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

    const insertParams = mockClient.query.mock.calls[5][1];
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
    expect(res.body.message).toContain('DWR-0009');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('refuses a card that belongs to no venue', async () => {
    mockCreateWithCard({ cardFound: false });

    const res = await request(app, 'POST', '/guard/tickets', { token, body: body({ cardCode: 'ZZZZ' }) });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('unknown_card');
  });

  it('refuses a ticket with no card — the card IS the ticket', async () => {
    // This replaces "still creates a ticket with no card at all — screen QR
    // keeps working". That was a real decision once: a venue with no printed
    // stock fell back to a QR on the guard's screen. It is not how this works
    // any more -- one card is scanned twice, by the guard to start intake and
    // by the guest to reach WhatsApp -- so a cardless ticket is a guest
    // holding nothing.
    const { cardCode, ...noCard } = body();
    const res = await request(app, 'POST', '/guard/tickets', { token, body: noCard });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('card_required');
    // Refused before a transaction is opened at all.
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('scopes the card lookup to the caller\'s community', async () => {
    mockCreateWithCard();

    await request(app, 'POST', '/guard/tickets', { token, body: body({ cardCode: 'A047' }) });

    expect(mockClient.query.mock.calls[1][1][0]).toBe(COMMUNITY_ID);
  });

  it('turns losing the race to the index into a 409, not a 500', async () => {
    // The lookup above cannot catch two guards scanning the same card at the
    // same instant: both read "free" before either inserts, and across two
    // service instances the event loop does not serialise them either. The
    // partial unique index is what actually holds, and a guard who loses to it
    // must be told the card is taken rather than shown an opaque server error.
    const violation = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'idx_valet_card_one_open_ticket',
    });
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A047' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(violation);

    const res = await request(app, 'POST', '/guard/tickets', { token, body: body({ cardCode: 'A047' }) });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('card_in_use');
    expect(res.body.message).toBeTruthy();
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('does not mistake an unrelated unique violation for a card clash', async () => {
    // The same INSERT can violate UNIQUE (community_id, display_id). That is a
    // genuine server fault, and reporting it as "card is taken" would send a
    // guard hunting for a card that is fine.
    const violation = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'valet_tickets_community_id_display_id_key',
    });
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A047' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(violation);

    const res = await request(app, 'POST', '/guard/tickets', { token, body: body({ cardCode: 'A047' }) });

    expect(res.status).toBe(500);
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

// ─────────────────────────────────────────────────────────────────────────────
// How the guest was identified at handover
// ─────────────────────────────────────────────────────────────────────────────

describe('recording how the guard identified the guest', () => {
  // The scan proves possession of the live ticket; it says nothing about who is
  // holding it. Which second check happened has to survive into the audit trail.
  function mockConfirmFlow({ hasPhoto }) {
    // Reset the queue, not just the call log: vi.clearAllMocks() clears calls
    // but leaves queued mockResolvedValueOnce values in place, and a test that
    // returns early (the refused claim below) leaves one behind to be consumed
    // by whichever test runs next.
    queryOne.mockReset();
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))            // findTicket
      .mockResolvedValueOnce({ created_at: '2026-09-01T10:00:00Z' })      // last arrival
      .mockResolvedValueOnce({ id: 'scan-1' })                            // verified scan
      .mockResolvedValueOnce({ id: 'return-1' })                          // return capture
      .mockResolvedValueOnce(hasPhoto ? { id: 'photo-1' } : null)         // guest photo
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }));      // reload
  }

  /** The metadata written alongside an event, parsed back out. */
  function metadataFor(eventType) {
    const call = query.mock.calls.find(
      (c) => String(c[0]).includes('valet_ticket_events') && c[1]?.[1] === eventType
    );
    return call ? JSON.parse(call[1][3]) : null;
  }

  it('records a photo match when a photo exists', async () => {
    mockConfirmFlow({ hasPhoto: true });

    const res = await request(app, 'POST', '/guard/tickets/tok/confirm-pickup', {
      token, body: { verification: 'photo' },
    });

    expect(res.status).toBe(200);
    expect(metadataFor('closed_pickup').verification).toBe('photo');
  });

  it('records a vehicle confirmation when there is no photo', async () => {
    // The distinction is the whole point: a dispute must be able to tell a
    // real photo match from a release where nobody's face was ever recorded.
    mockConfirmFlow({ hasPhoto: false });

    const res = await request(app, 'POST', '/guard/tickets/tok/confirm-pickup', {
      token, body: { verification: 'vehicle_confirmed' },
    });

    expect(res.status).toBe(200);
    expect(metadataFor('closed_pickup').verification).toBe('vehicle_confirmed');
  });

  it('refuses a claimed photo match on a ticket carrying no photo', async () => {
    // Checked server-side because the client is the thing being audited.
    mockConfirmFlow({ hasPhoto: false });

    const res = await request(app, 'POST', '/guard/tickets/tok/confirm-pickup', {
      token, body: { verification: 'photo' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_photo_to_match');
  });

  it('does not close the ticket when the claim is refused', async () => {
    mockConfirmFlow({ hasPhoto: false });

    await request(app, 'POST', '/guard/tickets/tok/confirm-pickup', {
      token, body: { verification: 'photo' },
    });

    expect(JSON.stringify(query.mock.calls)).not.toContain('closed_pickup');
  });

  it('rejects a verification value it does not recognise', async () => {
    mockConfirmFlow({ hasPhoto: true });

    const res = await request(app, 'POST', '/guard/tickets/tok/confirm-pickup', {
      token, body: { verification: 'vibes' },
    });

    expect(res.status).toBe(400);
  });

  it('falls back to the truth when an older app sends no verification field', async () => {
    // A build from before this change must not silently record a photo match.
    mockConfirmFlow({ hasPhoto: false });

    await request(app, 'POST', '/guard/tickets/tok/confirm-pickup', { token, body: {} });

    expect(metadataFor('closed_pickup').verification).toBe('vehicle_confirmed');
  });

  it('stamps the verification on a final checkout too', async () => {
    mockConfirmFlow({ hasPhoto: true });

    await request(app, 'POST', '/guard/tickets/tok/confirm-pickup', {
      token, body: { verification: 'photo', final: true },
    });

    expect(metadataFor('final_closed').verification).toBe('photo');
  });
});


describe('the claim code a guest carries away', () => {
  function mockCreate() {
    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValueOnce({})                              // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A001' }] }) // card lookup
      .mockResolvedValueOnce({ rows: [] })                    // card not in use
      .mockResolvedValueOnce({})                              // advisory lock
      .mockResolvedValueOnce({ rows: [] })                    // display id
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })   // insert
      .mockResolvedValueOnce({})                              // logEvent
      .mockResolvedValueOnce({});                             // COMMIT
  }
  const body = () => ({
    plate: 'KA01AA1111', vehicleMake: 'Swift',
    stayEndAt: new Date(Date.now() + 86400000).toISOString(), cardCode: 'A001',
  });

  it('issues one on every ticket, alongside the card code', async () => {
    mockCreate();

    const res = await request(app, 'POST', '/guard/tickets', { token, body: body() });

    expect(res.body.claimCode).toMatch(/^[ABCDEFGHJKLMNPQRTUVWXYZ23456789]{6}$/);
  });

  it('stores it on the ticket row', async () => {
    mockCreate();

    await request(app, 'POST', '/guard/tickets', { token, body: body() });

    const params = mockClient.query.mock.calls[5][1];  // +2: card lookup and in-use check
    expect(params[9]).toBe('A001');                    // card_code
    expect(params[10]).toMatch(/^[A-Z0-9]{6}$/);       // claim_code
  });

  it('tells the app where the guest should type it', async () => {
    // The app only knows the API base. A guessed public URL is exactly what
    // shipped a guard APK pointing at a dead host.
    mockCreate();

    const res = await request(app, 'POST', '/guard/tickets', { token, body: body() });

    expect(res.body.claimUrl).toBeTruthy();
    expect(res.body.claimUrl).not.toContain('/v/');
  });
});

describe('POST /guard/tickets — texting the guest the code', () => {
  const future = () => new Date(Date.now() + 86400000).toISOString();

  function mockCreateFlow() {
    mockClient.query
      .mockResolvedValueOnce({})                                        // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A001' }] }) // card lookup
      .mockResolvedValueOnce({ rows: [] })                              // card not in use
      .mockResolvedValueOnce({})                                        // advisory lock
      .mockResolvedValueOnce({ rows: [] })                              // display id
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
  }

  it('texts the claim code when the guest gave a number, and says it went', async () => {
    mockCreateFlow();
    vi.mocked(sendClaimCode).mockResolvedValueOnce({ status: 'sent' });

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: future(), cardCode: 'A001', phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(201);
    expect(res.body.smsStatus).toBe('sent');
    expect(sendClaimCode).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: '9876543210', claimCode: res.body.claimCode })
    );
  });

  it('sends nothing and says nothing when no number was given', async () => {
    mockCreateFlow();

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: future(), cardCode: 'A001' },
    });

    expect(res.status).toBe(201);
    expect(res.body.smsStatus).toBeNull();
    expect(sendClaimCode).not.toHaveBeenCalled();
  });

  it('refuses a number that is not a real Indian mobile, before taking the car in', async () => {
    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: future(), cardCode: 'A001', phoneNumber: '12345' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_phone');
    expect(sendClaimCode).not.toHaveBeenCalled();
  });

  it('still creates the ticket when the text fails — the car is already parked', async () => {
    mockCreateFlow();
    vi.mocked(sendClaimCode).mockResolvedValueOnce({ status: 'failed' });

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: future(), cardCode: 'A001', phoneNumber: '9876543210' },
    });

    // The guard needs to know it failed so they read the code out instead.
    expect(res.status).toBe(201);
    expect(res.body.smsStatus).toBe('failed');
    expect(res.body.claimCode).toBeTruthy();
  });
});

describe('keeping the WhatsApp thread up to date', () => {
  it('tells the guest when a valet is on the way', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'retrieval_requested', phone_number: '919876543210' }))
      .mockResolvedValueOnce(ticketRow({ status: 'en_route', phone_number: '919876543210' }));
    query.mockResolvedValue({});

    await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept`, {
      token, body: { etaMinutes: 4 },
    });

    expect(notifyGuest).toHaveBeenCalledWith(expect.anything(), 'en_route');
  });

  it('tells the guest the moment the car reaches the pickup point', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'en_route', phone_number: '919876543210' }))
      .mockResolvedValueOnce(ticketRow({ status: 'arrived', phone_number: '919876543210' }));
    query.mockResolvedValue({});

    await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/arrived`, { token });

    expect(notifyGuest).toHaveBeenCalledWith(expect.anything(), 'arrived');
  });

  it('says nothing to a ticket that was never bound to WhatsApp', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'retrieval_requested', phone_number: null }))
      .mockResolvedValueOnce(ticketRow({ status: 'en_route', phone_number: null }));
    query.mockResolvedValue({});

    await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept`, {
      token, body: { etaMinutes: 4 },
    });

    expect(notifyGuest).not.toHaveBeenCalled();
  });
});

describe('what the intake QR points at', () => {
  it('always opens the door page, so WhatsApp is the path a guest meets first', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A001' }] }) // card lookup
      .mockResolvedValueOnce({ rows: [] })                              // card not in use
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA03NJ0435',
        vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(),
        cardCode: 'A001',
      },
    });

    expect(toDataUrl).toHaveBeenCalledWith(expect.stringContaining(`/w/${res.body.claimCode}`));
    // The ticket page stays reachable -- from the door, not from the QR.
    expect(toDataUrl).not.toHaveBeenCalledWith(expect.stringContaining(`/v/${res.body.sessionToken}`));
  });
});

describe('a number the guest left on the card before intake finished', () => {
  it('moves onto the ticket and gets the real welcome once the car is in', async () => {
    mockClient.query
      .mockResolvedValueOnce({})                                                   // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A047', pending_wa_phone: '919876543210' }] })
      .mockResolvedValueOnce({ rows: [] })                                         // card not in use
      .mockResolvedValueOnce({})                                                   // advisory lock
      .mockResolvedValueOnce({ rows: [] })                                         // last display id
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })                        // INSERT ticket
      .mockResolvedValueOnce({})                                                   // clear the card hold
      .mockResolvedValueOnce({})                                                   // logEvent
      .mockResolvedValueOnce({});                                                  // COMMIT
    queryOne.mockResolvedValue({ name: 'The Leela' });

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA03NJ0435', vehicleMake: 'Swift', cardCode: 'A047',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(), cardCode: 'A001',
      },
    });

    expect(res.status).toBe(201);
    // The guest scanned before the car was checked in; this is the moment the
    // promise made to them ("we will message you when it is parked") is kept.
    expect(notifyGuest).toHaveBeenCalledWith(
      expect.objectContaining({ phone_number: '919876543210' }), 'bound'
    );
  });
});

const SLOT_ID = '44444444-4444-4444-4444-444444444444';

describe('slots, at the stand', () => {
  it('offers only the free ones, grouped by floor and zone', async () => {
    queryOne.mockResolvedValueOnce({ slots_enabled: true });
    queryRows.mockResolvedValueOnce([
      { id: 's1', floor: 'B1', zone: 'A', number: '01' },
      { id: 's2', floor: 'B1', zone: 'A', number: '02' },
      { id: 's3', floor: 'G', zone: 'PORCH', number: '01' },
    ]);

    const res = await request(app, 'GET', '/guard/slots', { token });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.floors).toEqual([
      { floor: 'B1', zones: [{ zone: 'A', slots: [
        { id: 's1', number: '01' }, { id: 's2', number: '02' },
      ] }] },
      { floor: 'G', zones: [{ zone: 'PORCH', slots: [{ id: 's3', number: '01' }] }] },
    ]);
  });

  it('says the feature is off rather than returning an empty garage', async () => {
    queryOne.mockResolvedValueOnce({ slots_enabled: null });

    const res = await request(app, 'GET', '/guard/slots', { token });

    // An empty list and a disabled feature mean very different things to the
    // app: one hides the step, the other says "no space left".
    expect(res.body.enabled).toBe(false);
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('records the slot the attendant picked', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A001' }] }) // card lookup
      .mockResolvedValueOnce({ rows: [] })                              // card not in use
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SLOT_ID }] })       // slot is real and free
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA03NJ0435', vehicleMake: 'Swift', slotId: SLOT_ID,
        stayEndAt: new Date(Date.now() + 86400000).toISOString(), cardCode: 'A001',
      },
    });

    expect(res.status).toBe(201);
  });

  it('takes the car in anyway when no slot was given', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A001' }] }) // card lookup
      .mockResolvedValueOnce({ rows: [] })                              // card not in use
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA03NJ0435', vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(), cardCode: 'A001',
      },
    });

    // A full garage at 9pm on a Saturday must never be the reason a car
    // cannot be taken in. Valets double-park; the app must not argue.
    expect(res.status).toBe(201);
  });
});

describe('who the guest is and what they drive', () => {
  const future = () => new Date(Date.now() + 86400000).toISOString();
  function flow() {
    mockClient.query
      .mockResolvedValueOnce({})                                        // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A001' }] }) // card lookup
      .mockResolvedValueOnce({ rows: [] })                              // card not in use
      .mockResolvedValueOnce({})                                        // advisory lock
      .mockResolvedValueOnce({ rows: [] })                              // display id
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })
      .mockResolvedValueOnce({}).mockResolvedValueOnce({});
  }

  it('records the guest name, car type and premium flag', async () => {
    flow();

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA03NJ0435', vehicleMake: 'Fortuner', stayEndAt: future(), cardCode: 'A001',
        guestName: 'A. Mehta', carType: 'suv', isPremium: true,
      },
    });

    expect(res.status).toBe(201);
    const insert = mockClient.query.mock.calls.find((c) => /INSERT INTO valet_tickets/.test(c[0]));
    expect(insert[1]).toEqual(expect.arrayContaining(['A. Mehta', 'suv', true]));
  });

  it('takes the car in with none of them given', async () => {
    flow();

    const res = await request(app, 'POST', '/guard/tickets', {
      token, body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: future(), cardCode: 'A001' },
    });

    // A guest who declines a name still gets their car parked. An intake that
    // insists is one guards learn to type "x" into.
    expect(res.status).toBe(201);
  });

  it('refuses a car type that is not one of the three', async () => {
    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: {
        plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: future(), cardCode: 'A001',
        carType: 'spaceship',
      },
    });

    // The point of the field is counting them, and a free-text value is a
    // category nobody can count or remove.
    expect(res.status).toBe(400);
  });
});

describe('intake that starts when the card is scanned', () => {
  it('creates a job before the details exist', async () => {
    mockClient.query
      .mockResolvedValueOnce({})                              // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A001' }] }) // card lookup
      .mockResolvedValueOnce({ rows: [] })                              // card not in use
      .mockResolvedValueOnce({})                              // advisory lock
      .mockResolvedValueOnce({ rows: [] })                    // last display id
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })   // INSERT
      .mockResolvedValueOnce({})                              // logEvent
      .mockResolvedValueOnce({});                             // COMMIT

    const res = await request(app, 'POST', '/guard/tickets/start', { token, body: { cardCode: 'A001' } });

    expect(res.status).toBe(201);
    expect(res.body.sessionToken).toHaveLength(32);
    expect(res.body.claimCode).toBeTruthy();
    const insert = mockClient.query.mock.calls.find((c) => /INSERT INTO valet_tickets/.test(c[0]));
    // The plate is what the next ninety seconds are for.
    expect(insert[0]).toMatch(/'parking_in_progress'/);
  });

  it('binds the scanned card and claims a number the guest already left', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A047', pending_wa_phone: '919876543210' }] })
      .mockResolvedValueOnce({ rows: [] })                    // card not in use
      .mockResolvedValueOnce({})                              // advisory lock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] })
      .mockResolvedValueOnce({})                              // claim the held phone
      .mockResolvedValueOnce({})                              // clear the card hold
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(app, 'POST', '/guard/tickets/start', {
      token, body: { cardCode: 'A047' },
    });

    expect(res.status).toBe(201);
    const sql = mockClient.query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/pending_wa_phone/);
  });

  it('refuses a card already on another open ticket', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'card-1', code: 'A047' }] })
      .mockResolvedValueOnce({ rows: [{ display_id: 'DWR-0007' }] })
      .mockResolvedValueOnce({});

    const res = await request(app, 'POST', '/guard/tickets/start', {
      token, body: { cardCode: 'A047' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('card_in_use');
  });
});

describe('completing an intake', () => {
  const body = () => ({
    plate: 'KA03NJ0435', vehicleMake: 'Swift',
    stayEndAt: new Date(Date.now() + 86400000).toISOString(), cardCode: 'A001',
  });

  it('fills the details in and parks the car', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'parking_in_progress' }))
      .mockResolvedValueOnce(ticketRow({ status: 'parked' }));
    query.mockResolvedValue({});

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/complete`, {
      token, body: body(),
    });

    expect(res.status).toBe(200);
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/status = 'parked'/);
    expect(sql).toMatch(/plate/);
  });

  it('refuses to complete a car that is already parked', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/complete`, {
      token, body: body(),
    });

    // Completing twice would overwrite a plate somebody already checked.
    expect(res.status).toBe(409);
  });

  it('refuses a body missing the details that make it parkable', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parking_in_progress' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/complete`, {
      token, body: { plate: 'KA03NJ0435' },
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /guard/plate-scan', () => {
  it('suggests a plate it read, and says it is only a suggestion', async () => {
    vi.mocked(readPlate).mockResolvedValueOnce({ plate: 'KA03NJ0435', confidence: 0.94 });

    const res = await request(app, 'POST', '/guard/plate-scan', {
      token,
      headers: { 'Content-Type': 'application/json' },
      body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    expect(res.status).toBe(200);
    expect(res.body.plate).toBe('KA03NJ0435');
    expect(res.body.confidence).toBeCloseTo(0.94);
  });

  it('answers 200 with no plate rather than an error when it cannot read one', async () => {
    vi.mocked(readPlate).mockResolvedValueOnce(null);

    const res = await request(app, 'POST', '/guard/plate-scan', {
      token, body: { imageBase64: Buffer.from('jpeg').toString('base64') },
    });

    // Not being able to read a plate is the ordinary case, not a failure. An
    // error here would put a red banner in front of a guard who simply needs
    // to type it.
    expect(res.status).toBe(200);
    expect(res.body.plate).toBeNull();
  });

  it('needs an image', async () => {
    const res = await request(app, 'POST', '/guard/plate-scan', { token, body: {} });

    expect(res.status).toBe(400);
  });
});

describe('accepting a job from the queue', () => {
  it('takes a waiting job and puts the attendant on it', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'requested' }))
      .mockResolvedValueOnce(ticketRow({ status: 'accepted' }));
    query.mockResolvedValue({});

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept-intake`, { token });

    expect(res.status).toBe(200);
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/status = 'accepted'/);
    expect(sql).toMatch(/created_by_guard_id/);
  });

  it('refuses a job somebody has already taken', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'accepted' }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept-intake`, { token });

    // Two attendants walking to the same car is the failure this prevents.
    expect(res.status).toBe(409);
  });
});

describe('finishing a job the desk logged', () => {
  it('completes straight from accepted', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'accepted' }))
      .mockResolvedValueOnce(ticketRow({ status: 'parked' }));
    query.mockResolvedValue({});

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/complete`, {
      token,
      body: {
        plate: 'KA03NJ0435', vehicleMake: 'Swift',
        stayEndAt: new Date(Date.now() + 86400000).toISOString(), cardCode: 'A001',
      },
    });

    // A desk-logged job is accepted and then parked. Insisting it pass
    // through parking_in_progress would be a state transition for its own
    // sake, with an attendant standing at a car waiting for it.
    expect(res.status).toBe(200);
  });
});

describe('what this deployment can actually do', () => {
  it('advertises plate reading when a reader is configured', async () => {
    vi.mocked(plateReaderConfigured).mockReturnValueOnce(true);

    const res = await request(app, 'GET', '/guard/capabilities', { token });

    expect(res.status).toBe(200);
    expect(res.body.plateScan).toBe(true);
  });

  it('says so plainly when no reader is configured', async () => {
    vi.mocked(plateReaderConfigured).mockReturnValueOnce(false);

    const res = await request(app, 'GET', '/guard/capabilities', { token });

    // The app hides the camera button on this answer. A button that opens a
    // camera, waits, and then always says "could not read it" does not teach
    // an attendant "this venue has no reader" -- it teaches them the feature
    // is broken, and they stop trying where it does work.
    expect(res.body.plateScan).toBe(false);
  });

  it('answers without touching the database', async () => {
    // It is an env check behind the scenes. A capability call on every intake
    // must not add a query to the busiest path in the product.
    queryOne.mockClear();
    await request(app, 'GET', '/guard/capabilities', { token });
    expect(queryOne).not.toHaveBeenCalled();
  });
});

describe('the plate photo taken at intake', () => {
  // BRD Screen 4: the camera opens by default and the typed plate is the real
  // data beneath it. The photo is worth keeping on its own -- it is what the
  // registration looked like on arrival, and that survives a dispute whether
  // or not a recogniser was ever deployed.
  //
  // Driven against the schema rather than over HTTP: this endpoint takes
  // multipart, the test helper speaks JSON only, and a malformed request
  // returns the same 400 as a rejected angle -- so an HTTP test here passes
  // whether or not the code is right, which is worse than no test.
  it("accepts 'plate' alongside the four condition angles", () => {
    for (const angle of ['front', 'back', 'left', 'right', 'plate']) {
      expect(conditionSchema.safeParse({ stage: 'intake', mediaType: 'photo', angle }).success).toBe(true);
    }
  });

  it('still refuses an angle nobody defined', () => {
    expect(conditionSchema.safeParse({ stage: 'intake', mediaType: 'photo', angle: 'windscreen' }).success).toBe(false);
  });

  it('matches the CHECK constraint in migration 060 exactly', () => {
    // Drift here is a 500 at the stand rather than a readable 400: zod would
    // wave through an angle Postgres then rejects.
    const sql = readFileSync(
      new URL('../../../api-gateway/migrations/060_valet_plate_photo.sql', import.meta.url), 'utf8'
    );
    const inDb = [...sql.matchAll(/'(front|back|left|right|plate)'/g)].map((m) => m[1]);
    for (const angle of ['front', 'back', 'left', 'right', 'plate']) {
      expect(inDb).toContain(angle);
      expect(conditionSchema.safeParse({ stage: 'intake', mediaType: 'photo', angle }).success).toBe(true);
    }
  });
});

describe('a vehicle we have seen before', () => {
  // An attendant re-typing "Toyota Innova" for the ninth time on a regular's
  // car is doing data entry the system could have done. The plate is already
  // being looked up to show the returning banner; the same row can carry what
  // was recorded last time.
  it('returns what was recorded on the most recent visit', async () => {
    queryOne.mockResolvedValueOnce({
      visit_count: 9,
      last_visit_at: '2026-09-20T10:00:00Z',
      vehicle_make: 'Toyota Innova',
      guest_name: 'A. Mehta',
      car_type: 'suv',
      is_premium: true,
    });

    const res = await request(app, 'GET', '/guard/plate-lookup?plate=KA03NJ0435', { token });

    expect(res.body.isReturning).toBe(true);
    expect(res.body.visitCount).toBe(9);
    expect(res.body.lastSeen).toEqual({
      vehicleMake: 'Toyota Innova',
      guestName: 'A. Mehta',
      carType: 'suv',
      isPremium: true,
    });
  });

  it('says nothing about a plate it has never seen', async () => {
    queryOne.mockResolvedValueOnce({ visit_count: 0 });

    const res = await request(app, 'GET', '/guard/plate-lookup?plate=KA99ZZ9999', { token });

    expect(res.body.isReturning).toBe(false);
    expect(res.body.lastSeen).toBeUndefined();
  });

  it('omits fields the last visit never recorded, rather than sending nulls to prefill with', async () => {
    // A car checked in with no guest name must not prefill the name box with
    // "null" or blank out something the attendant has already typed.
    queryOne.mockResolvedValueOnce({
      visit_count: 2, last_visit_at: '2026-09-20T10:00:00Z',
      vehicle_make: 'Swift', guest_name: null, car_type: null, is_premium: false,
    });

    const res = await request(app, 'GET', '/guard/plate-lookup?plate=KA03NJ0435', { token });

    expect(res.body.lastSeen.vehicleMake).toBe('Swift');
    expect('guestName' in res.body.lastSeen).toBe(false);
    expect('carType' in res.body.lastSeen).toBe(false);
  });

  it('reads the latest visit, not an arbitrary one', async () => {
    queryOne.mockResolvedValueOnce({ visit_count: 3, last_visit_at: '2026-09-20T10:00:00Z', vehicle_make: 'X' });
    await request(app, 'GET', '/guard/plate-lookup?plate=KA03NJ0435', { token });
    const sql = queryOne.mock.calls[0][0];
    expect(sql).toMatch(/ORDER BY[\s\S]*created_at DESC/i);
  });
});

describe('a ticket needs a card', () => {
  // The card is the ticket. One printed QR is scanned twice -- by the guard to
  // start intake, then by the guest off the same card to reach WhatsApp -- so
  // a ticket with no card is a guest with nothing in their hand and no way in.
  //
  // Enforced here and not only in the app: an APK built before this rule, or
  // one somebody sideloads, must not be able to create a ticket the guest can
  // never reach.
  it('refuses intake with no card', async () => {
    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: '2026-12-01T10:00:00Z' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('card_required');
  });

  it('refuses a blank card as firmly as a missing one', async () => {
    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: '2026-12-01T10:00:00Z', cardCode: '   ' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('card_required');
  });

  it('still complains about the missing plate first', async () => {
    // Field validation before policy: an attendant who left the plate blank
    // should be told that, not sent to look for a card they already scanned.
    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { vehicleMake: 'Swift', stayEndAt: '2026-12-01T10:00:00Z' },
    });

    expect(res.body.error).toBe('missing_fields');
  });
});

describe('retry safety on the intake routes', () => {
  // The offline outbox replays whatever it could not send. Without a dedupe
  // the same car is taken in twice, under two display ids, with one card bound
  // to a ticket nobody is watching.
  it('is wired after the auth middleware, not before it', async () => {
    // The key is scoped per community and that comes off the token. Mounted
    // ahead of auth this would see no user, decline to act on every request,
    // and look exactly like it was working.
    const src = readFileSync(new URL('../routes/guard.js', import.meta.url), 'utf8');
    for (const route of ['/tickets', '/tickets/start', '/tickets/:token/complete']) {
      const line = src.split('\n').find((l) => l.includes(`router.post('${route}'`));
      expect(line).toBeTruthy();
      expect(line).toMatch(/guard,\s*once,/);
    }
  });
});

describe('the doors an attendant can start a shift at', () => {
  it('offers only the ones a shift can actually be worked at', async () => {
    // A paused door must not appear in the picker: choosing it would file a
    // shift against a place nobody is standing, and the shift log would then
    // be confidently wrong about where somebody was.
    queryRows.mockResolvedValueOnce([{ id: 'p1', name: 'Main porch' }]);

    const res = await request(app, 'GET', '/guard/points', { token });

    expect(res.status).toBe(200);
    expect(res.body.points[0].name).toBe('Main porch');
    expect(queryRows.mock.calls[0][0]).toMatch(/status <> 'paused'/);
    expect(queryRows.mock.calls[0][1]).toContain(COMMUNITY_ID);
  });
});
