import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));

// Recognition seam mocked; per-test control of configured/match.
vi.mock('../../src/lib/faceRecognition.js', () => ({
  isRecognitionConfigured: vi.fn(() => false),
  vectorize: vi.fn(async () => null),
  matchFace: vi.fn(async () => ({ available: false })),
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { query, queryOne, queryRows } = await import('../db/queries.js');
const { isRecognitionConfigured, matchFace } = await import('../lib/faceRecognition.js');

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  return () => server.close();
});

beforeEach(() => {
  query.mockReset(); queryOne.mockReset(); queryRows.mockReset();
  isRecognitionConfigured.mockReturnValue(false);
  matchFace.mockReset();
});

async function request(method, path, { body, headers } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'unit1', name: 'Asha' });
const device = generateTestToken({ gate_id: 'term-gate', community_id: 'c1' });

describe('Face identity & consent', () => {
  it('GET /face reports not_enrolled with a full consent map by default', async () => {
    queryOne.mockResolvedValueOnce(null);   // no enrollment
    queryRows.mockResolvedValueOnce([]);    // no consents
    const { status, json } = await request('GET', '/api/v1/face', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.status).toBe('not_enrolled');
    expect(json.data.consents).toEqual({ gate: false, pool: false, clubhouse: false, gym: false });
  });

  it('POST /face/enroll requires consent acknowledgement', async () => {
    const { status } = await request('POST', '/api/v1/face/enroll', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { consent_acknowledged: false },
    });
    expect(status).toBe(400);
  });

  it('POST /face/enroll without a recognition service stays pending', async () => {
    queryOne.mockResolvedValueOnce({ status: 'pending', enrolled_at: new Date(), activated_at: null }); // upsert returning
    const { status, json } = await request('POST', '/api/v1/face/enroll', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { consent_acknowledged: true, consent_locations: ['gate'] },
    });
    expect(status).toBe(201);
    expect(json.data.status).toBe('pending');
    expect(json.data.pending_reason).toBe('awaiting_recognition_service');
  });

  it('PUT /face/consent toggles a location', async () => {
    queryRows.mockResolvedValueOnce([{ location: 'pool', enabled: true }]);
    const { status, json } = await request('PUT', '/api/v1/face/consent', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { location: 'pool', enabled: true },
    });
    expect(status).toBe(200);
    expect(json.data.consents.pool).toBe(true);
  });

  it('DELETE /face removes the vector and disables consents', async () => {
    const { status, json } = await request('DELETE', '/api/v1/face', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.deleted).toBe(true);
    // both the enrollment update and consent disable run
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('device access GRANTS only when actively enrolled and consented for that location', async () => {
    queryOne
      .mockResolvedValueOnce({ status: 'active' })   // enrollment
      .mockResolvedValueOnce({ enabled: true });     // consent for location
    const { status, json } = await request('POST', '/api/v1/face/access', {
      headers: { 'x-device-token': device },
      body: { community_id: '00000000-0000-0000-0000-000000000000', location: 'pool', resident_id: '11111111-1111-1111-1111-111111111111', method: 'face' },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('granted');
  });

  it('device access FALLS BACK when consent for the location is off', async () => {
    queryOne
      .mockResolvedValueOnce({ status: 'active' })   // enrolled
      .mockResolvedValueOnce({ enabled: false });    // but not consented here
    const { status, json } = await request('POST', '/api/v1/face/access', {
      headers: { 'x-device-token': device },
      body: { community_id: '00000000-0000-0000-0000-000000000000', location: 'gym', resident_id: '11111111-1111-1111-1111-111111111111', method: 'face' },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('fallback');
  });

  it('device access requires a device token (not a resident JWT)', async () => {
    const { status } = await request('POST', '/api/v1/face/access', {
      headers: { Authorization: `Bearer ${resident}` },
      body: { community_id: '00000000-0000-0000-0000-000000000000', location: 'gate' },
    });
    expect(status).toBe(401);
  });

  it('GET /face/access-log returns the audit trail', async () => {
    queryRows.mockResolvedValueOnce([
      { location: 'gate', method: 'face', decision: 'granted', terminal_id: 't1', event_ts: new Date() },
    ]);
    const { status, json } = await request('GET', '/api/v1/face/access-log', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].decision).toBe('granted');
  });
});

const guard = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate1', name: 'Ramesh' });

describe('Driver facial verification', () => {
  it('requires a guard', async () => {
    const { status } = await request('POST', '/api/v1/face/verify-driver', { headers: { Authorization: `Bearer ${resident}` }, body: { unit_number: 'A-1', scan_b64: 'x' } });
    expect(status).toBe(403);
  });

  it('returns unavailable when the recognition service is off', async () => {
    queryOne.mockResolvedValueOnce({ id: 'unit1' }); // unit
    isRecognitionConfigured.mockReturnValue(false);
    const { status, json } = await request('POST', '/api/v1/face/verify-driver', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { unit_number: 'A-704', scan_b64: 'scan' },
    });
    expect(status).toBe(200);
    expect(json.data.status).toBe('unavailable');
  });

  it('returns 404 when the unit/vehicle is unknown', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/face/verify-driver', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { plate: 'KA01XX0000', scan_b64: 'scan' },
    });
    expect(status).toBe(404);
  });

  it('confirms when the driver matches an enrolled resident', async () => {
    isRecognitionConfigured.mockReturnValue(true);
    queryOne.mockResolvedValueOnce({ id: 'unit1' }); // unit
    queryRows.mockResolvedValueOnce([{ resident_id: 'r9', name: 'Priya', vector: Buffer.from('v') }]); // candidates
    matchFace.mockResolvedValueOnce({ available: true, matched: true, resident_id: 'r9', name: 'Priya', confidence: 0.93 });
    const { status, json } = await request('POST', '/api/v1/face/verify-driver', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { unit_number: 'A-704', scan_b64: 'scan' },
    });
    expect(status).toBe(200);
    expect(json.data.status).toBe('confirmed');
    expect(json.data.resident_name).toBe('Priya');
  });

  it('flags when the driver does not match', async () => {
    isRecognitionConfigured.mockReturnValue(true);
    queryOne.mockResolvedValueOnce({ id: 'unit1' });
    queryRows.mockResolvedValueOnce([{ resident_id: 'r9', name: 'Priya', vector: Buffer.from('v') }]);
    matchFace.mockResolvedValueOnce({ available: true, matched: false, confidence: 0.4 });
    const { status, json } = await request('POST', '/api/v1/face/verify-driver', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { unit_number: 'A-704', scan_b64: 'scan' },
    });
    expect(status).toBe(200);
    expect(json.data.status).toBe('flagged');
    expect(json.data.resident_name).toBeNull();
  });

  it('unavailable when no residents are enrolled', async () => {
    isRecognitionConfigured.mockReturnValue(true);
    queryOne.mockResolvedValueOnce({ id: 'unit1' });
    queryRows.mockResolvedValueOnce([]); // no candidates
    const { status, json } = await request('POST', '/api/v1/face/verify-driver', {
      headers: { Authorization: `Bearer ${guard}` },
      body: { unit_number: 'A-704', scan_b64: 'scan' },
    });
    expect(status).toBe(200);
    expect(json.data.status).toBe('unavailable');
    expect(json.data.reason).toBe('no_enrolled_residents');
  });
});
