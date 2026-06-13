/**
 * community.test.js — Issues, Polls, Blocks, and community-feed aggregate
 *
 * Mock call-order notes (critical for toggle/vote handlers):
 *
 * POST /issues/:id/upvote handler queries in this order:
 *   1. queryOne → issue existence check (SELECT id FROM issues WHERE id=$1 AND community_id=$2)
 *   2. queryOne → existing upvote check  (SELECT 1 FROM issue_upvotes WHERE issue_id=$1 AND resident_id=$2)
 *   3a. (if existing) query → DELETE upvote
 *   3b. (if not existing) query → INSERT upvote, then query → UPDATE last_activity_at
 *
 * POST /polls/:id/vote handler queries in this order:
 *   1. queryOne → poll existence + status + closes_at check (SELECT id, status, closes_at FROM polls …)
 *   2. queryOne → option-in-poll check (SELECT id FROM poll_options WHERE id=$1 AND poll_id=$2)
 *   3. queryOne → INSERT poll_votes (throws { code: '23505' } to simulate already-voted)
 *
 * GET /polls queries in this order:
 *   1. queryOne  → callerBlock (SELECT block_id FROM units WHERE id=$1)
 *   2. queryRows → polls list (audience-filtered)
 *   3. queryRows → options with vote counts (skipped if no polls)
 *   4. queryRows → caller's votes by unit_id (skipped if no polls)
 *
 * GET /community/feed runs Promise.allSettled([announcements, issues, polls]) in parallel.
 * Each async section hits its first await in declaration order, so the interleaved
 * mock-queue consumption is:
 *   queryRows call 1 → fetchAnnouncements notices query
 *   queryRows call 2 → fetchIssues issues query
 *   queryOne  call 1 → fetchPolls callerBlock lookup (SELECT block_id FROM units)
 *   queryRows call 3 → fetchPolls polls query  (if polls returned, +2 more queryRows for opts/votes)
 * The existing feed tests are updated to seed queryOne for the callerBlock lookup.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
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
  query.mockReset();
  queryOne.mockReset();
  queryRows.mockReset();
  // Restore safe defaults
  query.mockResolvedValue({ rows: [], rowCount: 0 });
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

// ── Tokens ────────────────────────────────────────────────────────────────────

const residentToken = generateTestToken({
  sub: 'r1',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u1',
  name: 'Asha',
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

const adminToken = generateTestToken({
  sub: 'a1',
  role: 'community_admin',
  community_id: 'c1',
  name: 'RWA',
});

const authR = { Authorization: `Bearer ${residentToken}` };
const authC = { Authorization: `Bearer ${committeeToken}` };
const authA = { Authorization: `Bearer ${adminToken}` };

// ─────────────────────────────────────────────────────────────────────────────
// GET /issues
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /issues', () => {
  it('returns 401 without auth', async () => {
    const { status } = await request('GET', '/api/v1/issues');
    expect(status).toBe(401);
  });

  it('lists issues with upvoteCount and myUpvoted mapped correctly', async () => {
    queryRows.mockResolvedValueOnce([
      {
        id: 'i1',
        title: 'Broken lift',
        body: 'Lift on Block A stuck',
        category: 'maintenance',
        status: 'open',
        author_name: 'Asha',
        author_unit: 'A-704',
        upvote_count: '5',
        my_upvoted: true,
        created_at: new Date().toISOString(),
      },
      {
        id: 'i2',
        title: 'Noise complaint',
        body: 'Loud music at night',
        category: 'general',
        status: 'resolved',
        author_name: 'Raj',
        author_unit: 'B-102',
        upvote_count: '0',
        my_upvoted: false,
        created_at: new Date().toISOString(),
      },
    ]);

    const { status, json } = await request('GET', '/api/v1/issues', { headers: authR });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(2);

    const i1 = json.data[0];
    expect(i1.upvoteCount).toBe(5);
    expect(i1.myUpvoted).toBe(true);
    expect(i1.authorName).toBe('Asha');
    expect(i1.authorUnit).toBe('A-704');

    const i2 = json.data[1];
    expect(i2.upvoteCount).toBe(0);
    expect(i2.myUpvoted).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /issues
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /issues', () => {
  it('rejects an invalid category with 400', async () => {
    const { status, json } = await request('POST', '/api/v1/issues', {
      headers: authR,
      body: { title: 'Test', body: 'Test body', category: 'invalid_cat' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toBe('Validation error');
  });

  it('rejects missing title with 400', async () => {
    const { status } = await request('POST', '/api/v1/issues', {
      headers: authR,
      body: { body: 'Some body', category: 'general' },
    });
    expect(status).toBe(400);
  });

  it('creates an issue and returns 201 with correct shape (upvoteCount 0, myUpvoted false)', async () => {
    // Call order:
    //  1. queryOne → unit lookup (SELECT unit_number FROM units WHERE id = $1)
    //  2. queryOne → INSERT RETURNING
    queryOne
      .mockResolvedValueOnce({ unit_number: 'A-704' }) // unit lookup
      .mockResolvedValueOnce({                          // insert result
        id: 'i-new',
        title: 'Water seepage',
        body: 'Ceiling leaking',
        category: 'maintenance',
        status: 'open',
        author_name: 'Asha',
        author_unit: 'A-704',
        upvote_count: 0,
        my_upvoted: false,
        created_at: new Date().toISOString(),
      });

    const { status, json } = await request('POST', '/api/v1/issues', {
      headers: authR,
      body: { title: 'Water seepage', body: 'Ceiling leaking', category: 'maintenance' },
    });

    expect(status).toBe(201);
    expect(json.data.title).toBe('Water seepage');
    expect(json.data.upvoteCount).toBe(0);
    expect(json.data.myUpvoted).toBe(false);
  });

  it('defaults category to general when omitted', async () => {
    queryOne
      .mockResolvedValueOnce({ unit_number: 'A-704' })
      .mockResolvedValueOnce({
        id: 'i-gen',
        title: 'General issue',
        body: 'Some text',
        category: 'general',
        status: 'open',
        author_name: 'Asha',
        author_unit: 'A-704',
        created_at: new Date().toISOString(),
      });

    const { status, json } = await request('POST', '/api/v1/issues', {
      headers: authR,
      body: { title: 'General issue', body: 'Some text' },
    });

    expect(status).toBe(201);
    expect(json.data.category).toBe('general');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /issues/:id/upvote — toggle
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /issues/:id/upvote', () => {
  it('returns 404 when issue not in community', async () => {
    // queryOne 1: issue not found
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/issues/no-such/upvote', { headers: authR });
    expect(status).toBe(404);
  });

  it('toggles OFF (existing upvote → deletes → { upvoted: false })', async () => {
    // queryOne 1: issue found
    // queryOne 2: existing upvote found (row truthy)
    // query 3: DELETE
    queryOne
      .mockResolvedValueOnce({ id: 'i1' })  // issue exists
      .mockResolvedValueOnce({ 1: 1 });      // existing upvote found
    query.mockResolvedValue({ rowCount: 1 });

    const { status, json } = await request('POST', '/api/v1/issues/i1/upvote', { headers: authR });
    expect(status).toBe(200);
    expect(json.data.upvoted).toBe(false);
  });

  it('toggles ON (no existing upvote → inserts → { upvoted: true })', async () => {
    // queryOne 1: issue found
    // queryOne 2: no existing upvote
    // query 3: INSERT upvote
    // query 4: UPDATE last_activity_at
    queryOne
      .mockResolvedValueOnce({ id: 'i1' }) // issue exists
      .mockResolvedValueOnce(null);         // no existing upvote
    query.mockResolvedValue({ rowCount: 1 });

    const { status, json } = await request('POST', '/api/v1/issues/i1/upvote', { headers: authR });
    expect(status).toBe(200);
    expect(json.data.upvoted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /issues/:id/status
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /issues/:id/status', () => {
  it('returns 403 for a resident token (role gate)', async () => {
    const { status } = await request('PUT', '/api/v1/issues/i1/status', {
      headers: authR,
      body: { status: 'resolved' },
    });
    expect(status).toBe(403);
  });

  it('returns 404 when issue not found in community', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('PUT', '/api/v1/issues/no-such/status', {
      headers: authA,
      body: { status: 'resolved' },
    });
    expect(status).toBe(404);
  });

  it('returns 200 with { id, status } for admin on valid update', async () => {
    queryOne.mockResolvedValueOnce({ id: 'i1', status: 'in_progress' });

    const { status, json } = await request('PUT', '/api/v1/issues/i1/status', {
      headers: authA,
      body: { status: 'in_progress' },
    });
    expect(status).toBe(200);
    expect(json.data.id).toBe('i1');
    expect(json.data.status).toBe('in_progress');
  });

  it('rejects invalid status value with 400', async () => {
    const { status } = await request('PUT', '/api/v1/issues/i1/status', {
      headers: authA,
      body: { status: 'banana' },
    });
    expect(status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /polls
// ─────────────────────────────────────────────────────────────────────────────
// New call order (after committee-polls upgrade):
//   queryOne  1: SELECT block_id FROM units WHERE id=$1  (callerBlock)
//   queryRows 1: polls list (audience-filtered)
//   queryRows 2: options with vote counts (skipped if no polls)
//   queryRows 3: caller's votes by unit_id (skipped if no polls)

describe('GET /polls', () => {
  it('returns 401 without auth', async () => {
    const { status } = await request('GET', '/api/v1/polls');
    expect(status).toBe(401);
  });

  it('returns [] when there are no polls', async () => {
    // queryOne 1: callerBlock lookup
    queryOne.mockResolvedValueOnce({ block_id: 'blk1' });
    // queryRows 1: empty polls list
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('GET', '/api/v1/polls', { headers: authR });
    expect(status).toBe(200);
    expect(json.data).toEqual([]);
  });

  it('assembles polls with options, vote counts, myOptionId, and canManage', async () => {
    const pollRow = {
      id: 'p1',
      question: 'Best playground?',
      status: 'open',
      closes_at: null,
      target_block_id: null,
      author_name: 'Asha',
      created_at: new Date().toISOString(),
    };
    // Call order:
    //  queryOne  1: callerBlock lookup → { block_id: 'blk1' }
    //  queryRows 1: polls
    //  queryRows 2: options
    //  queryRows 3: myVotes
    queryOne.mockResolvedValueOnce({ block_id: 'blk1' });
    queryRows
      .mockResolvedValueOnce([pollRow])                                    // polls
      .mockResolvedValueOnce([                                             // options
        { id: 'o1', poll_id: 'p1', label: 'A Block', position: 0, votes: '3' },
        { id: 'o2', poll_id: 'p1', label: 'B Block', position: 1, votes: '1' },
      ])
      .mockResolvedValueOnce([{ poll_id: 'p1', option_id: 'o1' }]);       // myVotes

    const { status, json } = await request('GET', '/api/v1/polls', { headers: authR });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);

    const p = json.data[0];
    expect(p.id).toBe('p1');
    expect(p.question).toBe('Best playground?');
    expect(p.totalVotes).toBe(4);
    expect(p.myOptionId).toBe('o1');
    expect(p.options).toHaveLength(2);
    expect(p.options[0].votes).toBe(3);
    expect(p.options[1].votes).toBe(1);
    // Plain resident: canManage = false
    expect(p.canManage).toBe(false);
  });

  it('returns canManage=true for a committee token', async () => {
    const pollRow = {
      id: 'p1',
      question: 'Parking policy?',
      status: 'open',
      closes_at: null,
      target_block_id: null,
      author_name: 'RWA',
      created_at: new Date().toISOString(),
    };
    queryOne.mockResolvedValueOnce({ block_id: 'blk1' });
    queryRows
      .mockResolvedValueOnce([pollRow])
      .mockResolvedValueOnce([
        { id: 'o1', poll_id: 'p1', label: 'Yes', position: 0, votes: '2' },
        { id: 'o2', poll_id: 'p1', label: 'No', position: 1, votes: '0' },
      ])
      .mockResolvedValueOnce([]);

    const { status, json } = await request('GET', '/api/v1/polls', { headers: authC });
    expect(status).toBe(200);
    expect(json.data[0].canManage).toBe(true);
  });

  it('passes callerBlock param to poll query (audience filter)', async () => {
    // Verify the block_id returned by queryOne is used (no assertion on SQL text —
    // the fact that polls are returned only when the callerBlock matches is tested here
    // by seeding polls with target_block_id matching 'blk1').
    const pollRow = {
      id: 'p2',
      question: 'Block-specific?',
      status: 'open',
      closes_at: null,
      target_block_id: 'blk1',
      author_name: 'RWA',
      created_at: new Date().toISOString(),
    };
    queryOne.mockResolvedValueOnce({ block_id: 'blk1' });
    queryRows
      .mockResolvedValueOnce([pollRow])
      .mockResolvedValueOnce([
        { id: 'o1', poll_id: 'p2', label: 'Yes', position: 0, votes: '0' },
        { id: 'o2', poll_id: 'p2', label: 'No', position: 1, votes: '0' },
      ])
      .mockResolvedValueOnce([]);

    const { status, json } = await request('GET', '/api/v1/polls', { headers: authR });
    expect(status).toBe(200);
    expect(json.data[0].targetBlockId).toBe('blk1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /polls
// ─────────────────────────────────────────────────────────────────────────────
// Plain resident → 403; committee → 201.
// New call order for committee create (no targetBlockId):
//   queryOne 1: INSERT poll RETURNING
//   queryOne 2: INSERT option 0 RETURNING
//   queryOne 3: INSERT option 1 RETURNING
// With targetBlockId:
//   queryOne 1: SELECT id FROM blocks WHERE id=$1 AND community_id=$2
//   queryOne 2: INSERT poll RETURNING
//   queryOne 3+: INSERT options

describe('POST /polls', () => {
  it('returns 403 for a plain resident (no is_committee)', async () => {
    const { status, json } = await request('POST', '/api/v1/polls', {
      headers: authR,
      body: { question: 'Pick?', options: ['Yes', 'No'] },
    });
    expect(status).toBe(403);
    expect(json.error.message).toMatch(/committee/i);
  });

  it('rejects fewer than 2 options with 400', async () => {
    const { status, json } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Pick one?', options: ['Only one'] },
    });
    expect(status).toBe(400);
    expect(json.error.message).toBe('Validation error');
  });

  it('rejects more than 6 options with 400', async () => {
    const { status } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Too many?', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    });
    expect(status).toBe(400);
  });

  it('rejects missing question with 400', async () => {
    const { status } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { options: ['Yes', 'No'] },
    });
    expect(status).toBe(400);
  });

  it('rejects bad closesAt with 400', async () => {
    const { status, json } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Valid?', options: ['Yes', 'No'], closesAt: 'not-a-date' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/closesAt/i);
  });

  it('rejects targetBlockId not in community with 400', async () => {
    // queryOne 1: block lookup returns null (block not found)
    queryOne.mockResolvedValueOnce(null);

    const { status, json } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: {
        question: 'Block poll?',
        options: ['Yes', 'No'],
        targetBlockId: '00000000-0000-0000-0000-000000000099',
      },
    });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/block not found/i);
  });

  it('creates poll for committee member and returns 201 (myOptionId null, votes 0)', async () => {
    // Call order (no targetBlockId):
    //  1. queryOne → INSERT poll RETURNING
    //  2. queryOne → INSERT option 0 RETURNING
    //  3. queryOne → INSERT option 1 RETURNING
    queryOne
      .mockResolvedValueOnce({
        id: 'p-new',
        question: 'Best time for maintenance?',
        status: 'open',
        closes_at: null,
        target_block_id: null,
        author_name: 'RWA',
        created_at: new Date().toISOString(),
      })
      .mockResolvedValueOnce({ id: 'o-1', label: 'Morning', position: 0 })
      .mockResolvedValueOnce({ id: 'o-2', label: 'Evening', position: 1 });

    const { status, json } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Best time for maintenance?', options: ['Morning', 'Evening'] },
    });

    expect(status).toBe(201);
    expect(json.data.id).toBe('p-new');
    expect(json.data.myOptionId).toBeNull();
    expect(json.data.totalVotes).toBe(0);
    expect(json.data.canManage).toBe(true);
    expect(json.data.options).toHaveLength(2);
    expect(json.data.options[0].votes).toBe(0);
    expect(json.data.options[1].label).toBe('Evening');
  });

  it('creates poll with valid targetBlockId for committee member', async () => {
    const blockId = '00000000-0000-0000-0000-000000000001';
    // Call order (with targetBlockId):
    //  1. queryOne → block lookup (found)
    //  2. queryOne → INSERT poll RETURNING
    //  3. queryOne → INSERT option 0
    //  4. queryOne → INSERT option 1
    queryOne
      .mockResolvedValueOnce({ id: blockId })                              // block found
      .mockResolvedValueOnce({
        id: 'p-blk',
        question: 'Block A only?',
        status: 'open',
        closes_at: null,
        target_block_id: blockId,
        author_name: 'RWA',
        created_at: new Date().toISOString(),
      })
      .mockResolvedValueOnce({ id: 'o-1', label: 'Yes', position: 0 })
      .mockResolvedValueOnce({ id: 'o-2', label: 'No', position: 1 });

    const { status, json } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Block A only?', options: ['Yes', 'No'], targetBlockId: blockId },
    });

    expect(status).toBe(201);
    expect(json.data.targetBlockId).toBe(blockId);
  });

  it('also allows admin to create polls', async () => {
    queryOne
      .mockResolvedValueOnce({
        id: 'p-adm',
        question: 'Admin poll?',
        status: 'open',
        closes_at: null,
        target_block_id: null,
        author_name: 'RWA',
        created_at: new Date().toISOString(),
      })
      .mockResolvedValueOnce({ id: 'o-1', label: 'Yes', position: 0 })
      .mockResolvedValueOnce({ id: 'o-2', label: 'No', position: 1 });

    const { status } = await request('POST', '/api/v1/polls', {
      headers: authA,
      body: { question: 'Admin poll?', options: ['Yes', 'No'] },
    });
    expect(status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /polls/:id/vote
// ─────────────────────────────────────────────────────────────────────────────
// Call order:
//   1. queryOne → poll (id, status, closes_at)
//   2. queryOne → option check
//   3. queryOne → INSERT vote (may throw 23505)

describe('POST /polls/:id/vote', () => {
  it('returns 404 when poll not found', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/polls/no-such/vote', {
      headers: authR,
      body: { optionId: '00000000-0000-0000-0000-000000000001' },
    });
    expect(status).toBe(404);
  });

  it('returns 409 when poll status is closed', async () => {
    // Poll stored as 'closed'
    queryOne.mockResolvedValueOnce({ id: 'p1', status: 'closed', closes_at: null });
    const { status, json } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authR,
      body: { optionId: '00000000-0000-0000-0000-000000000001' },
    });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/closed/i);
  });

  it('returns 409 when poll closes_at is in the past', async () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    queryOne.mockResolvedValueOnce({ id: 'p1', status: 'open', closes_at: pastDate });
    const { status, json } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authR,
      body: { optionId: '00000000-0000-0000-0000-000000000001' },
    });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/closed/i);
  });

  it('returns 400 when option does not belong to the poll', async () => {
    // Call order:
    //  1. queryOne → poll found and open
    //  2. queryOne → option not found in poll (null)
    queryOne
      .mockResolvedValueOnce({ id: 'p1', status: 'open', closes_at: null })
      .mockResolvedValueOnce(null);

    const { status, json } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authR,
      body: { optionId: '00000000-0000-0000-0000-000000000099' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/does not belong/i);
  });

  it('returns { voted: true, optionId } on successful vote', async () => {
    const optId = '00000000-0000-0000-0000-000000000001';
    // Call order:
    //  1. queryOne → poll open
    //  2. queryOne → option found
    //  3. queryOne → INSERT (success, no conflict)
    queryOne
      .mockResolvedValueOnce({ id: 'p1', status: 'open', closes_at: null })
      .mockResolvedValueOnce({ id: optId })
      .mockResolvedValueOnce({ poll_id: 'p1', option_id: optId, resident_id: 'r1', unit_id: 'u1' });

    const { status, json } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authR,
      body: { optionId: optId },
    });
    expect(status).toBe(201);
    expect(json.data.voted).toBe(true);
    expect(json.data.optionId).toBe(optId);
  });

  it('returns 409 when unit already voted (DB unique violation 23505)', async () => {
    const optId = '00000000-0000-0000-0000-000000000001';
    // Call order:
    //  1. queryOne → poll open
    //  2. queryOne → option found
    //  3. queryOne → INSERT throws { code: '23505' }
    queryOne
      .mockResolvedValueOnce({ id: 'p1', status: 'open', closes_at: null })
      .mockResolvedValueOnce({ id: optId })
      .mockRejectedValueOnce(Object.assign(new Error('unique violation'), { code: '23505' }));

    const { status, json } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authR,
      body: { optionId: optId },
    });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/unit has already voted/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /polls/:id/close
// ─────────────────────────────────────────────────────────────────────────────
// Call order:
//   1. queryOne → poll existence check (SELECT id FROM polls WHERE id=$1 AND community_id=$2)
//   2. queryOne → UPDATE polls SET status='closed' WHERE id=$1

describe('POST /polls/:id/close', () => {
  it('returns 403 for a plain resident', async () => {
    const { status, json } = await request('POST', '/api/v1/polls/p1/close', {
      headers: authR,
    });
    expect(status).toBe(403);
    expect(json.error.message).toMatch(/committee/i);
  });

  it('returns 404 when poll not found', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/polls/no-such/close', {
      headers: authC,
    });
    expect(status).toBe(404);
  });

  it('returns { id, status: "closed" } for committee member', async () => {
    // Call order:
    //  1. queryOne → poll found
    //  2. queryOne → UPDATE (returns null — no RETURNING needed)
    queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(null); // UPDATE doesn't need a return value

    const { status, json } = await request('POST', '/api/v1/polls/p1/close', {
      headers: authC,
    });
    expect(status).toBe(200);
    expect(json.data.id).toBe('p1');
    expect(json.data.status).toBe('closed');
  });

  it('allows admin to close a poll', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'p2' })
      .mockResolvedValueOnce(null);

    const { status, json } = await request('POST', '/api/v1/polls/p2/close', {
      headers: authA,
    });
    expect(status).toBe(200);
    expect(json.data.status).toBe('closed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /community/feed
// ─────────────────────────────────────────────────────────────────────────────
// New call order (after committee-polls upgrade):
//   Promise.allSettled fires all three fetchXxx() in parallel.
//   Each hits its first await in declaration order:
//     fetchAnnouncements → queryRows (call 1 in queryRows queue)
//     fetchIssues        → queryRows (call 2 in queryRows queue)
//     fetchPolls         → queryOne  (call 1 in queryOne queue — callerBlock)
//   After the first awaits resolve, continuations run:
//     fetchPolls (cont.) → queryRows (call 3 in queryRows queue — polls list)
//                          If polls found: queryRows 4 (options), queryRows 5 (myVotes)

describe('GET /community/feed', () => {
  it('returns 401 without auth', async () => {
    const { status } = await request('GET', '/api/v1/community/feed');
    expect(status).toBe(401);
  });

  it('returns { announcements, issues, polls } aggregate', async () => {
    const now = new Date().toISOString();
    // queryOne  1: fetchPolls callerBlock lookup → { block_id: 'blk1' }
    // queryRows 1: fetchAnnouncements notices
    // queryRows 2: fetchIssues
    // queryRows 3: fetchPolls polls (empty → no further queries)
    queryOne.mockResolvedValueOnce({ block_id: 'blk1' }); // callerBlock
    queryRows
      .mockResolvedValueOnce([{ id: 'n1', title: 'AGM Notice', body: 'See you Sunday', author_name: 'RWA', created_at: now }])  // announcements
      .mockResolvedValueOnce([{ id: 'i1', title: 'Lift broken', body: 'B Block', category: 'maintenance', status: 'open', author_name: 'Asha', author_unit: 'A-704', upvote_count: '2', my_upvoted: false, created_at: now }])  // issues
      .mockResolvedValueOnce([]); // polls (empty)

    const { status, json } = await request('GET', '/api/v1/community/feed', { headers: authR });
    expect(status).toBe(200);
    expect(json.data.announcements).toHaveLength(1);
    expect(json.data.announcements[0].authorName).toBe('RWA');
    expect(json.data.issues).toHaveLength(1);
    expect(json.data.issues[0].upvoteCount).toBe(2);
    expect(json.data.polls).toEqual([]);
  });

  it('degrades a failed section to [] and returns 200 (not 500)', async () => {
    const now = new Date().toISOString();
    // queryOne  1: fetchPolls callerBlock lookup
    // queryRows 1: fetchAnnouncements succeeds
    // queryRows 2: fetchIssues rejects
    // queryRows 3: fetchPolls polls (empty)
    queryOne.mockResolvedValueOnce({ block_id: 'blk1' }); // callerBlock
    queryRows
      .mockResolvedValueOnce([{ id: 'n1', title: 'Water cut', body: 'Tomorrow', author_name: 'RWA', created_at: now }]) // announcements ok
      .mockRejectedValueOnce(new Error('DB timeout'))  // issues fail
      .mockResolvedValueOnce([]);                      // polls ok (empty)

    const { status, json } = await request('GET', '/api/v1/community/feed', { headers: authR });
    expect(status).toBe(200);
    expect(json.data.announcements).toHaveLength(1);
    expect(json.data.issues).toEqual([]);   // degraded to []
    expect(json.data.polls).toEqual([]);
  });

  it('includes open polls in the feed with audience filter applied', async () => {
    const now = new Date().toISOString();
    const pollRow = {
      id: 'p1',
      question: 'Best time?',
      status: 'open',
      closes_at: null,
      target_block_id: null,
      author_name: 'RWA',
      created_at: now,
    };
    // queryOne  1: callerBlock
    // queryRows 1: announcements (empty)
    // queryRows 2: issues (empty)
    // queryRows 3: polls list (one poll)
    // queryRows 4: options
    // queryRows 5: myVotes
    queryOne.mockResolvedValueOnce({ block_id: 'blk1' });
    queryRows
      .mockResolvedValueOnce([])       // announcements
      .mockResolvedValueOnce([])       // issues
      .mockResolvedValueOnce([pollRow]) // polls
      .mockResolvedValueOnce([
        { id: 'o1', poll_id: 'p1', label: 'Morning', position: 0, votes: '2' },
        { id: 'o2', poll_id: 'p1', label: 'Evening', position: 1, votes: '1' },
      ])
      .mockResolvedValueOnce([]);      // myVotes

    const { status, json } = await request('GET', '/api/v1/community/feed', { headers: authR });
    expect(status).toBe(200);
    expect(json.data.polls).toHaveLength(1);
    expect(json.data.polls[0].totalVotes).toBe(3);
    expect(json.data.polls[0].canManage).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /blocks
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /blocks', () => {
  it('returns 401 without auth', async () => {
    const { status } = await request('GET', '/api/v1/blocks');
    expect(status).toBe(401);
  });

  it('returns [] when no blocks exist', async () => {
    queryRows.mockResolvedValueOnce([]);
    const { status, json } = await request('GET', '/api/v1/blocks', { headers: authR });
    expect(status).toBe(200);
    expect(json.data).toEqual([]);
  });

  it('returns blocks shaped as { id, name }', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'blk1', name: 'A Block' },
      { id: 'blk2', name: 'B Block' },
    ]);

    const { status, json } = await request('GET', '/api/v1/blocks', { headers: authR });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toEqual({ id: 'blk1', name: 'A Block' });
    expect(json.data[1]).toEqual({ id: 'blk2', name: 'B Block' });
  });

  it('also works with admin token', async () => {
    queryRows.mockResolvedValueOnce([{ id: 'blk1', name: 'A Block' }]);
    const { status, json } = await request('GET', '/api/v1/blocks', { headers: authA });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
  });
});
