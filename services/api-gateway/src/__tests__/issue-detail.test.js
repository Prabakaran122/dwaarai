/**
 * issue-detail.test.js — GET /issues/:id, POST /issues/:id/replies, POST /issues/:id/photos
 *
 * Mock call-order notes:
 *
 * GET /issues/:id:
 *   queryOne  1: issue lookup (SELECT ... FROM issues WHERE id=$1 AND community_id=$2 AND is_removed=false)
 *   [404 return here if not found]
 *   queryRows 1: photos
 *   queryRows 2: timeline (issue_status_events)
 *   queryRows 3: replies
 *   queryOne  2: upvote counts (total, mine)
 *
 * POST /issues/:id/replies:
 *   queryOne 1: issue lookup, scoped to community + not removed
 *   [404 return here if missing]
 *   queryOne 2: actor (residents) lookup
 *   [404 return here if missing]
 *   queryOne 3: INSERT issue_replies ... RETURNING
 *   query    1: UPDATE issues SET last_activity_at = NOW()
 *
 * POST /issues/:id/photos (transaction via pool.connect()):
 *   client.query 1: BEGIN
 *   client.query 2: SELECT issue FOR UPDATE (existence + community scope + not removed)
 *   [404 + unlink + ROLLBACK if missing]
 *   client.query 3: SELECT committee_role FROM residents (actor)
 *   [403 + unlink + ROLLBACK if caller is neither author nor committee]
 *   client.query 4: SELECT COUNT(*) FROM issue_photos (existing count, same locked transaction)
 *   [422 + unlink + ROLLBACK if files.length > remaining slots]
 *   client.query 5..N: INSERT issue_photos ... RETURNING (one per file)
 *   client.query N+1: UPDATE issues SET last_activity_at = NOW()
 *   client.query N+2: COMMIT
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// UPLOAD_BASE in issues.js is read from process.env.UPLOAD_DIR at module load
// time, so this must be set before ../index.js (and therefore ../routes/issues.js)
// is imported below.
const uploadDir = mkdtempSync(path.join(tmpdir(), 'cg-issue-photos-'));
process.env.UPLOAD_DIR = uploadDir;

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() };
vi.mock('../../src/db/pool.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
  sendToMultiple: vi.fn().mockResolvedValue({ successCount: 0 }),
  sendVisitorAlert: vi.fn(),
  sendApprovalRequest: vi.fn(),
}));

vi.mock('../../src/websocket.js', () => ({
  broadcast: vi.fn(),
  initWebSocket: vi.fn(),
  getIO: vi.fn(),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { query, queryOne, queryRows } = await import('../db/queries.js');
const { default: pool } = await import('../db/pool.js');
const { MAX_ISSUE_PHOTOS, remainingPhotoSlots } = await import('../routes/issues.js');

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  return () => server.close();
});

afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  query.mockReset();
  queryOne.mockReset();
  queryRows.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  queryOne.mockResolvedValue(null);
  queryRows.mockResolvedValue([]);
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mockClient.release.mockReset();
  pool.connect.mockReset();
  pool.connect.mockResolvedValue(mockClient);
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function monthDir() {
  const month = new Date().toISOString().slice(0, 7);
  return path.join(uploadDir, 'issues', month);
}

function listUploadedFiles() {
  try {
    return new Set(readdirSync(monthDir()));
  } catch {
    return new Set();
  }
}

// ── Tokens ────────────────────────────────────────────────────────────────────

const residentToken = generateTestToken({
  sub: 'r1',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u1',
  name: 'Asha',
  is_committee: false,
});

// A resident who is neither the issue's author nor a committee member.
const otherResidentToken = generateTestToken({
  sub: 'r2',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u2',
  name: 'Ravi',
  is_committee: false,
});

const committeeToken = generateTestToken({
  sub: 'c1',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u1',
  name: 'RWA',
  is_committee: true,
});

const guardToken = generateTestToken({
  sub: 'g1',
  role: 'guard',
  community_id: 'c1',
  gate_id: 'gate1',
  name: 'Guard',
});

const authR = { Authorization: `Bearer ${residentToken}` };
const authR2 = { Authorization: `Bearer ${otherResidentToken}` };
const authC = { Authorization: `Bearer ${committeeToken}` };
const authG = { Authorization: `Bearer ${guardToken}` };

// ─────────────────────────────────────────────────────────────────────────────
// Pure helper: photo cap
// ─────────────────────────────────────────────────────────────────────────────

describe('photo cap', () => {
  it('caps an issue at five photos, per the BRD', () => {
    expect(MAX_ISSUE_PHOTOS).toBe(5);
  });

  it('reports how many more may be uploaded', () => {
    expect(remainingPhotoSlots(0)).toBe(5);
    expect(remainingPhotoSlots(3)).toBe(2);
    expect(remainingPhotoSlots(5)).toBe(0);
    expect(remainingPhotoSlots(7)).toBe(0); // never negative
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /issues/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /issues/:id', () => {
  it('returns 401 without auth', async () => {
    const { status } = await request('GET', '/api/v1/issues/i1');
    expect(status).toBe(401);
  });

  it('returns 403 for a guard token (guards are read-only-feed, no detail access)', async () => {
    const { status } = await request('GET', '/api/v1/issues/i1', { headers: authG });
    expect(status).toBe(403);
  });

  it('returns 404 when the issue is not found (removed or other community)', async () => {
    queryOne.mockResolvedValueOnce(null); // issue lookup
    const { status } = await request('GET', '/api/v1/issues/no-such', { headers: authR });
    expect(status).toBe(404);
  });

  it('returns issue, photos, timeline, replies, upvoteCount, myUpvoted; includes reference; excludes is_removed', async () => {
    const now = new Date().toISOString();
    queryOne
      .mockResolvedValueOnce({
        id: 'i1',
        title: 'Broken lift',
        body: 'Lift on Block A stuck',
        category: 'maintenance',
        status: 'open',
        author_name: 'Asha',
        author_unit: 'A-704',
        reference: 'IQ-2026-001',
        assignee_name: null,
        resolved_at: null,
        created_at: now,
      }) // issue lookup
      .mockResolvedValueOnce({ total: 3, mine: 1 }); // upvote counts
    queryRows
      .mockResolvedValueOnce([
        { id: 'ph1', path: '/uploads/issues/2026-08/a.jpg', position: 0 },
      ]) // photos
      .mockResolvedValueOnce([
        {
          from_status: null,
          to_status: 'open',
          changed_by_name: 'Asha',
          changed_by_role: null,
          kind: 'status_change',
          detail: 'Issue reported',
          created_at: now,
        },
      ]) // timeline
      .mockResolvedValueOnce([
        {
          id: 'rep1',
          author_name: 'RWA',
          author_unit: 'A-101',
          author_role: 'Secretary',
          body: 'On it',
          is_official: true,
          created_at: now,
        },
      ]); // replies

    const { status, json } = await request('GET', '/api/v1/issues/i1', { headers: authR });
    expect(status).toBe(200);

    expect(json.data.issue.reference).toBe('IQ-2026-001');
    expect(json.data.issue.assigneeName).toBeNull();
    expect(json.data.issue.resolvedAt).toBeNull();
    expect(json.data.issue.is_removed).toBeUndefined();
    expect(json.data.issue.author_resident_id).toBeUndefined();

    expect(json.data.photos).toHaveLength(1);
    expect(json.data.timeline).toHaveLength(1);
    expect(json.data.replies).toHaveLength(1);
    expect(json.data.upvoteCount).toBe(3);
    expect(json.data.myUpvoted).toBe(true);

    // Timeline is ordered by created_at at the SQL level.
    const timelineSql = queryRows.mock.calls[1][0];
    expect(timelineSql).toMatch(/ORDER BY created_at/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /issues/:id/replies
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /issues/:id/replies', () => {
  it('returns 401 without auth', async () => {
    const { status } = await request('POST', '/api/v1/issues/i1/replies', { body: { body: 'hi' } });
    expect(status).toBe(401);
  });

  it('rejects an empty body with 400', async () => {
    const { status } = await request('POST', '/api/v1/issues/i1/replies', {
      headers: authR,
      body: { body: '' },
    });
    expect(status).toBe(400);
  });

  it('returns 404 when the issue is removed or belongs to another community', async () => {
    queryOne.mockResolvedValueOnce(null); // issue lookup fails
    const { status } = await request('POST', '/api/v1/issues/i1/replies', {
      headers: authR,
      body: { body: 'Same problem here' },
    });
    expect(status).toBe(404);
  });

  it('returns 404 when the caller has no active residents row', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'i1' }) // issue lookup ok
      .mockResolvedValueOnce(null); // actor lookup fails
    const { status } = await request('POST', '/api/v1/issues/i1/replies', {
      headers: authR,
      body: { body: 'Same problem here' },
    });
    expect(status).toBe(404);
  });

  it('a plain owner reply is is_official=false and author_role is NULL, not empty string', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'i1' }) // issue lookup
      .mockResolvedValueOnce({ id: 'r1', name: 'Asha', committee_role: null, unit: 'A-704' }) // actor
      .mockResolvedValueOnce({
        id: 'rep1',
        author_name: 'Asha',
        author_unit: 'A-704',
        author_role: null,
        body: 'Same problem here',
        is_official: false,
        created_at: new Date().toISOString(),
      }); // INSERT ... RETURNING

    const { status, json } = await request('POST', '/api/v1/issues/i1/replies', {
      headers: authR,
      body: { body: 'Same problem here' },
    });
    expect(status).toBe(201);
    expect(json.data.is_official).toBe(false);
    expect(json.data.author_role).toBeNull();

    const insertCall = queryOne.mock.calls[2];
    expect(insertCall[0]).toMatch(/INSERT INTO issue_replies/);
    // (issue_id, community_id, author_resident_id, author_name, author_unit, author_role, body, is_official)
    expect(insertCall[1][5]).toBeNull(); // roleLabel('') || null, never ''
    expect(insertCall[1][7]).toBe(false);
  });

  it('a committee reply is is_official=true with a capitalised role', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'i1' }) // issue lookup
      .mockResolvedValueOnce({ id: 'c1', name: 'RWA', committee_role: 'secretary', unit: 'A-101' }) // actor
      .mockResolvedValueOnce({
        id: 'rep2',
        author_name: 'RWA',
        author_unit: 'A-101',
        author_role: 'Secretary',
        body: 'Handled',
        is_official: true,
        created_at: new Date().toISOString(),
      });

    const { status, json } = await request('POST', '/api/v1/issues/i1/replies', {
      headers: authC,
      body: { body: 'Handled' },
    });
    expect(status).toBe(201);
    expect(json.data.is_official).toBe(true);

    const insertCall = queryOne.mock.calls[2];
    expect(insertCall[1][5]).toBe('Secretary');
    expect(insertCall[1][7]).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /issues/:id/photos
// ─────────────────────────────────────────────────────────────────────────────

function photoForm(count, prefix = 'p') {
  const form = new FormData();
  for (let i = 0; i < count; i++) {
    form.append('photos', new Blob([Buffer.from(`fake-jpg-${prefix}-${i}`)], { type: 'image/jpeg' }), `${prefix}${i}.jpg`);
  }
  return form;
}

describe('POST /issues/:id/photos', () => {
  it('returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/api/v1/issues/i1/photos`, { method: 'POST', body: photoForm(1) });
    expect(res.status).toBe(401);
  });

  it('returns 404 (and unlinks received files) when the issue is not found', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // issue lookup FOR UPDATE — not found
      .mockResolvedValueOnce({}); // ROLLBACK

    const before = listUploadedFiles();
    const res = await fetch(`${baseUrl}/api/v1/issues/no-such/photos`, {
      method: 'POST',
      headers: authR,
      body: photoForm(1, 'nf'),
    });
    expect(res.status).toBe(404);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    const after = listUploadedFiles();
    expect([...after].filter((f) => !before.has(f))).toHaveLength(0);
  });

  it('returns 403 (and unlinks received files) for a non-author, non-committee resident', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'i1', author_resident_id: 'r1' }] }) // issue FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ committee_role: null }] }) // actor (r2), not committee
      .mockResolvedValueOnce({}); // ROLLBACK

    const before = listUploadedFiles();
    const res = await fetch(`${baseUrl}/api/v1/issues/i1/photos`, {
      method: 'POST',
      headers: authR2,
      body: photoForm(1, 'forbidden'),
    });
    expect(res.status).toBe(403);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    const after = listUploadedFiles();
    expect([...after].filter((f) => !before.has(f))).toHaveLength(0);
  });

  it('returns 422 (and unlinks all received files) when the upload exceeds remaining slots', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'i1', author_resident_id: 'r1' }] }) // issue FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ committee_role: null }] }) // actor (r1, author)
      .mockResolvedValueOnce({ rows: [{ n: 3 }] }) // existing count: 3, so 2 slots left
      .mockResolvedValueOnce({}); // ROLLBACK

    const before = listUploadedFiles();
    const res = await fetch(`${baseUrl}/api/v1/issues/i1/photos`, {
      method: 'POST',
      headers: authR,
      body: photoForm(3, 'overcap'),
    });
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.error.message).toMatch(/2 more photo/i);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');

    const after = listUploadedFiles();
    expect([...after].filter((f) => !before.has(f))).toHaveLength(0);
  });

  it('accepts an upload within the cap, inserts rows in one transaction, and leaves the files on disk', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'i1', author_resident_id: 'r1' }] }) // issue FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ committee_role: null }] }) // actor (r1, author)
      .mockResolvedValueOnce({ rows: [{ n: 0 }] }) // existing count: 0
      .mockResolvedValueOnce({ rows: [{ id: 'ph1', path: '/uploads/issues/x/x1.jpg', position: 0 }] }) // insert 1
      .mockResolvedValueOnce({ rows: [{ id: 'ph2', path: '/uploads/issues/x/x2.jpg', position: 1 }] }) // insert 2
      .mockResolvedValueOnce({}) // UPDATE last_activity_at
      .mockResolvedValueOnce({}); // COMMIT

    const before = listUploadedFiles();
    const res = await fetch(`${baseUrl}/api/v1/issues/i1/photos`, {
      method: 'POST',
      headers: authR,
      body: photoForm(2, 'ok'),
    });
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.data).toHaveLength(2);
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.query).not.toHaveBeenCalledWith('ROLLBACK');

    const after = listUploadedFiles();
    expect([...after].filter((f) => !before.has(f))).toHaveLength(2);
  });

  it('returns 500 (and unlinks all received files) when a query throws mid-transaction', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'i1', author_resident_id: 'r1' }] }) // issue FOR UPDATE
      .mockRejectedValueOnce(new Error('DB error')) // actor lookup blows up
      .mockResolvedValueOnce({}); // ROLLBACK

    const before = listUploadedFiles();
    const res = await fetch(`${baseUrl}/api/v1/issues/i1/photos`, {
      method: 'POST',
      headers: authR,
      body: photoForm(1, 'err'),
    });
    expect(res.status).toBe(500);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');

    const after = listUploadedFiles();
    expect([...after].filter((f) => !before.has(f))).toHaveLength(0);
  });
});
