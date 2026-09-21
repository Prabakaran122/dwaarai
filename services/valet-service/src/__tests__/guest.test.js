import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/qr.js', () => ({ toDataUrl: vi.fn(async () => 'data:image/png;base64,QR') }));
vi.mock('../lib/storage.js', () => ({
  storage: { put: vi.fn(), getStream: vi.fn(), delete: vi.fn() },
  buildKey: vi.fn(() => 'key'),
  extensionFor: vi.fn(() => 'jpg'),
}));
vi.mock('../lib/realtime.js', () => ({ emitTicketUpdate: vi.fn(), getIO: vi.fn(), initRealtime: vi.fn() }));
vi.mock('../lib/discount.js', () => ({ issueDiscountCode: vi.fn() }));

import { Readable } from 'stream';
import { query, queryOne } from '../db.js';
import { storage } from '../lib/storage.js';
import { issueDiscountCode } from '../lib/discount.js';
import guestRoutes from '../routes/guest.js';
import { createApp, request, ticketRow, SESSION_TOKEN, TICKET_ID, COMMUNITY_ID } from './helpers.js';

const app = createApp(guestRoutes, '/guest');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /guest/tickets/:token', () => {
  it('returns the guest view for a live ticket', async () => {
    queryOne.mockResolvedValueOnce(ticketRow());

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.plate).toBe('KA03NJ0435');
    expect(res.body.venueName).toBe('Prestige Lakeside');
    expect(res.body.dropOffGuardName).toBe('Ramesh');
  });

  it('never leaks the session token or any internal id back to the guest', async () => {
    queryOne.mockResolvedValueOnce(ticketRow());

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.sessionToken).toBeUndefined();
    expect(res.body.id).toBeUndefined();
    expect(res.body.communityId).toBeUndefined();
  });

  it('returns an identical body for an unknown token and a closed one, so probing learns nothing', async () => {
    queryOne.mockResolvedValueOnce(null);
    const unknown = await request(app, 'GET', '/guest/tickets/does-not-exist');

    queryOne.mockResolvedValueOnce(null);
    const closed = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(unknown.status).toBe(404);
    expect(closed.status).toBe(404);
    expect(unknown.body).toEqual(closed.body);
  });

  it('hides the current guard until a request is actually in flight', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked', current_guard_name: 'Suresh' }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.guardName).toBeNull();
  });

  it('names the current guard once the car is on its way', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'en_route', current_guard_name: 'Suresh' }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.guardName).toBe('Suresh');
  });
});

describe('guest ETA countdown', () => {
  it('counts down from the guard estimate', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({
      status: 'en_route',
      eta_minutes: 5,
      en_route_started_at: new Date(Date.now() - 60_000).toISOString(),
      current_guard_name: 'Suresh',
    }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    // Five minutes promised, one elapsed: about four remaining.
    expect(res.body.etaSeconds).toBeGreaterThan(230);
    expect(res.body.etaSeconds).toBeLessThanOrEqual(240);
  });

  it('floors at zero rather than going negative when the guard runs late', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({
      status: 'en_route',
      eta_minutes: 2,
      en_route_started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.etaSeconds).toBe(0);
  });

  it('has no countdown when the guard skipped the estimate', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({
      status: 'en_route',
      eta_minutes: null,
      en_route_started_at: new Date().toISOString(),
    }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.etaSeconds).toBeNull();
  });
});

