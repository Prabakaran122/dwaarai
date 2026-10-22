import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = { query: vi.fn(), release: vi.fn() };

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
import { schedulePhotoDeletion } from '../lib/expiry.js';
import guardRoutes from '../routes/guard.js';
import {
  createApp, request, ticketRow, guardToken, adminToken,
  SESSION_TOKEN, TICKET_ID, COMMUNITY_ID, GUARD_ID,
} from './helpers.js';

const app = createApp(guardRoutes, '/guard');
const token = guardToken();
const SLOT_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.resetAllMocks();
  pool.connect.mockResolvedValue(mockClient);
  query.mockResolvedValue({ rows: [{ id: TICKET_ID }], rowCount: 1 });
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
});

const ran = () => [...query.mock.calls, ...mockClient.query.mock.calls].map((c) => String(c[0]));

// --- cancel-intake ----------------------------------------------------------

describe('POST /guard/tickets/:token/cancel-intake', () => {
  const cancel = (t = token) =>
    request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/cancel-intake`, { token: t, body: {} });

  it.each([['requested'], ['accepted'], ['parking_in_progress']])(
    'closes a %s job, freeing the card for the next guest',
    async (status) => {
      queryOne
        .mockResolvedValueOnce(ticketRow({ status }))
        .mockResolvedValueOnce(ticketRow({ status: 'expired' }));

      const res = await cancel();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'expired' });
      const update = mockClient.query.mock.calls.find((c) => /UPDATE valet_tickets/.test(c[0]));
      expect(update[0]).toMatch(/status = 'expired', closed_at = NOW\(\), slot_id = NULL/);
      // Conditional, so a valet completing it at the same moment wins.
      expect(update[0]).toMatch(/status = ANY\(\$2\)/);
      expect(update[1][1]).toEqual(['requested', 'accepted', 'parking_in_progress']);
      const event = mockClient.query.mock.calls.find((c) => /valet_ticket_events/.test(c[0]));
      expect(event[1][1]).toBe('intake_cancelled');
      expect(event[1][2]).toBe(GUARD_ID);
      expect(JSON.parse(event[1][3])).toMatchObject({ by: GUARD_ID, role: 'guard', from: status });
      expect(ran()).toContain('COMMIT');
      expect(schedulePhotoDeletion).toHaveBeenCalledWith(TICKET_ID, mockClient);
    }
  );

  it.each([['parked'], ['en_route'], ['with_guest'], ['final_closed'], ['expired']])(
    'refuses to cancel a %s ticket -- a parked car is not an intake',
    async (status) => {
      queryOne.mockResolvedValueOnce(ticketRow({ status }));

      const res = await cancel();

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'not_cancellable', status });
      expect(pool.connect).not.toHaveBeenCalled();
    }
  );

  it('answers 409 when the intake was completed on another handset meanwhile', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'parking_in_progress' }))
      .mockResolvedValueOnce({ status: 'parked' });
    mockClient.query.mockImplementation(async (sql) =>
      (/UPDATE valet_tickets/.test(sql) ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }));

    const res = await cancel();

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not_cancellable', status: 'parked' });
    expect(ran()).toContain('ROLLBACK');
    expect(ran().some((q) => /valet_ticket_events/.test(q))).toBe(false);
  });

  it('records an admin in metadata, never in the residents foreign key', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'requested' }))
      .mockResolvedValueOnce(ticketRow({ status: 'expired' }));

    const res = await cancel(adminToken({ sub: 'admin-1' }));

    expect(res.status).toBe(200);
    const event = mockClient.query.mock.calls.find((c) => /valet_ticket_events/.test(c[0]));
    expect(event[1][2]).toBeNull();
    expect(JSON.parse(event[1][3])).toMatchObject({ by: 'admin-1', role: 'community_admin' });
  });

  it('is scoped to the caller\'s community', async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await cancel();
    expect(res.status).toBe(404);
    expect(queryOne.mock.calls[0][1]).toEqual([SESSION_TOKEN, COMMUNITY_ID]);
  });
});

// --- the queue lists unfinished intakes ------------------------------------

describe('GET /guard/tickets lists unfinished intakes so they can be resumed', () => {
  it('returns intake-status tickets with their session token, desk jobs included', async () => {
    queryRows.mockResolvedValueOnce([
      ticketRow({ status: 'parking_in_progress', plate: null, created_guard_name: 'Ramesh' }),
      ticketRow({ status: 'requested', plate: null, created_by_guard_id: null, created_guard_name: null }),
    ]);

    const res = await request(app, 'GET', '/guard/tickets', { token });

    expect(res.status).toBe(200);
    expect(res.body.tickets.map((t) => t.status)).toEqual(['parking_in_progress', 'requested']);
    expect(res.body.tickets[1].sessionToken).toBe(SESSION_TOKEN);
    expect(res.body.tickets[1].createdGuardName).toBeNull();
    // LEFT JOIN: a desk-logged job has no attendant yet and must still list.
    expect(queryRows.mock.calls[0][0]).toMatch(/LEFT JOIN residents cg/);
  });

  it('finds a desk-logged ticket by token too', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'requested', created_by_guard_id: null }));
    queryRows.mockResolvedValueOnce([]);
    await request(app, 'GET', `/guard/tickets/${SESSION_TOKEN}`, { token });
    expect(queryOne.mock.calls[0][0]).toMatch(/LEFT JOIN residents cg/);
  });
});

// --- two valets, one car -----------------------------------------------------

describe('concurrent transitions', () => {
  /**
   * Simulates the database under two simultaneous taps: the conditional UPDATE
   * moves the row for whichever request reaches it first and nothing for the
   * second, exactly as Postgres does once the first commits.
   */
  function oneWinner(fromStatus, toStatus) {
    let status = fromStatus;
    queryOne.mockImplementation(async (sql) => {
      if (/SELECT status FROM valet_tickets/.test(sql)) return { status };
      return ticketRow({ status: fromStatus });   // both read it before either writes
    });
    query.mockImplementation(async (sql) => {
      if (/UPDATE valet_tickets/.test(sql)) {
        if (status !== fromStatus) return { rows: [], rowCount: 0 };
        status = toStatus;
        return { rows: [{ id: TICKET_ID }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
  }

  it('two valets tapping Accept together: one 200, one 409 status_changed', async () => {
    oneWinner('retrieval_requested', 'en_route');
    const path = `/guard/tickets/${SESSION_TOKEN}/accept`;

    const results = await Promise.all([
      request(app, 'POST', path, { token, body: { etaMinutes: 4 } }),
      request(app, 'POST', path, { token, body: { etaMinutes: 6 } }),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser.body).toEqual({ error: 'status_changed', status: 'en_route' });
    // One audit event, not two.
    const events = query.mock.calls.filter((c) => /valet_ticket_events/.test(c[0]) && c[1][1] === 'accepted');
    expect(events).toHaveLength(1);
  });

  it.each([
    ['accept-intake', 'requested', /status = 'requested'/],
    ['accept', 'retrieval_requested', /status = 'retrieval_requested'/],
    ['arrived', 'en_route', /status = 'en_route'/],
  ])('makes %s conditional on the status it checked', async (route, from, pattern) => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: from }))
      .mockResolvedValueOnce({ status: 'expired' });
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/${route}`, { token, body: {} });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'status_changed', status: 'expired' });
    expect(query.mock.calls[0][0]).toMatch(pattern);
    expect(query.mock.calls[0][0]).toMatch(/RETURNING id/);
  });

  it('confirm-pickup only closes a car still at the door', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'arrived' }))
      .mockResolvedValueOnce({ created_at: '2026-10-01T10:00:00Z' })  // arrival
      .mockResolvedValueOnce({ id: 'rt' })                             // scan
      .mockResolvedValueOnce({ id: 'cond' })                           // return capture
      .mockResolvedValueOnce({ id: 'photo' })                          // photo
      .mockResolvedValueOnce({ status: 'final_closed' });              // now
    queryRows.mockResolvedValue([]);
    query.mockImplementation(async (sql) =>
      (/UPDATE valet_tickets/.test(sql) ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/confirm-pickup`, {
      token, body: { final: true },
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'status_changed', status: 'final_closed' });
    expect(schedulePhotoDeletion).not.toHaveBeenCalled();
    const update = query.mock.calls.find((c) => /UPDATE valet_tickets/.test(c[0]));
    expect(update[0]).toMatch(/status = 'arrived'/);
  });

  it('/complete is conditional too: a second completion is refused, not overwritten', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'parking_in_progress' }))
      .mockResolvedValueOnce({ status: 'parked' });
    mockClient.query.mockImplementation(async (sql) =>
      (/UPDATE valet_tickets/.test(sql) ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }));

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/complete`, {
      token,
      body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: new Date(Date.now() + 86400000).toISOString() },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('status_changed');
    expect(ran()).toContain('ROLLBACK');
  });
});

