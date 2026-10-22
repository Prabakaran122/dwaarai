import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const mockClient = { query: vi.fn(), release: vi.fn() };
vi.mock('../db.js', () => ({
  default: { connect: vi.fn(async () => mockClient) },
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../lib/face.js', () => ({ vectorize: vi.fn(), isRecognitionConfigured: vi.fn(() => true) }));
vi.mock('../lib/storage.js', () => ({
  storage: { put: vi.fn(), getStream: vi.fn(), delete: vi.fn() },
  buildKey: vi.fn(),
  extensionFor: vi.fn(),
}));

import jwt from 'jsonwebtoken';
import pool, { query, queryOne, queryRows } from '../db.js';
import { storage } from '../lib/storage.js';
import adminRoutes from '../routes/admin.js';
import { signMediaLink, signPhotoLink, verifyMediaLink } from '../lib/photo-link.js';
import { createApp, request, adminToken, guardToken, COMMUNITY_ID, SESSION_TOKEN, TICKET_ID } from './helpers.js';

const app = createApp(adminRoutes, '/admin');
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';
const MEDIA_ID = '66666666-6666-6666-6666-666666666666';
const OTHER_COMMUNITY = '77777777-7777-7777-7777-777777777777';

beforeEach(() => {
  vi.resetAllMocks();
  pool.connect.mockResolvedValue(mockClient);
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
});

// --- the desk logging an arrival -------------------------------------------

describe('POST /admin/tickets/request', () => {
  beforeEach(() => {
    mockClient.query.mockImplementation(async (sql) => {
      if (/SELECT display_id/.test(sql)) return { rows: [{ display_id: 'DWR-0041' }] };
      if (/INSERT INTO valet_tickets/.test(sql)) {
        return { rows: [{ id: TICKET_ID, display_id: 'DWR-0042', session_token: SESSION_TOKEN, claim_code: 'ABC234' }] };
      }
      return { rows: [], rowCount: 1 };
    });
  });

  it('answers 201 with no attendant on the ticket -- an admin is not a residents row', async () => {
    const res = await request(app, 'POST', '/admin/tickets/request', {
      token: adminToken({ sub: ADMIN_ID }), body: { plate: 'ka03nj0435' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: TICKET_ID, displayId: 'DWR-0042', sessionToken: SESSION_TOKEN, claimCode: 'ABC234' });
    const [sql, params] = mockClient.query.mock.calls.find((c) => /INSERT INTO valet_tickets/.test(c[0]));
    expect(sql).toMatch(/'requested', NULL/);
    expect(params).not.toContain(ADMIN_ID);
  });

  it('records who logged it on the logged_at_desk event', async () => {
    await request(app, 'POST', '/admin/tickets/request', {
      token: adminToken({ sub: ADMIN_ID }), body: { plate: 'KA03NJ0435' },
    });

    const event = mockClient.query.mock.calls.find((c) => /valet_ticket_events/.test(c[0]));
    expect(event[1][1]).toBe('logged_at_desk');
    expect(event[1][2]).toBeNull();
    expect(JSON.parse(event[1][3])).toEqual({ loggedBy: ADMIN_ID, role: 'community_admin', plate: 'KA03NJ0435' });
  });

  it('mints the display id under the per-venue advisory lock, inside one transaction', async () => {
    await request(app, 'POST', '/admin/tickets/request', { token: adminToken(), body: {} });

    const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toMatch(/pg_advisory_xact_lock\(hashtext\('valet_display_id'\), hashtext\(\$1\)\)/);
    expect(mockClient.query.mock.calls[1][1]).toEqual([COMMUNITY_ID]);
    expect(sqls.findIndex((q) => /SELECT display_id/.test(q))).toBeGreaterThan(1);
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('rolls back and releases the connection when the insert fails', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (/INSERT INTO valet_tickets/.test(sql)) throw new Error('boom');
      return { rows: [] };
    });
    const res = await request(app, 'POST', '/admin/tickets/request', { token: adminToken(), body: {} });
    expect(res.status).toBe(500);
    expect(mockClient.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('desk-logged tickets still list', () => {
  it('admin search LEFT JOINs the attendant, so a ticket with none is not dropped', async () => {
    queryRows.mockResolvedValueOnce([]);
    await request(app, 'GET', '/admin/tickets/search?plate=0435', { token: adminToken() });
    expect(queryRows.mock.calls[0][0]).toMatch(/LEFT JOIN residents cg/);
    expect(queryRows.mock.calls[0][0]).not.toMatch(/\n\s*JOIN residents cg/);
  });
});

// --- promotions --------------------------------------------------------------

describe('POST /admin/promotions/:id/redeem across properties', () => {
  const PROMO = '55555555-5555-5555-5555-555555555555';

  it('404s for another property\'s promotion and writes nothing', async () => {
    queryOne.mockResolvedValueOnce(null);   // not in this community

    const res = await request(app, 'POST', `/admin/promotions/${PROMO}/redeem`, {
      token: adminToken(), body: { code: 'VALET25-4K7QP2' },
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(queryOne.mock.calls[0][0]).toMatch(/FROM valet_promotions WHERE id = \$1 AND community_id = \$2/);
    expect(queryOne.mock.calls[0][1]).toEqual([PROMO, COMMUNITY_ID]);
    expect(queryOne.mock.calls.some((c) => /INSERT INTO valet_promotion_events/.test(c[0]))).toBe(false);
  });

  it('404s for a malformed id rather than a 500 from the uuid cast', async () => {
    const res = await request(app, 'POST', '/admin/promotions/not-a-uuid/redeem', {
      token: adminToken(), body: { code: 'VALET25-4K7QP2' },
    });
    expect(res.status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
  });
});

// --- condition media for the portal -------------------------------------------

describe('POST /admin/tickets/:token/media-links', () => {
  it('signs one short-lived link per condition record', async () => {
    queryOne.mockResolvedValueOnce({ id: TICKET_ID });
    queryRows.mockResolvedValueOnce([{ id: MEDIA_ID }, { id: 'm2' }]);

    const res = await request(app, 'POST', `/admin/tickets/${SESSION_TOKEN}/media-links`, { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(120);
    expect(Object.keys(res.body.links)).toEqual([MEDIA_ID, 'm2']);
    const url = res.body.links[MEDIA_ID];
    expect(url).toMatch(/^\/admin\/media-links\//);
    expect(verifyMediaLink(url.split('/').pop())).toEqual({ mediaId: MEDIA_ID, communityId: COMMUNITY_ID });
    expect(queryOne.mock.calls[0][1]).toEqual([SESSION_TOKEN, COMMUNITY_ID]);
  });

  it('404s for a ticket at another property', async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await request(app, 'POST', `/admin/tickets/${SESSION_TOKEN}/media-links`, { token: adminToken() });
    expect(res.status).toBe(404);
  });

  it('is admin-only', async () => {
    const res = await request(app, 'POST', `/admin/tickets/${SESSION_TOKEN}/media-links`, { token: guardToken() });
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/media-links/:sig', () => {
  it('streams the media with its real content type and no header needed', async () => {
    queryOne.mockResolvedValueOnce({ storage_key: 'valet/condition/intake/t/abc.jpg' });
    storage.getStream.mockResolvedValueOnce(Readable.from([Buffer.from('JPEGBYTES')]));

    const res = await request(app, 'GET', `/admin/media-links/${signMediaLink(MEDIA_ID, COMMUNITY_ID)}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toBe('JPEGBYTES');
    // Scoped at read time to the community the link was signed for.
    expect(queryOne.mock.calls[0][1]).toEqual([MEDIA_ID, COMMUNITY_ID]);
  });

  it('serves a video clip as video, so a <video> will play it', async () => {
    queryOne.mockResolvedValueOnce({ storage_key: 'valet/condition/return/t/abc.mp4' });
    storage.getStream.mockResolvedValueOnce(Readable.from([Buffer.from('MP4')]));
    const res = await request(app, 'GET', `/admin/media-links/${signMediaLink(MEDIA_ID, COMMUNITY_ID)}`);
    expect(res.headers['content-type']).toBe('video/mp4');
  });

  it('404s an expired link', async () => {
    const expired = jwt.sign(
      { purpose: 'admin_media', mid: MEDIA_ID, cid: COMMUNITY_ID, exp: Math.floor(Date.now() / 1000) - 10 },
      'test-only-secret'
    );
    const res = await request(app, 'GET', `/admin/media-links/${expired}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('404s a link for media at another property', async () => {
    // Signed for OTHER_COMMUNITY, but the record belongs to ours: the read-time
    // join on community finds nothing.
    queryOne.mockResolvedValueOnce(null);
    const res = await request(app, 'GET', `/admin/media-links/${signMediaLink(MEDIA_ID, OTHER_COMMUNITY)}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(queryOne.mock.calls[0][1]).toEqual([MEDIA_ID, OTHER_COMMUNITY]);
  });

  it('404s a guest-photo link or a login token replayed as a media link', async () => {
    for (const sig of [signPhotoLink(TICKET_ID, COMMUNITY_ID), adminToken()]) {
      const res = await request(app, 'GET', `/admin/media-links/${sig}`);
      expect(res.status).toBe(404);
    }
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('404s media the retention sweep has deleted since signing', async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await request(app, 'GET', `/admin/media-links/${signMediaLink(MEDIA_ID, COMMUNITY_ID)}`);
    expect(res.status).toBe(404);
    expect(queryOne.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
  });
});
