/**
 * poll-rules.test.js — poll audience targeting, creation validation,
 * one-vote-per-unit (with the 038 partial-index race backstop), and result
 * visibility (show_live_results / is_anonymous).
 *
 * Mock call-order notes:
 *
 * POST /polls (committee/admin gate runs before validation; for a non-admin
 * caller that gate itself is a queryOne round trip — resolveCaller's fresh
 * `residents.committee_role` lookup, since committee standing is never read
 * from the JWT):
 *   queryOne 1: (non-admin only) SELECT committee_role, type FROM residents (resolveCaller)
 *   queryOne 2: (only when targetBlockId given) SELECT block FROM blocks
 *   queryOne 3: INSERT INTO polls ... RETURNING *
 *   queryOne 4..N: INSERT INTO poll_options ... RETURNING * (one per option)
 *
 * POST /polls/:id/vote:
 *   queryOne 1: combined poll + voter lookup — a single LEFT JOIN query
 *     (SELECT p.*, r.type AS resident_type, u.block_id AS voter_block_id
 *      FROM polls p LEFT JOIN residents r ON r.id=$3 LEFT JOIN units u ON u.id=r.unit_id
 *      WHERE p.id=$1 AND p.community_id=$2). One call rather than two so this
 *     doesn't add a second round trip to the pre-existing vote flow.
 *   [404 here if missing]
 *   [403 here if !isEligibleVoter]
 *   [409 here if effectively closed... N/A for these tests, poll open]
 *   queryOne 2: option lookup (SELECT id FROM poll_options WHERE id=$1 AND poll_id=$2)
 *   [400 here if option doesn't belong to poll]
 *   queryOne 3: (only when poll.one_vote_per_unit) pre-check SELECT 1 FROM poll_votes
 *   [409 here if pre-check finds an existing row]
 *   queryOne 4 (or 3 if one_vote_per_unit is false): INSERT INTO poll_votes ... RETURNING
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

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
const { POLL_AUDIENCES, isEligibleVoter } = await import('../routes/polls.js');

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
  server.close();
});

beforeEach(() => {
  query.mockReset();
  queryOne.mockReset();
  queryRows.mockReset();
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

function future(days = 3) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function past(days = 3) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

// ── Tokens ──────────────────────────────────────────────────────────────────

const committeeToken = generateTestToken({
  sub: 'c1',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u1',
  name: 'RWA',
  is_committee: true,
});

const residentToken = generateTestToken({
  sub: 'r1',
  role: 'resident',
  community_id: 'c1',
  unit_id: 'u2',
  name: 'Asha',
  is_committee: false,
});

const guardToken = generateTestToken({
  sub: 'g1',
  role: 'guard',
  community_id: 'c1',
  gate_id: 'gate1',
  name: 'Guard',
});

const authC = { Authorization: `Bearer ${committeeToken}` };
const authR = { Authorization: `Bearer ${residentToken}` };
const authG = { Authorization: `Bearer ${guardToken}` };

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers: POLL_AUDIENCES / isEligibleVoter
// ─────────────────────────────────────────────────────────────────────────────

const owner = { resident_type: 'owner', unit_id: 'u1', block_id: 'b1' };
const tenant = { resident_type: 'tenant', unit_id: 'u2', block_id: 'b1' };
const other = { resident_type: 'owner', unit_id: 'u3', block_id: 'b2' };

describe('poll audiences', () => {
  it('supports exactly the audiences the BRD names', () => {
    expect(POLL_AUDIENCES).toEqual(['all', 'owners', 'block']);
  });

  it('all: everyone votes', () => {
    const poll = { audience: 'all' };
    expect(isEligibleVoter(poll, owner)).toBe(true);
    expect(isEligibleVoter(poll, tenant)).toBe(true);
  });

  it('owners: tenants are excluded', () => {
    const poll = { audience: 'owners' };
    expect(isEligibleVoter(poll, owner)).toBe(true);
    expect(isEligibleVoter(poll, tenant)).toBe(false);
  });

  it('block: only residents of the targeted block', () => {
    const poll = { audience: 'block', target_block_id: 'b1' };
    expect(isEligibleVoter(poll, owner)).toBe(true);
    expect(isEligibleVoter(poll, other)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /polls — creation validation
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /polls validation', () => {
  it('returns 401 without auth', async () => {
    const { status } = await request('POST', '/api/v1/polls', {
      body: { question: 'Q', options: ['a', 'b'], closesAt: future() },
    });
    expect(status).toBe(401);
  });

  it('returns 403 for a guard token (guards cannot create polls)', async () => {
    const { status } = await request('POST', '/api/v1/polls', {
      headers: authG,
      body: { question: 'Q', options: ['a', 'b'], closesAt: future() },
    });
    expect(status).toBe(403);
  });

  it('returns 403 for a plain resident (only committee/admin may create)', async () => {
    const { status } = await request('POST', '/api/v1/polls', {
      headers: authR,
      body: { question: 'Q', options: ['a', 'b'], closesAt: future() },
    });
    expect(status).toBe(403);
  });

  // canManagePolls now reads committee standing fresh from `residents`
  // (never from the JWT's `is_committee`), so every authC request below
  // spends queryOne call 1 on that lookup before it ever reaches
  // validation. Queue a committee row so authC clears the manage gate and
  // falls through to the validation error under test — otherwise these
  // would 403 before the validation code ever runs.
  function mockCommitteeLookup() {
    queryOne.mockResolvedValueOnce({ committee_role: 'secretary', resident_type: 'owner' });
  }

  it('rejects a single option', async () => {
    mockCommitteeLookup();
    const { status } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Q', options: ['only-one'], closesAt: future() },
    });
    expect(status).toBe(400);
    // Only the committee-standing lookup ran — no poll/option INSERT was reached.
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it('rejects seven options', async () => {
    mockCommitteeLookup();
    const { status } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Q', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], closesAt: future() },
    });
    expect(status).toBe(400);
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a past closesAt', async () => {
    mockCommitteeLookup();
    const { status } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Q', options: ['a', 'b'], closesAt: past() },
    });
    expect(status).toBe(422);
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid audience', async () => {
    mockCommitteeLookup();
    const { status } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Q', options: ['a', 'b'], closesAt: future(), audience: 'everyone' },
    });
    expect(status).toBe(400);
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a block-audience poll with no target_block_id (delta 1 — dead-poll guard)', async () => {
    mockCommitteeLookup();
    const { status } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: { question: 'Q', options: ['a', 'b'], closesAt: future(), audience: 'block' },
    });
    expect(status).toBe(422);
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid poll and persists topic/audience/one_vote_per_unit/is_anonymous/show_live_results', async () => {
    mockCommitteeLookup(); // queryOne call 1: committee-standing lookup
    queryOne
      .mockResolvedValueOnce({
        id: 'p1',
        question: 'Paint colour?',
        status: 'open',
        closes_at: future(),
        target_block_id: null,
        author_name: 'RWA',
        created_at: new Date().toISOString(),
        topic: 'Maintenance',
        audience: 'owners',
        one_vote_per_unit: false,
        is_anonymous: true,
        show_live_results: false,
      }) // queryOne call 2: INSERT polls
      .mockResolvedValueOnce({ id: 'o1', label: 'Blue', position: 0 })
      .mockResolvedValueOnce({ id: 'o2', label: 'Green', position: 1 });

    const { status, json } = await request('POST', '/api/v1/polls', {
      headers: authC,
      body: {
        topic: 'Maintenance',
        question: 'Paint colour?',
        options: ['Blue', 'Green'],
        closesAt: future(),
        audience: 'owners',
        oneVotePerUnit: false,
        isAnonymous: true,
        showLiveResults: false,
      },
    });

    expect(status).toBe(201);
    expect(json.data.audience).toBe('owners');
    expect(json.data.oneVotePerUnit).toBe(false);
    expect(json.data.isAnonymous).toBe(true);
    expect(json.data.showLiveResults).toBe(false);

    const insertSql = queryOne.mock.calls[1][0];
    const insertParams = queryOne.mock.calls[1][1];
    expect(insertSql).toMatch(/INSERT INTO polls/);
    expect(insertParams).toContain('owners');
    expect(insertParams).toContain(false); // one_vote_per_unit
    expect(insertParams).toContain(true); // is_anonymous
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /polls/:id/vote — eligibility, one-vote-per-unit, race backstop
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /polls/:id/vote', () => {
  it('returns 401 without auth', async () => {
    const { status } = await request('POST', '/api/v1/polls/p1/vote', { body: { optionId: '11111111-1111-1111-1111-111111111111' } });
    expect(status).toBe(401);
  });

  it('returns 403 for a guard token', async () => {
    const { status } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authG,
      body: { optionId: '11111111-1111-1111-1111-111111111111' },
    });
    expect(status).toBe(403);
  });

  it('returns 404 when the poll is not found', async () => {
    queryOne.mockResolvedValueOnce(null); // poll lookup
    const { status } = await request('POST', '/api/v1/polls/no-such/vote', {
      headers: authR,
      body: { optionId: '11111111-1111-1111-1111-111111111111' },
    });
    expect(status).toBe(404);
  });

  it('returns 403 when the caller is not in the eligible audience (owners-only poll, tenant voter)', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'p1', status: 'open', closes_at: future(), audience: 'owners',
      target_block_id: null, one_vote_per_unit: true,
      resident_type: 'tenant', voter_block_id: 'b1',
    }); // combined poll + voter lookup

    const { status, json } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authR,
      body: { optionId: '11111111-1111-1111-1111-111111111111' },
    });
    expect(status).toBe(403);
    expect(json.error.message).toMatch(/not open to you/i);
  });

  it('a second vote from the same unit returns 409 when one_vote_per_unit (pre-check path)', async () => {
    queryOne
      .mockResolvedValueOnce({
        id: 'p1', status: 'open', closes_at: future(), audience: 'all',
        target_block_id: null, one_vote_per_unit: true,
        resident_type: 'owner', voter_block_id: 'b1',
      }) // combined poll + voter lookup
      .mockResolvedValueOnce({ id: 'o1' }) // option belongs to poll
      .mockResolvedValueOnce({ exists: 1 }); // pre-check: unit already voted

    const { status, json } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authR,
      body: { optionId: '11111111-1111-1111-1111-111111111111' },
    });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/already voted/i);
  });

  it('a 23505 unique-violation on insert surfaces as 409, not 500 (race backstop, delta 2)', async () => {
    const dbErr = new Error('duplicate key value violates unique constraint "uniq_poll_unit_when_required"');
    dbErr.code = '23505';
    queryOne
      .mockResolvedValueOnce({
        id: 'p1', status: 'open', closes_at: future(), audience: 'all',
        target_block_id: null, one_vote_per_unit: true,
        resident_type: 'owner', voter_block_id: 'b1',
      }) // combined poll + voter lookup
      .mockResolvedValueOnce({ id: 'o1' }) // option belongs to poll
      .mockResolvedValueOnce(null) // pre-check: no row seen yet (lost the race)
      .mockRejectedValueOnce(dbErr); // INSERT poll_votes throws 23505

    const { status, json } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authR,
      body: { optionId: '11111111-1111-1111-1111-111111111111' },
    });
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/already voted/i);
  });

  it('a second vote from the same unit is allowed when one_vote_per_unit is off', async () => {
    queryOne
      .mockResolvedValueOnce({
        id: 'p1', status: 'open', closes_at: future(), audience: 'all',
        target_block_id: null, one_vote_per_unit: false,
        resident_type: 'owner', voter_block_id: 'b1',
      }) // combined poll + voter lookup
      .mockResolvedValueOnce({ id: 'o1' }) // option belongs to poll
      .mockResolvedValueOnce({ id: 'v2', poll_id: 'p1', option_id: 'o1' }); // INSERT poll_votes (no pre-check call)

    const { status, json } = await request('POST', '/api/v1/polls/p1/vote', {
      headers: authR,
      body: { optionId: '11111111-1111-1111-1111-111111111111' },
    });
    expect(status).toBe(201);
    expect(json.data.voted).toBe(true);

    // No pre-check SELECT was issued — only 3 queryOne calls total.
    expect(queryOne).toHaveBeenCalledTimes(3);
    const insertCall = queryOne.mock.calls[2];
    expect(insertCall[0]).toMatch(/INSERT INTO poll_votes/);
    // one_vote_per_unit is copied from the parent poll onto the vote row (delta 3)
    expect(insertCall[1]).toContain(false);
  });

  it('copies one_vote_per_unit=true from the parent poll onto the inserted vote row', async () => {
    queryOne
      .mockResolvedValueOnce({
        id: 'p1', status: 'open', closes_at: future(), audience: 'all',
        target_block_id: null, one_vote_per_unit: true,
        resident_type: 'owner', voter_block_id: 'b1',
      }) // combined poll + voter lookup
      .mockResolvedValueOnce({ id: 'o1' })
      .mockResolvedValueOnce(null) // pre-check: no existing vote
      .mockResolvedValueOnce({ id: 'v1' }); // INSERT

    await request('POST', '/api/v1/polls/p1/vote', { headers: authR, body: { optionId: '11111111-1111-1111-1111-111111111111' } });

    const insertCall = queryOne.mock.calls[3];
    expect(insertCall[0]).toMatch(/INSERT INTO poll_votes/);
    expect(insertCall[1]).toContain(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /polls — result visibility (show_live_results) and anonymity
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /polls result visibility', () => {
  it('show_live_results = false hides tallies while the poll is open', async () => {
    queryOne.mockResolvedValueOnce({ block_id: 'b1' }); // caller block lookup
    queryRows
      .mockResolvedValueOnce([
        {
          id: 'p1', question: 'Q', status: 'open', closes_at: future(),
          target_block_id: null, author_name: 'RWA', created_at: new Date().toISOString(),
          topic: null, audience: 'all', one_vote_per_unit: true,
          is_anonymous: false, show_live_results: false,
        },
      ]) // polls
      .mockResolvedValueOnce([
        { id: 'o1', poll_id: 'p1', label: 'Blue', position: 0, votes: 3 },
        { id: 'o2', poll_id: 'p1', label: 'Green', position: 1, votes: 1 },
      ]) // options
      .mockResolvedValueOnce([]); // myVotes

    const { status, json } = await request('GET', '/api/v1/polls', { headers: authR });
    expect(status).toBe(200);
    const poll = json.data[0];
    expect(poll.totalVotes).toBeNull();
    expect(poll.options.every((o) => o.votes === null)).toBe(true);
  });

  it('show_live_results = false reveals real tallies once the poll is closed', async () => {
    queryOne.mockResolvedValueOnce({ block_id: 'b1' });
    queryRows
      .mockResolvedValueOnce([
        {
          id: 'p1', question: 'Q', status: 'closed', closes_at: past(),
          target_block_id: null, author_name: 'RWA', created_at: new Date().toISOString(),
          topic: null, audience: 'all', one_vote_per_unit: true,
          is_anonymous: false, show_live_results: false,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'o1', poll_id: 'p1', label: 'Blue', position: 0, votes: 3 },
        { id: 'o2', poll_id: 'p1', label: 'Green', position: 1, votes: 1 },
      ])
      .mockResolvedValueOnce([]);

    const { json } = await request('GET', '/api/v1/polls', { headers: authR });
    const poll = json.data[0];
    expect(poll.totalVotes).toBe(4);
    expect(poll.options.map((o) => o.votes)).toEqual([3, 1]);
  });

  it('an anonymous poll never includes voter identity in the response, only the caller\'s own choice', async () => {
    queryOne.mockResolvedValueOnce({ block_id: 'b1' });
    queryRows
      .mockResolvedValueOnce([
        {
          id: 'p1', question: 'Q', status: 'open', closes_at: future(),
          target_block_id: null, author_name: 'RWA', created_at: new Date().toISOString(),
          topic: null, audience: 'all', one_vote_per_unit: true,
          is_anonymous: true, show_live_results: true,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'o1', poll_id: 'p1', label: 'Blue', position: 0, votes: 1 },
        { id: 'o2', poll_id: 'p1', label: 'Green', position: 1, votes: 0 },
      ])
      .mockResolvedValueOnce([{ poll_id: 'p1', option_id: 'o1' }]); // caller's own vote

    const { json } = await request('GET', '/api/v1/polls', { headers: authR });
    const poll = json.data[0];
    // The caller still sees their own choice...
    expect(poll.myOptionId).toBe('o1');
    // ...but nothing in the payload names or identifies any voter.
    const serialized = JSON.stringify(poll);
    expect(serialized).not.toMatch(/resident_id|residentId|unit_id|unitId|voterName|voter_name/i);
  });
});