describe('POST /guest/tickets/:token/request', () => {
  it('moves a parked ticket to requested', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'parked' }))
      .mockResolvedValueOnce(ticketRow({ status: 'retrieval_requested' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/request`, { body: {} });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('retrieval_requested');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'retrieval_requested'"), [TICKET_ID]);
  });

  it('also accepts a re-request on a multi-day ticket parked again after a pickup', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }))
      .mockResolvedValueOnce(ticketRow({ status: 'retrieval_requested' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/request`, { body: {} });

    expect(res.status).toBe(200);
  });

  it('rejects a second request while one is already in flight', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'en_route' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/request`, { body: {} });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('wrong_status');
  });

  it('404s on an unknown token without touching the database', async () => {
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'POST', '/guest/tickets/nope/request', { body: {} });

    expect(res.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('GET /guest/tickets/:token/rotating-qr', () => {
  it('issues a QR only once the car has arrived at the pickup point', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked' }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}/rotating-qr`);

    expect(res.status).toBe(409);
  });

  it('issues a fresh short-lived token on each call', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ expires_at: new Date(Date.now() + 18000).toISOString() });

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}/rotating-qr`);

    expect(res.status).toBe(200);
    expect(res.body.qrDataUrl).toBe('data:image/png;base64,QR');
    expect(res.body.ttlSeconds).toBe(18);

    const [sql, params] = queryOne.mock.calls[1];
    expect(sql).toContain('INSERT INTO valet_rotating_tokens');
    expect(params[0]).toBe(TICKET_ID);
    expect(params[1]).toHaveLength(24);
  });
});

describe('GET /guest/tickets/:token/guard-badge/:which', () => {
  it('resolves the drop-off guard recorded on this ticket', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow())
      .mockResolvedValueOnce({ name: 'Ramesh', employee_code: 'EMP-101', badge_photo_key: 'k' });

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}/guard-badge/dropoff`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Ramesh', employeeCode: 'EMP-101', hasPhoto: true });
  });

  it('never exposes an ID document number, only the company badge fields', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow())
      .mockResolvedValueOnce({ name: 'Ramesh', employee_code: 'EMP-101', badge_photo_key: null });

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}/guard-badge/dropoff`);

    expect(Object.keys(res.body).sort()).toEqual(['employeeCode', 'hasPhoto', 'name']);
  });

  it('refuses any badge lookup that is not a guard on this ticket', async () => {
    // The guest must not be able to browse the staff roster: only 'dropoff'
    // and 'current' resolve, and only to guards already on their own ticket.
    queryOne.mockResolvedValueOnce(ticketRow());

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}/guard-badge/someone-else`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_guard');
  });

  it('reports a guard who has not set a badge up yet as an expected state', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow())
      .mockResolvedValueOnce({ name: 'Ramesh', employee_code: null, badge_photo_key: null });

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}/guard-badge/dropoff`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_badge');
  });

  it('404s the current-guard badge before anyone has accepted the request', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ current_guard_id: null }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}/guard-badge/current`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_guard');
  });
});

