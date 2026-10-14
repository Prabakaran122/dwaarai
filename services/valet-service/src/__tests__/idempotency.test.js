import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));

import { query, queryOne } from '../db.js';
import { idempotent } from '../lib/idempotency.js';

const COMMUNITY = '00000000-0000-0000-0000-000000000001';

function ctx({ key, body } = {}) {
  const req = {
    method: 'POST',
    originalUrl: '/guard/tickets',
    headers: key ? { 'idempotency-key': key } : {},
    user: { community_id: COMMUNITY },
    body: body ?? {},
  };
  const res = {
    statusCode: 200,
    sent: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.sent = b; return this; },
  };
  return { req, res };
}

beforeEach(() => vi.clearAllMocks());

describe('a write with no key', () => {
  it('passes straight through, so nothing existing has to change at once', async () => {
    const { req, res } = ctx();
    const next = vi.fn();

    await idempotent(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('the first request carrying a key', () => {
  it('claims the key before doing any work', async () => {
    // Claiming after would leave a window where two retries both pass the
    // check and both take the car in.
    queryOne.mockResolvedValueOnce({ key: 'k1' });   // claim won
    const { req, res } = ctx({ key: 'k1' });
    const next = vi.fn();

    await idempotent(req, res, next);

    const sql = queryOne.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO valet_idempotency_keys/i);
    expect(sql).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/i);
    expect(next).toHaveBeenCalled();
  });

  it('records what it answered, so a replay can be given the same thing', async () => {
    queryOne.mockResolvedValueOnce({ key: 'k1' });
    const { req, res } = ctx({ key: 'k1' });

    await idempotent(req, res, () => {});
    res.status(201).json({ id: 'ticket-1' });
    await new Promise((r) => setImmediate(r));

    const update = query.mock.calls.find((c) => /UPDATE valet_idempotency_keys/i.test(c[0]));
    expect(update).toBeTruthy();
    expect(update[1]).toContain(201);
  });
});

describe('a replay of a finished request', () => {
  it('returns the original answer without running the work again', async () => {
    queryOne
      .mockResolvedValueOnce(null)                                   // claim lost
      .mockResolvedValueOnce({                                       // the stored one
        route: '/guard/tickets',
        response_status: 201,
        response_body: { id: 'ticket-1', displayId: 'DWR-0018' },
        completed_at: '2026-09-28T10:00:00Z',
      });
    const { req, res } = ctx({ key: 'k1' });
    const next = vi.fn();

    await idempotent(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.sent).toEqual({ id: 'ticket-1', displayId: 'DWR-0018' });
  });

  it('refuses a key reused on a different route rather than answering with the wrong body', async () => {
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        route: '/guard/tickets/abc/accept',
        response_status: 200,
        response_body: { ok: true },
        completed_at: '2026-09-28T10:00:00Z',
      });
    const { req, res } = ctx({ key: 'k1' });

    await idempotent(req, res, () => {});

    expect(res.statusCode).toBe(422);
    expect(res.sent.error).toBe('idempotency_key_reused');
  });
});

describe('two retries racing each other', () => {
  it('tells the loser to come back rather than running the work twice', async () => {
    queryOne
      .mockResolvedValueOnce(null)                    // claim lost
      .mockResolvedValueOnce({                        // winner still in flight
        route: '/guard/tickets',
        response_status: null,
        response_body: null,
        completed_at: null,
      });
    const { req, res } = ctx({ key: 'k1' });
    const next = vi.fn();

    await idempotent(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.sent.error).toBe('idempotency_in_progress');
  });
});

describe('when the bookkeeping itself fails', () => {
  it('lets the request through rather than blocking a car over a side table', async () => {
    // An attendant with a car in front of them must not be stopped because a
    // dedupe table is unavailable. The cost of being wrong here is a possible
    // duplicate, which a human can see and fix; the cost of the alternative is
    // an intake that cannot happen at all.
    queryOne.mockRejectedValueOnce(new Error('relation does not exist'));
    const { req, res } = ctx({ key: 'k1' });
    const next = vi.fn();

    await idempotent(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
