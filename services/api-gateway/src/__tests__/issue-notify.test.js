/**
 * issue-notify.test.js — resolveNotificationTargets (pure) + the resolve
 * notification dispatch wired into PUT /issues/:id/status.
 *
 * Dispatch is strictly AFTER COMMIT: a failed/slow notification must not
 * roll back the status change, must not change the HTTP status, and must
 * not throw out of the request handler. See the "throwing notification
 * dispatch" test below — that's the entire point of this task.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { resolveNotificationTargets } from '../routes/issues.js';

describe('resolveNotificationTargets', () => {
  it('notifies the reporter and every upvoter', () => {
    expect(resolveNotificationTargets('r1', ['u1', 'u2']).sort()).toEqual(['r1', 'u1', 'u2']);
  });

  it('never notifies the same person twice', () => {
    expect(resolveNotificationTargets('r1', ['r1', 'u1']).sort()).toEqual(['r1', 'u1']);
  });

  it('copes with no upvoters', () => {
    expect(resolveNotificationTargets('r1', [])).toEqual(['r1']);
  });

  it('drops falsy ids (e.g. an issue with no author on record)', () => {
    expect(resolveNotificationTargets(null, ['u1', null])).toEqual(['u1']);
  });
});

// ── Dispatch integration tests (PUT /issues/:id/status → resolved) ─────────

vi.mock('../db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

// PUT /issues/:id/status runs its work through a pool-checked-out client
// (BEGIN / SELECT ... FOR UPDATE / UPDATE / INSERT / COMMIT), same as in
// community.test.js.
const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() };
vi.mock('../db/pool.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('../lib/fcm.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
  sendToMultiple: vi.fn().mockResolvedValue({ successCount: 0 }),
  sendVisitorAlert: vi.fn(),
  sendApprovalRequest: vi.fn(),
}));

vi.mock('../websocket.js', () => ({
  broadcast: vi.fn(),
  initWebSocket: vi.fn(),
  getIO: vi.fn(),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { query, queryOne, queryRows } = await import('../db/queries.js');
const { default: pool } = await import('../db/pool.js');
const { sendToMultiple } = await import('../lib/fcm.js');

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
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  queryOne.mockResolvedValue(null);
  queryRows.mockResolvedValue([]);
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mockClient.release.mockReset();
  pool.connect.mockReset();
  pool.connect.mockResolvedValue(mockClient);
  sendToMultiple.mockReset();
  sendToMultiple.mockResolvedValue({ successCount: 0 });
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const adminToken = generateTestToken({
  sub: 'a1',
  role: 'community_admin',
  community_id: 'c1',
  name: 'RWA',
});
const authA = { Authorization: `Bearer ${adminToken}` };

describe('PUT /issues/:id/status → resolved dispatches a resolve notification', () => {
  it('notifies the reporter and upvoters found active in the community', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'i1', status: 'in_progress', author_resident_id: 'r1', reference: 'IQ-2026-005', title: 'Broken lift' }],
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({}) // UPDATE issues
      .mockResolvedValueOnce({}) // INSERT issue_status_events
      .mockResolvedValueOnce({}); // COMMIT

    queryRows
      .mockResolvedValueOnce([{ resident_id: 'u1' }, { resident_id: 'u2' }]) // upvoters
      .mockResolvedValueOnce([
        { id: 'r1', fcm_token: 'ExponentPushToken[reporter]', resident_type: 'owner' },
        { id: 'u1', fcm_token: 'ExponentPushToken[upvoter1]', resident_type: 'owner' },
        // u2 deliberately absent from this result — e.g. moved out / inactive —
        // the targets query itself is what excludes them (is_active = true).
      ]);

    const { status } = await request('PUT', '/api/v1/issues/i1/status', {
      headers: authA,
      body: { status: 'resolved' },
    });
    expect(status).toBe(200);

    expect(sendToMultiple).toHaveBeenCalledTimes(1);
    const [tokens, , , data] = sendToMultiple.mock.calls[0];
    expect(tokens.sort()).toEqual(['ExponentPushToken[reporter]', 'ExponentPushToken[upvoter1]'].sort());
    expect(data).toMatchObject({ type: 'issue_resolved', issueId: 'i1', reference: 'IQ-2026-005' });

    // The targets query is scoped to active residents in the caller's community —
    // this is the SQL-level half of the "exclude inactive residents" filter.
    const residentsCall = queryRows.mock.calls[1];
    expect(residentsCall[0]).toMatch(/is_active = true/);
    expect(residentsCall[1][1]).toBe('c1');
  });

  it('excludes a guard from the notified targets even if they upvoted', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ id: 'i1', status: 'in_progress', author_resident_id: 'r1', reference: 'IQ-2026-006', title: 'Broken gate' }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    queryRows
      .mockResolvedValueOnce([{ resident_id: 'g1' }])
      .mockResolvedValueOnce([
        { id: 'r1', fcm_token: 'ExponentPushToken[reporter]', resident_type: 'owner' },
        { id: 'g1', fcm_token: 'ExponentPushToken[guard]', resident_type: 'guard' },
      ]);

    const { status } = await request('PUT', '/api/v1/issues/i1/status', {
      headers: authA,
      body: { status: 'resolved' },
    });
    expect(status).toBe(200);
    expect(sendToMultiple).toHaveBeenCalledTimes(1);
    const [tokens] = sendToMultiple.mock.calls[0];
    expect(tokens).toEqual(['ExponentPushToken[reporter]']);
  });

  it('does NOT dispatch on a transition that is not into resolved', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'i1', status: 'open', author_resident_id: 'r1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { status, json } = await request('PUT', '/api/v1/issues/i1/status', {
      headers: authA,
      body: { status: 'in_progress' },
    });
    expect(status).toBe(200);
    expect(json.data.status).toBe('in_progress');
    expect(sendToMultiple).not.toHaveBeenCalled();
    // No upvoters/targets lookup ever happens for a non-resolving transition.
    expect(queryRows).not.toHaveBeenCalled();
  });

  // An already-resolved issue must never notify a second time. Today the
  // forward-only guard rejects resolved -> resolved with a 422 before COMMIT,
  // so this is safe by construction — but that guarantee lives in the status
  // transition rules, not here. Asserted directly so a future change to those
  // rules cannot silently start re-notifying every upvoter on an old issue.
  it('does NOT re-notify when an already-resolved issue is resolved again', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'i1', status: 'resolved', author_resident_id: 'r1', reference: 'IQ-2026-007', title: 'Water leak' }],
      }) // SELECT ... FOR UPDATE — already resolved
      .mockResolvedValueOnce({}) // ROLLBACK
      .mockResolvedValueOnce({});

    const { status } = await request('PUT', '/api/v1/issues/i1/status', {
      headers: authA,
      body: { status: 'resolved' },
    });

    expect(status).toBe(422);
    expect(sendToMultiple).not.toHaveBeenCalled();
    expect(queryRows).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('a throwing notification dispatch still returns the normal success response, and the status stays committed', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'i1', status: 'in_progress', author_resident_id: 'r1', reference: 'IQ-2026-007', title: 'Water leak' }],
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({}) // UPDATE issues
      .mockResolvedValueOnce({}) // INSERT issue_status_events
      .mockResolvedValueOnce({}); // COMMIT

    queryRows.mockRejectedValueOnce(new Error('notification DB blew up'));

    const { status, json } = await request('PUT', '/api/v1/issues/i1/status', {
      headers: authA,
      body: { status: 'resolved' },
    });

    expect(status).toBe(200);
    expect(json.data).toEqual({ id: 'i1', status: 'resolved', from: 'in_progress' });

    // COMMIT happened and was never followed by a ROLLBACK — the notification
    // failure did not roll the status change back, and it did not throw out
    // of the request handler (the response above is proof of that).
    const calls = mockClient.query.mock.calls.map(([sql]) => sql);
    expect(calls).toContain('COMMIT');
    expect(calls).not.toContain('ROLLBACK');
  });
});