// --- slots at /complete -------------------------------------------------------

describe('POST /guard/tickets/:token/complete with a slot', () => {
  const body = () => ({
    plate: 'KA03NJ0435', vehicleMake: 'Swift', slotId: SLOT_ID,
    stayEndAt: new Date(Date.now() + 86400000).toISOString(),
  });

  it('refuses a slot another car is standing in, with 409 slot_taken', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parking_in_progress' }));
    mockClient.query
      .mockResolvedValueOnce({})                                   // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: SLOT_ID }] })          // slot locked
      .mockResolvedValueOnce({ rows: [{ id: 'other-ticket' }] });  // occupied

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/complete`, { token, body: body() });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_taken');
    expect(ran()).toContain('ROLLBACK');
    expect(ran().some((q) => /status = 'parked'/.test(q))).toBe(false);
  });

  it('locks the slot row before looking for its occupant, scoped to this property', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'parking_in_progress' }))
      .mockResolvedValueOnce(ticketRow({ status: 'parked' }));
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: SLOT_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/complete`, { token, body: body() });

    expect(res.status).toBe(200);
    const [lockSql, lockParams] = mockClient.query.mock.calls[1];
    expect(lockSql).toMatch(/FROM valet_slots[\s\S]*FOR UPDATE/);
    expect(lockParams).toEqual([SLOT_ID, COMMUNITY_ID]);
    const [, holderParams] = mockClient.query.mock.calls[2];
    expect(holderParams[1]).toEqual(['parked', 'retrieval_requested', 'en_route', 'arrived', 'parked_again']);
    expect(holderParams[2]).toBe(TICKET_ID);
  });

  it('refuses a slot from another property', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parking_in_progress' }));
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] });                        // not ours

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/complete`, { token, body: body() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_slot');
  });

  it('turns losing the race to the one-car-per-slot index into 409, not 500', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parking_in_progress' }));
    mockClient.query.mockImplementation(async (sql) => {
      if (/FROM valet_slots/.test(sql)) return { rows: [{ id: SLOT_ID }] };
      if (/UPDATE valet_tickets/.test(sql)) {
        throw Object.assign(new Error('dup'), { code: '23505', constraint: 'idx_valet_slot_one_open_ticket' });
      }
      return { rows: [], rowCount: 1 };
    });

    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/complete`, { token, body: body() });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_taken');
  });
});
