import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));

import pool from '../db.js';
import { authenticateJWT, clearStaffCache } from '../middleware/auth.js';
import { asyncRouter } from '../lib/async-router.js';
import { createApp, request, guardToken, adminToken, GUARD_ID } from './helpers.js';

const router = asyncRouter();
router.get('/ping', authenticateJWT(['guard', 'admin']), (_req, res) => res.json({ ok: true }));
const app = createApp(router, '/');

beforeEach(() => {
  vi.clearAllMocks();
  pool.query.mockReset();
  clearStaffCache();
});

describe('a staff token whose owner has been let go', () => {
  it('lets an active valet through', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ is_active: true, valet_until: null }] });
    const res = await request(app, 'GET', '/ping', { token: guardToken() });
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][1]).toEqual([GUARD_ID]);
  });

  it('refuses a deactivated valet straight away, not an hour later', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ is_active: false, valet_until: null }] });
    const res = await request(app, 'GET', '/ping', { token: guardToken() });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('staff_inactive');
  });

  it('refuses a temporary driver whose valet_until has passed', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ is_active: true, valet_until: new Date(Date.now() - 60_000).toISOString() }],
    });
    const res = await request(app, 'GET', '/ping', { token: guardToken() });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('staff_inactive');
  });

  it('lets a temporary driver work until their date', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ is_active: true, valet_until: new Date(Date.now() + 3600_000).toISOString() }],
    });
    const res = await request(app, 'GET', '/ping', { token: guardToken() });
    expect(res.status).toBe(200);
  });

  it('refuses a token naming nobody on staff', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app, 'GET', '/ping', { token: guardToken() });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('staff_inactive');
  });

  it('caches the answer briefly instead of querying on every poll', async () => {
    pool.query.mockResolvedValue({ rows: [{ is_active: true, valet_until: null }] });
    await request(app, 'GET', '/ping', { token: guardToken() });
    await request(app, 'GET', '/ping', { token: guardToken() });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('does not lock every attendant out when the lookup itself fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app, 'GET', '/ping', { token: guardToken() });
    expect(res.status).toBe(200);
  });

  it('does not check an admin token against residents -- admins are not residents', async () => {
    const res = await request(app, 'GET', '/ping', { token: adminToken() });
    expect(res.status).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
