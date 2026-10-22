import { describe, it, expect, vi, beforeEach } from 'vitest';

const client = { query: vi.fn(), release: vi.fn() };
vi.mock('../db.js', () => ({
  default: { connect: vi.fn(async () => client) },
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
vi.mock('../lib/expiry.js', () => ({ schedulePhotoDeletion: vi.fn(), scheduleConditionMediaDeletion: vi.fn() }));

import pool, { query, queryOne, queryRows } from '../db.js';
import { emitTicketUpdate } from '../lib/realtime.js';
import guardRoutes from '../routes/guard.js';
import { createApp, request, ticketRow, guardToken, SESSION_TOKEN, TICKET_ID } from './helpers.js';

const app = createApp(guardRoutes, '/guard');
const token = guardToken();
const HANDED_OVER = { created_at: '2026-10-14T01:40:00Z' };
const ALL_FOUR = [{ angle: 'front' }, { angle: 'right' }, { angle: 'back' }, { angle: 'left' }];

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue({ rows: [], rowCount: 1 });
  client.query.mockResolvedValue({ rows: [], rowCount: 1 });
  pool.connect.mockResolvedValue(client);
});

/** Every statement that ran, on the pool or the transaction's client. */
const ran = () => [...query.mock.calls, ...client.query.mock.calls];

const returned = () => request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/returned`, { token });

// A multi-day guest takes the car out and brings it back. While it is out it
// is 'with_guest' -- not parked, not holding a slot -- and coming back is a
// check-in in its own right, with the same four condition views as intake:
// whatever happened to the car happened while the guest had it.
describe('POST /guard/tickets/:token/returned', () => {
  it('requires a guard', async () => {
    const res = await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/returned`);
    expect(res.status).toBe(401);
  });

  it('refuses a car that is not out with its guest', async () => {
    queryOne.mockResolvedValueOnce(ticketRow({ status: 'parked' }));

    const res = await returned();

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('wrong_status');
    expect(ran()).toHaveLength(0);
  });

  it('refuses to check the car in without all four condition sides since it went out', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'with_guest' }))
      .mockResolvedValueOnce(HANDED_OVER);
    queryRows.mockResolvedValueOnce([{ angle: 'front' }, { angle: 'right' }]);

    const res = await returned();

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('condition_required');
    expect(res.body.missing).toEqual(['back', 'left']);
    const [sql, params] = queryRows.mock.calls[0];
    expect(sql).toContain("stage = 'intake'");
    expect(sql).toContain('captured_at >= $2');
    expect(params).toEqual([TICKET_ID, HANDED_OVER.created_at]);
    expect(ran().some((c) => String(c[0]).includes('parked_again'))).toBe(false);
  });

  it('parks the car again once the set is complete, and says so live', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'with_guest', slot_id: null }))
      .mockResolvedValueOnce(HANDED_OVER)
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }));
    queryRows.mockResolvedValueOnce(ALL_FOUR);

    const res = await returned();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('parked_again');
    expect(ran()).toContainEqual([expect.stringContaining("status = 'parked_again'"), [TICKET_ID, null]]);
    expect(ran()).toContainEqual([
      expect.stringContaining('valet_ticket_events'), expect.arrayContaining(['returned_by_guest']),
    ]);
    expect(emitTicketUpdate).toHaveBeenCalled();
  });

  // The status and its audit event move together or not at all: a failed
  // event insert after a committed UPDATE once left a car checked in with no
  // record of how, behind a 500.
  it('moves the status and writes the event in one transaction', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'with_guest', slot_id: null }))
      .mockResolvedValueOnce(HANDED_OVER)
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }));
    queryRows.mockResolvedValueOnce(ALL_FOUR);

    await returned();

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.some((q) => q.includes("status = 'parked_again'"))).toBe(true);
    expect(sqls.some((q) => q.includes('valet_ticket_events'))).toBe(true);
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls the check-in back when the audit write fails', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'with_guest', slot_id: null }))
      .mockResolvedValueOnce(HANDED_OVER);
    queryRows.mockResolvedValueOnce(ALL_FOUR);
    client.query.mockImplementation(async (sql) => {
      if (String(sql).includes('valet_ticket_events')) throw new Error('check violation');
      return { rows: [], rowCount: 1 };
    });

    const res = await returned();

    expect(res.status).toBe(500);
    expect(client.query.mock.calls.map((c) => String(c[0]))).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('keeps the old slot when nobody has taken it meanwhile', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'with_guest', slot_id: 'slot-7' }))
      .mockResolvedValueOnce(HANDED_OVER)
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }));
    queryRows.mockResolvedValueOnce(ALL_FOUR);
    // Checked inside the transaction, under a lock on the slot row.
    client.query.mockImplementation(async (sql) => {
      if (/FROM valet_slots/.test(sql)) return { rows: [{ id: 'slot-7' }] };   // still ours to lock
      if (/SELECT id FROM valet_tickets/.test(sql)) return { rows: [] };      // slot still free
      return { rows: [], rowCount: 1 };
    });

    await returned();

    expect(ran()).toContainEqual([expect.stringContaining('parked_again'), [TICKET_ID, 'slot-7']]);
  });

  it('lets go of the old slot when another car is in it now', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'with_guest', slot_id: 'slot-7' }))
      .mockResolvedValueOnce(HANDED_OVER)
      .mockResolvedValueOnce(ticketRow({ status: 'parked_again' }));
    queryRows.mockResolvedValueOnce(ALL_FOUR);
    client.query.mockImplementation(async (sql) => {
      if (/FROM valet_slots/.test(sql)) return { rows: [{ id: 'slot-7' }] };
      if (/SELECT id FROM valet_tickets/.test(sql)) return { rows: [{ id: 'other-ticket' }] }; // slot taken
      return { rows: [], rowCount: 1 };
    });

    await returned();

    expect(ran()).toContainEqual([expect.stringContaining('parked_again'), [TICKET_ID, null]]);
  });

  // Conditional on still being with the guest: two valets checking the same
  // car in must not both write the event.
  it('answers 409 status_changed when another valet checked it in first', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'with_guest', slot_id: null }))
      .mockResolvedValueOnce(HANDED_OVER)
      .mockResolvedValueOnce({ status: 'parked_again' });
    queryRows.mockResolvedValueOnce(ALL_FOUR);
    client.query.mockImplementation(async (sql) =>
      (/UPDATE valet_tickets/.test(sql) ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }));

    const res = await returned();

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'status_changed', status: 'parked_again' });
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('ROLLBACK');
    expect(sqls.some((q) => q.includes('valet_ticket_events'))).toBe(false);
  });
});
