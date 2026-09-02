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

import { query, queryOne } from '../db.js';
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
      .mockResolvedValueOnce(ticketRow({ status: 'requested' }));

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/request`, { body: {} });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('requested');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'requested'"), [TICKET_ID]);
  });

  it('also accepts a re-request on a multi-day ticket parked again after a pickup', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }))
      .mockResolvedValueOnce(ticketRow({ status: 'requested' }));

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
    issueDiscountCode.mockResolvedValueOnce({ code: 'SARTHI-ABC234', expiry: '2026-09-30T00:00:00Z' });

    const res = await request(app, 'POST', `/guest/tickets/${SESSION_TOKEN}/discount-optin`, {
      body: { phoneNumber: '9876543210' },
    });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe('SARTHI-ABC234');
    expect(issueDiscountCode).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: '9876543210', communityId: COMMUNITY_ID, ticketId: TICKET_ID })
    );
  });

  it('accepts a +91 prefix and spacing', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'final_closed' }));
    issueDiscountCode.mockResolvedValueOnce({ code: 'SARTHI-ABC234', expiry: 'x' });

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

describe('GET /guest/cards/:code', () => {
  it('resolves a bound card to its ticket', async () => {
    queryOne.mockResolvedValueOnce({ session_token: SESSION_TOKEN });

    const res = await request(app, 'GET', '/guest/cards/A047');

    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toBe(SESSION_TOKEN);
  });

  it('returns only the token, never the vehicle', async () => {
    // A card code is short and guessable in a way the session token is not,
    // so this endpoint must not become a way to read someone's car details.
    queryOne.mockResolvedValueOnce({ session_token: SESSION_TOKEN });

    const res = await request(app, 'GET', '/guest/cards/A047');

    expect(Object.keys(res.body)).toEqual(['sessionToken']);
    expect(res.body.plate).toBeUndefined();
  });

  it('matches a card code case-insensitively — guests read them off plastic', async () => {
    queryOne.mockResolvedValueOnce({ session_token: SESSION_TOKEN });

    await request(app, 'GET', '/guest/cards/a047');

    expect(queryOne.mock.calls[0][1]).toEqual(['a047']);
    expect(queryOne.mock.calls[0][0]).toContain('UPPER(c.code) = UPPER($1)');
  });

  it('only ever resolves a card on an OPEN ticket', async () => {
    queryOne.mockResolvedValueOnce(null);

    await request(app, 'GET', '/guest/cards/A047');

    // A card handed to tomorrow's guest must never surface yesterday's car.
    expect(queryOne.mock.calls[0][0]).toContain("status NOT IN ('final_closed', 'expired')");
  });

  it('gives an unknown code and a free card the identical 404', async () => {
    queryOne.mockResolvedValueOnce(null);
    const unknown = await request(app, 'GET', '/guest/cards/ZZZZ');

    queryOne.mockResolvedValueOnce(null);
    const free = await request(app, 'GET', '/guest/cards/A047');

    // Probing codes must reveal neither which exist nor which are in use.
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(free.body);
  });
});
