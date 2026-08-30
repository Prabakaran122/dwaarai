import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {},
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/events.js', () => ({ logEvent: vi.fn() }));
vi.mock('../lib/storage.js', () => ({
  storage: { put: vi.fn(), getStream: vi.fn(), delete: vi.fn() },
  buildKey: vi.fn(),
  extensionFor: vi.fn(),
}));

import { query, queryRows } from '../db.js';
import { logEvent } from '../lib/events.js';
import { storage } from '../lib/storage.js';
import {
  sweepExpiredTickets,
  sweepExpiredPhotos,
  sweepExpiredConditionMedia,
  schedulePhotoDeletion,
  scheduleConditionMediaDeletion,
  runSweep,
} from '../lib/expiry.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sweepExpiredTickets', () => {
  it('closes every ticket past its stay-end and logs why', async () => {
    queryRows.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]);
    query.mockResolvedValue({});

    const count = await sweepExpiredTickets();

    expect(count).toBe(2);
    expect(logEvent).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenCalledWith('t1', 'expired', {
      metadata: { reason: 'stay_end_at passed without final checkout' },
    });
  });

  it('compares real timestamps rather than formatted strings', async () => {
    // The SQLite prototype compared an ISO string against datetime('now'),
    // which formats differently; because ' ' sorts before 'T' the comparison
    // was false for every row and the sweep silently never expired anything.
    // TIMESTAMPTZ vs NOW() makes that unrepresentable — assert we kept it.
    queryRows.mockResolvedValueOnce([]);

    await sweepExpiredTickets();

    const sql = queryRows.mock.calls[0][0];
    expect(sql).toContain('stay_end_at < NOW()');
    expect(sql).not.toContain('strftime');
  });

  it('only touches tickets that are still open', async () => {
    queryRows.mockResolvedValueOnce([]);

    await sweepExpiredTickets();

    const [, params] = queryRows.mock.calls[0];
    expect(params[0]).toEqual(['parked', 'requested', 'en_route', 'arrived', 'parked_again']);
  });

  it('does nothing and reports zero when no ticket is overdue', async () => {
    queryRows.mockResolvedValueOnce([]);

    expect(await sweepExpiredTickets()).toBe(0);
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('sweepExpiredPhotos', () => {
  it('deletes the stored bytes for each photo past its window', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'p1', storage_key: 'valet/photo/a.jpg' },
      { id: 'p2', storage_key: 'valet/photo/b.jpg' },
    ]);

    const count = await sweepExpiredPhotos();

    expect(count).toBe(2);
    expect(storage.delete).toHaveBeenCalledWith('valet/photo/a.jpg');
    expect(storage.delete).toHaveBeenCalledWith('valet/photo/b.jpg');
  });

  it('skips rows already marked deleted, so bytes are never deleted twice', async () => {
    queryRows.mockResolvedValueOnce([]);

    await sweepExpiredPhotos();

    expect(queryRows.mock.calls[0][0]).toContain('deleted_at IS NULL');
  });
});

describe('sweepExpiredConditionMedia', () => {
  it('exempts a disputed ticket from deletion', async () => {
    queryRows.mockResolvedValueOnce([]);

    await sweepExpiredConditionMedia();

    // The exemption is checked here, at deletion time, not when the retention
    // window was first scheduled — so raising a dispute after the fact still
    // protects the media.
    const sql = queryRows.mock.calls[0][0];
    expect(sql).toContain('t.disputed = FALSE');
    expect(sql).toContain('valet_tickets t');
  });

  it('deletes media for undisputed tickets past their window', async () => {
    queryRows.mockResolvedValueOnce([{ id: 'c1', storage_key: 'valet/condition/intake/x.jpg' }]);

    const count = await sweepExpiredConditionMedia();

    expect(count).toBe(1);
    expect(storage.delete).toHaveBeenCalledWith('valet/condition/intake/x.jpg');
  });
});

describe('retention scheduling', () => {
  it('stamps the window on photos that do not have one yet', async () => {
    query.mockResolvedValue({});

    await schedulePhotoDeletion('t1');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('auto_delete_after IS NULL');
    expect(params).toEqual(['t1', '24 hours']);
  });

  it('honours PHOTO_RETENTION_HOURS', async () => {
    const previous = process.env.PHOTO_RETENTION_HOURS;
    process.env.PHOTO_RETENTION_HOURS = '72';
    query.mockResolvedValue({});

    await scheduleConditionMediaDeletion('t1');

    expect(query.mock.calls[0][1][1]).toBe('72 hours');
    if (previous === undefined) delete process.env.PHOTO_RETENTION_HOURS;
    else process.env.PHOTO_RETENTION_HOURS = previous;
  });

  it('does not consult the disputed flag when scheduling', async () => {
    query.mockResolvedValue({});

    await scheduleConditionMediaDeletion('t1');

    // A dispute can be raised any time before actual deletion, so filtering
    // on it here would be wrong: it belongs in the sweep.
    expect(query.mock.calls[0][0]).not.toContain('disputed');
  });

  it('writes on the passed client so it rolls back with its transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue({}) };

    await schedulePhotoDeletion('t1', client);

    expect(client.query).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('runSweep', () => {
  it('reports what each pass did', async () => {
    queryRows
      .mockResolvedValueOnce([{ id: 't1' }])   // tickets
      .mockResolvedValueOnce([])               // photos
      .mockResolvedValueOnce([{ id: 'c1', storage_key: 'k' }]); // condition
    query.mockResolvedValue({});

    const result = await runSweep();

    expect(result).toEqual({ tickets: 1, photos: 0, condition: 1 });
  });
});
