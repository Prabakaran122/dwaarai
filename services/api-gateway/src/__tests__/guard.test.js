import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { query } = await import('../db/queries.js');

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  return () => server.close();
});

beforeEach(() => { query.mockReset(); });

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });
const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

describe('Guard language preference', () => {
  it('PUT /guard/language without auth returns 401', async () => {
    const { status } = await request('PUT', '/api/v1/guard/language', { body: { language: 'hi' } });
    expect(status).toBe(401);
  });

  it('rejects a non-guard role', async () => {
    const { status } = await request('PUT', '/api/v1/guard/language', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { language: 'hi' },
    });
    expect(status).toBe(403);
  });

  it('rejects an unsupported language', async () => {
    const { status, json } = await request('PUT', '/api/v1/guard/language', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { language: 'fr' },
    });
    expect(status).toBe(400);
    expect(json.error.message).toContain('en, hi, kn');
  });

  it('persists a valid language for the guard', async () => {
    const { status, json } = await request('PUT', '/api/v1/guard/language', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { language: 'kn' },
    });
    expect(status).toBe(200);
    expect(json.data.language).toBe('kn');
    expect(query).toHaveBeenCalledWith(
      'UPDATE residents SET preferred_language = $1 WHERE id = $2',
      ['kn', 'g1']
    );
  });
});