describe('POST /guest/tickets/:token/discount-optin', () => {
  it('issues a code for a valid Indian mobile number', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'final_closed' }));
    issueDiscountCode.mockResolvedValueOnce({ code: 'DWAAR-ABC234', expiry: '2026-09-30T00:00:00Z' });

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe('DWAAR-ABC234');
    expect(issueDiscountCode).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: '9876543210', communityId: COMMUNITY_ID, ticketId: TICKET_ID })
    );
  });

  it('accepts a +91 prefix and spacing', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'final_closed' }));
    issueDiscountCode.mockResolvedValueOnce({ code: 'DWAAR-ABC234', expiry: 'x' });

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '+91 98765 43210' },
    });

    expect(res.status).toBe(201);
  });

  it.each([
    ['too short', '98765'],
    ['starts below 6', '1234567890'],
    ['letters', 'abcdefghij'],
    ['empty', ''],
  ])('rejects an invalid number (%s) without storing anything', async (_label, phoneNumber) => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'final_closed' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_phone');
    expect(issueDiscountCode).not.toHaveBeenCalled();
  });

  it('is only offered once the ticket is finally closed', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(409);
    expect(issueDiscountCode).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Physical card resolution — what /valet/c/<code> hits
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /guest/cards/:communityId/:code (legacy shape)', () => {
  // clearAllMocks() clears call logs but not queued mockResolvedValueOnce
  // values, and the tests below deliberately return early — an id that is not
  // a uuid, a code too short to be one — leaving theirs unconsumed for the
  // next test.
  beforeEach(() => { queryOne.mockReset(); });

  it('resolves a bound card to its ticket', async () => {
    queryOne.mockResolvedValueOnce({ session_token: SESSION_TOKEN });

    const res = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/A047`);

    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toBe(SESSION_TOKEN);
  });

  it('returns the token, the card reference and the venue -- and nothing else', async () => {
    // A card code is short and guessable in a way the session token is not,
    // so this endpoint must not become a way to read someone's car details.
    //
    // The venue's name is a considered exception: the page this feeds is the
    // first thing a guest sees after scanning, and they are standing in the
    // place being named. The vehicle is not, and the exact key list is
    // asserted so adding a field is a decision rather than an accident.
    queryOne.mockResolvedValueOnce({
      session_token: SESSION_TOKEN, wa_ref: 'K7P2QM', community_name: 'The Leela Palace',
    });

    const res = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/A047`);

    expect(Object.keys(res.body).sort()).toEqual(['sessionToken', 'venueName', 'waRef']);
    expect(res.body.plate).toBeUndefined();
  });

  it('matches a card code case-insensitively — guests read them off plastic', async () => {
    queryOne.mockResolvedValueOnce({ session_token: SESSION_TOKEN });

    await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/a047`);

    expect(queryOne.mock.calls[0][1]).toEqual([COMMUNITY_ID, 'a047']);
    expect(queryOne.mock.calls[0][0]).toContain('UPPER(c.code) = UPPER($2)');
  });

  it('only ever resolves a card on an OPEN ticket', async () => {
    queryOne.mockResolvedValueOnce(null);

    await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/A047`);

    // A card handed to tomorrow's guest must never surface yesterday's car.
    expect(queryOne.mock.calls[0][0]).toContain("status NOT IN ('final_closed', 'expired')");
  });

  it('gives an unknown code and a free card the identical 404', async () => {
    queryOne.mockResolvedValueOnce(null);
    const unknown = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/ZZZZ`);

    queryOne.mockResolvedValueOnce(null);
    const free = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/A047`);

    // Probing codes must reveal neither which exist nor which are in use.
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(free.body);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Getting back in without holding anything
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /guest/cards/:communityId/:code', () => {
  // clearAllMocks() clears call logs but not queued mockResolvedValueOnce
  // values, and the tests below deliberately return early — an id that is not
  // a uuid, a code too short to be one — leaving theirs unconsumed for the
  // next test.
  beforeEach(() => { queryOne.mockReset(); });

  it('scopes the lookup to the venue on the card', async () => {
    // Card codes are unique per venue, never globally — a box of cards starts
    // at A001 everywhere. An unscoped lookup would match whichever property
    // the database returned first and could show a guest a stranger's vehicle.
    queryOne.mockResolvedValueOnce({ session_token: 'tok-1' });

    const res = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/A001`);

    expect(res.status).toBe(200);
    const [sql, params] = queryOne.mock.calls[0];
    expect(sql).toContain('c.community_id = $1');
    expect(params[0]).toBe(COMMUNITY_ID);
  });

  it('refuses a venue that is not a real id, without querying', async () => {
    const res = await request(app, 'GET', '/guest/cards/not-a-uuid/A001');

    expect(res.status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('gives an unbound card the same answer as an unknown one', async () => {
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/A999`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('GET /guest/claim/:code', () => {
  // clearAllMocks() clears call logs but not queued mockResolvedValueOnce
  // values, and the tests below deliberately return early — an id that is not
  // a uuid, a code too short to be one — leaving theirs unconsumed for the
  // next test.
  beforeEach(() => { queryOne.mockReset(); });

  it('resolves a typed code to its ticket', async () => {
    queryOne.mockResolvedValueOnce({ session_token: 'tok-9' });

    const res = await request(app, 'GET', '/guest/claim/4K7QP2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionToken: 'tok-9', venueName: null });
  });

  it('returns the token and the venue, and nothing about the vehicle', async () => {
    // The code is short and typed; it must never become a way to read a
    // vehicle's details. The venue's name is the one addition, for the same
    // reason as the card endpoint -- the guest is standing in it.
    queryOne.mockResolvedValueOnce({ session_token: 'tok-9', community_name: 'The Leela Palace' });

    const res = await request(app, 'GET', '/guest/claim/4K7QP2');

    expect(Object.keys(res.body).sort()).toEqual(['sessionToken', 'venueName']);
    expect(res.body.plate).toBeUndefined();
  });

  it('only matches an open ticket', async () => {
    queryOne.mockResolvedValueOnce(null);

    await request(app, 'GET', '/guest/claim/4K7QP2');

    expect(queryOne.mock.calls[0][0]).toContain("status NOT IN ('final_closed', 'expired')");
  });

  it('forgives the characters guests misread', async () => {
    // O for Q and I for J are the whole reason those letters are not in the
    // alphabet; a guest typing one has misread a character that is.
    queryOne.mockResolvedValueOnce({ session_token: 'tok-9' });

    await request(app, 'GET', '/guest/claim/4k7op2');

    expect(queryOne.mock.calls[0][1][0]).toBe('4K7QP2');
  });

  it('refuses a code too short to be one, without querying', async () => {
    const res = await request(app, 'GET', '/guest/claim/AB');

    expect(res.status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('gives a closed ticket the same answer as an unknown code', async () => {
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'GET', '/guest/claim/ZZZZZZ');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('the handover moment', () => {
  // The guard scans the guest QR, then walks round the car photographing it
  // before confirming pickup. The guest is in the driver's seat for all of
  // that, so anything the guest is meant to see has to land on the scan.
  const ARRIVED_AT = '2026-09-07T10:00:00.000Z';

  it('reports the handover once the guest QR has been scanned since this arrival', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ created_at: ARRIVED_AT })
      .mockResolvedValueOnce({ id: 'rotating-token-1' });

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.handedOver).toBe(true);
  });

  it('does not count a scan from a previous arrival on a multi-day ticket', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ created_at: ARRIVED_AT })
      .mockResolvedValueOnce(null);

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.handedOver).toBe(false);
  });

  it('is not a handover while the car has merely arrived, unscanned', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked' }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.handedOver).toBe(false);
  });

  it('offers the discount on the scan, before the guard has finished closing', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ created_at: ARRIVED_AT })
      .mockResolvedValueOnce({ id: 'rotating-token-1' });
    issueDiscountCode.mockResolvedValueOnce({ code: 'DWAAR-ABC234', expiry: 'x' });

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(201);
  });

  it('still refuses the discount when the car has arrived but nothing was scanned', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ created_at: ARRIVED_AT })
      .mockResolvedValueOnce(null);

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(409);
    expect(issueDiscountCode).not.toHaveBeenCalled();
  });
});

