import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { orderFeed } from '../routes/community-feed.js';

const p = (id, type, iso) => ({ id, type, createdAt: iso });

describe('orderFeed', () => {
  it('pins the most recent announcement first regardless of age', () => {
    const out = orderFeed([
      p('i1', 'issue', '2026-08-03T10:00:00Z'),
      p('a1', 'announcement', '2026-07-01T09:00:00Z'),
      p('p1', 'poll', '2026-08-02T09:00:00Z'),
    ]);
    expect(out[0].id).toBe('a1');
  });

  it('orders everything after the pin reverse-chronologically', () => {
    const out = orderFeed([
      p('i1', 'issue', '2026-08-01T10:00:00Z'),
      p('a1', 'announcement', '2026-07-01T09:00:00Z'),
      p('p1', 'poll', '2026-08-02T09:00:00Z'),
    ]);
    expect(out.map((x) => x.id)).toEqual(['a1', 'p1', 'i1']);
  });

  it('pins only the newest announcement, leaving older ones in place', () => {
    const out = orderFeed([
      p('a_old', 'announcement', '2026-06-01T09:00:00Z'),
      p('a_new', 'announcement', '2026-07-01T09:00:00Z'),
      p('i1', 'issue', '2026-08-01T10:00:00Z'),
    ]);
    expect(out[0].id).toBe('a_new');
    expect(out.map((x) => x.id)).toEqual(['a_new', 'i1', 'a_old']);
  });

  it('handles an empty feed and a feed with no announcements', () => {
    expect(orderFeed([])).toEqual([]);
    const out = orderFeed([p('i1', 'issue', '2026-08-01T10:00:00Z')]);
    expect(out.map((x) => x.id)).toEqual(['i1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /community/feed — route-level tests for the new `posts` shape.
//
// Mock call order (unchanged from the pre-existing handler, see community.test.js
// for the authoritative note): Promise.allSettled fires fetchAnnouncements,
// fetchIssues, fetchPolls in parallel; each hits its first await in declaration
// order, so queryRows call 1 = announcements, queryRows call 2 = issues,
// queryOne call 1 = fetchPolls callerBlock lookup, then queryRows call 3 = polls
// list (plus 2 more queryRows if polls are non-empty).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: vi.fn(), on: vi.fn() },
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
const { queryOne, queryRows } = await import('../db/queries.js');

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

beforeEach(() => {
  queryOne.mockReset();
  queryRows.mockReset();
  queryOne.mockResolvedValue(null);
  queryRows.mockResolvedValue([]);
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const residentToken = generateTestToken({
  sub: 'r1',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u1',
  name: 'Asha',
});
const authR = { Authorization: `Bearer ${residentToken}` };

describe('GET /community/feed — unified posts shape (additive)', () => {
  it('returns posts AND the legacy grouped keys, with the newest announcement pinned first', async () => {
    const older = '2026-07-01T09:00:00Z';
    const newest = '2026-08-01T09:00:00Z';
    const middle = '2026-07-15T09:00:00Z';

    queryOne.mockResolvedValueOnce({ block_id: 'blk1' }); // fetchPolls callerBlock
    queryRows
      .mockResolvedValueOnce([{ id: 'n1', title: 'AGM Notice', body: 'See you Sunday', author_name: 'RWA', created_at: newest }]) // announcements
      .mockResolvedValueOnce([{ id: 'i1', title: 'Lift broken', body: 'B Block', category: 'maintenance', status: 'open', author_name: 'Asha', author_unit: 'A-704', upvote_count: '2', my_upvoted: false, created_at: older }]) // issues
      .mockResolvedValueOnce([{ id: 'p1', question: 'Best time?', status: 'open', closes_at: null, target_block_id: null, author_name: 'RWA', created_at: middle }]) // polls
      .mockResolvedValueOnce([{ id: 'o1', poll_id: 'p1', label: 'Morning', position: 0, votes: '1' }]) // options
      .mockResolvedValueOnce([]); // myVotes

    const { status, json } = await request('GET', '/api/v1/community/feed', { headers: authR });
    expect(status).toBe(200);

    // Legacy grouped keys unchanged — same shape/values the Basera app consumes today.
    expect(json.data.announcements).toHaveLength(1);
    expect(json.data.announcements[0]).toEqual({ id: 'n1', title: 'AGM Notice', body: 'See you Sunday', authorName: 'RWA', createdAt: newest });
    expect(json.data.issues).toHaveLength(1);
    expect(json.data.issues[0].upvoteCount).toBe(2);
    expect(json.data.polls).toHaveLength(1);
    expect(json.data.polls[0].totalVotes).toBe(1);

    // New unified posts array, additive.
    expect(json.data.posts).toHaveLength(3);
    expect(json.data.posts[0]).toMatchObject({ id: 'n1', type: 'announcement' });
    // After the pin, reverse-chronological: poll (middle) then issue (older).
    expect(json.data.posts[1]).toMatchObject({ id: 'p1', type: 'poll' });
    expect(json.data.posts[2]).toMatchObject({ id: 'i1', type: 'issue' });
  });

  it('filters posts by ?type= after ordering, without touching the legacy keys', async () => {
    const now = '2026-08-01T09:00:00Z';
    queryOne.mockResolvedValueOnce({ block_id: 'blk1' });
    queryRows
      .mockResolvedValueOnce([{ id: 'n1', title: 'AGM Notice', body: 'x', author_name: 'RWA', created_at: now }])
      .mockResolvedValueOnce([{ id: 'i1', title: 'Lift broken', body: 'x', category: 'maintenance', status: 'open', author_name: 'Asha', author_unit: 'A-704', upvote_count: '0', my_upvoted: false, created_at: now }])
      .mockResolvedValueOnce([]); // polls empty

    const { status, json } = await request('GET', '/api/v1/community/feed?type=issue', { headers: authR });
    expect(status).toBe(200);
    expect(json.data.posts).toHaveLength(1);
    expect(json.data.posts[0].type).toBe('issue');
    // Legacy keys are unfiltered regardless of ?type=.
    expect(json.data.announcements).toHaveLength(1);
  });

  it('rejects an unknown ?type= with 400 and does not hit the database', async () => {
    const { status, json } = await request('GET', '/api/v1/community/feed?type=bogus', { headers: authR });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/type/i);
    expect(queryRows).not.toHaveBeenCalled();
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('degrades a failed section to [] in both posts and the legacy key (Promise.allSettled preserved)', async () => {
    const now = '2026-08-01T09:00:00Z';
    queryOne.mockResolvedValueOnce({ block_id: 'blk1' });
    queryRows
      .mockResolvedValueOnce([{ id: 'n1', title: 'Water cut', body: 'Tomorrow', author_name: 'RWA', created_at: now }]) // announcements ok
      .mockRejectedValueOnce(new Error('DB timeout')) // issues fail
      .mockResolvedValueOnce([]); // polls ok (empty)

    const { status, json } = await request('GET', '/api/v1/community/feed', { headers: authR });
    expect(status).toBe(200);
    expect(json.data.issues).toEqual([]);
    expect(json.data.posts.every((post) => post.id !== undefined)).toBe(true);
    expect(json.data.posts).toHaveLength(1);
    expect(json.data.posts[0].id).toBe('n1');
  });

  it('returns 401 without auth', async () => {
    const { status } = await request('GET', '/api/v1/community/feed');
    expect(status).toBe(401);
  });
});
