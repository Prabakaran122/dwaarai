import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));

vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({ sendNotification: vi.fn().mockResolvedValue({}), sendToMultiple: vi.fn(), sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
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
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

describe('Document vault', () => {
  it('GET /documents requires a resident token (401 / 403)', async () => {
    const r1 = await request('GET', '/api/v1/documents');
    expect(r1.status).toBe(401);

    const r2 = await request('GET', '/api/v1/documents', {
      headers: { Authorization: `Bearer ${guard}` },
    });
    expect(r2.status).toBe(403);
  });

  it('GET /documents lists unit docs with correct shape', async () => {
    const now = new Date().toISOString();
    queryRows.mockResolvedValueOnce([
      {
        id: 'doc-1',
        title: 'Sale Deed',
        category: 'ownership',
        file_path: '/uploads/documents/2026-06/abc.pdf',
        mime: 'application/pdf',
        size_bytes: 12345,
        created_at: now,
      },
    ]);

    const { status, json } = await request('GET', '/api/v1/documents', {
      headers: { Authorization: `Bearer ${resident}` },
    });

    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    const doc = json.data[0];
    expect(doc.fileUrl).toBe('/uploads/documents/2026-06/abc.pdf');
    expect(doc.title).toBe('Sale Deed');
    expect(doc.category).toBe('ownership');

    // Query must be scoped to this resident's unit and community
    const callParams = queryRows.mock.calls[0][1];
    expect(callParams).toContain('u1');
    expect(callParams).toContain('c1');
  });

  it('POST /documents without a file → 400', async () => {
    // Send JSON body only (no multipart file)
    const { status, json } = await request('POST', '/api/v1/documents', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { title: 'My doc', category: 'other' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/No file uploaded/i);
  });

  it('POST /documents rejects unknown category → 400', async () => {
    // category validation fires before the file check
    const { status, json } = await request('POST', '/api/v1/documents', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { title: 'X', category: 'bogus' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toMatch(/category/i);
  });

  it('DELETE /documents/:id → 404 when doc not in caller unit', async () => {
    queryOne.mockResolvedValueOnce(null); // ownership check returns nothing

    const { status } = await request('DELETE', '/api/v1/documents/doc-999', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    expect(status).toBe(404);
  });

  it('DELETE /documents/:id → 200 { deleted: true } when found', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'doc-1' }) // ownership check
      .mockResolvedValueOnce({ id: 'doc-1' }); // soft-delete RETURNING

    const { status, json } = await request('DELETE', '/api/v1/documents/doc-1', {
      headers: { Authorization: `Bearer ${resident}` },
    });
    expect(status).toBe(200);
    expect(json.data).toEqual({ deleted: true });
  });
});