describe('what the thank-you screen needs to know', () => {
  it('says whether the venue has a logo, without leaking which venue', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ venue_logo_key: 'valet/branding/c1/logo.png' }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.hasVenueLogo).toBe(true);
    // The storage key and the community id are ours, not the guest's.
    expect(res.body.venueLogoKey).toBeUndefined();
    expect(res.body.communityId).toBeUndefined();
  });

  it('says there is no logo when the venue never uploaded one', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ venue_logo_key: null }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.hasVenueLogo).toBe(false);
  });

  it('says a printed card is in the guest hand, so they can be asked to return it', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ card_code: 'A047' }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.hasCard).toBe(true);
  });

  it('does not ask a screen-QR guest to return a card they never held', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ card_code: null }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.hasCard).toBe(false);
  });
});

describe('GET /guest/tickets/:token/venue-logo', () => {
  it('serves the logo off the session token, never off a community id', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ venue_logo_key: 'valet/branding/c1/logo.png' }));
    // A real stream, so the response actually ends — a stubbed pipe() leaves
    // the request hanging and the test just times out.
    storage.getStream.mockResolvedValueOnce(Readable.from([Buffer.from('PNG')]));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}/venue-logo`);

    expect(storage.getStream).toHaveBeenCalledWith('valet/branding/c1/logo.png');
    expect(res.status).toBe(200);
  });

  it('404s when the venue has no logo', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ venue_logo_key: null }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}/venue-logo`);

    expect(res.status).toBe(404);
  });
});

