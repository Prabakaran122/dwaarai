import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn(), connect: vi.fn(), on: vi.fn() },
}));
vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn(), sendToMultiple: vi.fn().mockResolvedValue({ successCount: 0 }),
  sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn(),
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  return () => server.close();
});
beforeEach(() => {
  queryOne.mockReset(); queryRows.mockReset();
  queryOne.mockResolvedValue(null); queryRows.mockResolvedValue([]);
});

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1', name: 'Asha' });

async function get(path, token) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}

describe('committee capability is computed fresh, not read from the token', () => {
  it('reports a committee member from the database, not the JWT', async () => {
    // feed: announcements, issues, discussions, then fetchPolls' callerBlock queryOne,
    // then the `me` lookup. See community-feed.js's call-order note.
    queryOne
      .mockResolvedValueOnce({ block_id: null })
      .mockResolvedValueOnce({ committee_role: 'secretary' });
    const { status, json } = await get('/api/v1/community/feed', resident);
    expect(status).toBe(200);
    expect(json.data.me).toEqual({ isCommittee: true, committeeRole: 'Secretary' });
  });

  it('reports a plain resident as not committee', async () => {
    queryOne
      .mockResolvedValueOnce({ block_id: null })
      .mockResolvedValueOnce({ committee_role: null });
    const { json } = await get('/api/v1/community/feed', resident);
    expect(json.data.me).toEqual({ isCommittee: false, committeeRole: null });
  });

  it('still returns the deprecated grouped keys alongside me', async () => {
    queryOne.mockResolvedValueOnce({ block_id: null }).mockResolvedValueOnce(null);
    const { json } = await get('/api/v1/community/feed', resident);
    expect(json.data).toHaveProperty('announcements');
    expect(json.data).toHaveProperty('issues');
    expect(json.data).toHaveProperty('polls');
    expect(json.data).toHaveProperty('posts');
  });

  // The feed's contract is that a failing source empties one section rather
  // than 500ing the whole thing. The capability lookup must obey it too.
  it('still serves the feed when the capability lookup itself fails', async () => {
    queryOne
      .mockResolvedValueOnce({ block_id: null })
      .mockRejectedValueOnce(new Error('db gone'));
    const { status, json } = await get('/api/v1/community/feed', resident);
    expect(status).toBe(200);
    expect(json.data).toHaveProperty('posts');
    expect(json.data.me).toEqual({ isCommittee: false, committeeRole: null });
  });

  it('exposes canChangeStatus on an issue thread for a committee member', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'i1', title: 'Lift', body: 'stuck', category: 'maintenance', status: 'open', author_name: 'Asha', author_unit: 'A-704', reference: 'IQ-2026-001', assignee_name: null, resolved_at: null, created_at: new Date().toISOString() })
      .mockResolvedValueOnce({ total: 0, mine: 0 })
      .mockResolvedValueOnce({ committee_role: 'president' });
    const { json } = await get('/api/v1/issues/i1', resident);
    expect(json.data.canChangeStatus).toBe(true);
  });

  it('exposes canChangeStatus false for a plain resident', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'i1', title: 'Lift', body: 'stuck', category: 'maintenance', status: 'open', author_name: 'Asha', author_unit: 'A-704', reference: 'IQ-2026-001', assignee_name: null, resolved_at: null, created_at: new Date().toISOString() })
      .mockResolvedValueOnce({ total: 0, mine: 0 })
      .mockResolvedValueOnce({ committee_role: null });
    const { json } = await get('/api/v1/issues/i1', resident);
    expect(json.data.canChangeStatus).toBe(false);
  });
});