describe('a card scanned before the guard has finished intake', () => {
  it('still answers, with the reference the guest carries into WhatsApp', async () => {
    queryOne.mockResolvedValueOnce({ wa_ref: 'H7M2QP', session_token: null });

    const res = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/A047`);

    // The old behaviour was 404 until a ticket existed, which in this flow is
    // the common case: the guard scans to *start* intake and shows the card
    // immediately, long before plate and photos are done.
    expect(res.status).toBe(200);
    expect(res.body.waRef).toBe('H7M2QP');
    expect(res.body.sessionToken).toBeNull();
  });

  it('hands back the ticket too once there is one', async () => {
    queryOne.mockResolvedValueOnce({ wa_ref: 'H7M2QP', session_token: SESSION_TOKEN });

    const res = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/A047`);

    expect(res.body.sessionToken).toBe(SESSION_TOKEN);
  });

  it('still says nothing about a card that was never registered', async () => {
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/ZZZZ`);

    expect(res.status).toBe(404);
  });
});

describe('POST /guest/tickets/:token/feedback', () => {
  it('records a satisfied tap with no reasons', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'final_closed' }));
    query.mockResolvedValueOnce({});

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/feedback`, {
      body: { satisfied: true },
    });

    expect(res.status).toBe(201);
    expect(query.mock.calls[0][1]).toEqual([TICKET_ID, COMMUNITY_ID, true, []]);
  });

  it('keeps the reason chips when the guest was not satisfied', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'final_closed' }));
    query.mockResolvedValueOnce({});

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/feedback`, {
      body: { satisfied: false, reasons: ['long_wait', 'damage'] },
    });

    expect(res.status).toBe(201);
    expect(query.mock.calls[0][1][3]).toEqual(['long_wait', 'damage']);
  });

  it('refuses a reason chip it does not recognise', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'final_closed' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/feedback`, {
      body: { satisfied: false, reasons: ['made_up'] },
    });

    // A rollup counts chips. One typo in a client and a category exists that
    // nobody can read or remove.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_reason');
  });

  it('accepts a second tap without double counting', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'final_closed' }));
    // 23505: the UNIQUE on ticket_id did its job.
    query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/feedback`, {
      body: { satisfied: true },
    });

    // The guest tapped twice on a flaky connection. Telling them it failed
    // would invite a third tap; the record is already right.
    expect(res.status).toBe(200);
  });

  it('is only offered once the trip is over', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/feedback`, {
      body: { satisfied: true },
    });

    expect(res.status).toBe(409);
  });
});

describe('the promo slot on the receipt', () => {
  it('carries the venue promo when the venue has advertising', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({
      status: 'final_closed',
      promo_enabled: true, promo_label: 'Spa offer', promo_link: 'https://example.com/spa',
    }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.promo).toEqual({ label: 'Spa offer', link: 'https://example.com/spa' });
  });

  it('sends nothing for a venue without it, rather than an empty slot', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({
      status: 'final_closed',
      promo_enabled: null, promo_label: 'Leftover', promo_link: 'https://example.com',
    }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    // Copy can outlive the flag being switched off; the flag is what decides.
    expect(res.body.promo).toBeNull();
  });

  it('sends nothing when the venue has the slot but has written nothing in it', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({
      status: 'final_closed', promo_enabled: true, promo_label: null, promo_link: null,
    }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.promo).toBeNull();
  });
});

describe('the collection window on the guest page', () => {
  it('counts down from the arrival, not from when the page was opened', async () => {
    const arrivedAt = new Date(Date.now() - 60000).toISOString();
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ created_at: arrivedAt })   // last arrival
      .mockResolvedValueOnce(null);                        // no scan yet

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    // Reopening the page must not restart the window: the car has been at the
    // door for a minute either way.
    expect(res.body.collectBySeconds).toBeLessThanOrEqual(240);
    expect(res.body.collectBySeconds).toBeGreaterThan(200);
  });

  it('floors at zero rather than counting negative', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ created_at: new Date(Date.now() - 3600000).toISOString() })
      .mockResolvedValueOnce(null);

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.collectBySeconds).toBe(0);
  });

  it('says nothing about a window for a car that has not arrived', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked' }));

    const res = await request(app, 'GET', `/guest/tickets/${SESSION_TOKEN}`);

    expect(res.body.collectBySeconds).toBeNull();
  });
});

describe('the venue a guest is standing in', () => {
  it('names the venue when a card is resolved', async () => {
    queryOne.mockResolvedValueOnce({
      wa_ref: 'K7P2QM', session_token: null, community_name: 'The Leela Palace',
    });

    const res = await request(app, 'GET', `/guest/cards/${COMMUNITY_ID}/A001`);

    // The card page and the tracking page are the first two screens a guest
    // sees, and both said only "Your car is with us" over a code. Every other
    // surface carries the venue's name; these did not, which is the one place
    // a paying property's identity disappeared.
    expect(res.status).toBe(200);
    expect(res.body.venueName).toBe('The Leela Palace');
  });

  it('names the venue when a claim code is resolved', async () => {
    queryOne.mockResolvedValueOnce({
      session_token: 'tok', community_name: 'The Leela Palace',
    });

    const res = await request(app, 'GET', '/guest/claim/B73V5M');

    expect(res.status).toBe(200);
    expect(res.body.venueName).toBe('The Leela Palace');
  });
});
