import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// Production-readiness fixes to /auth/*: per-identity login rate limits behind
// a trusted proxy, refresh re-signing every login claim, revoked staff refused,
// the dev master OTP behind an explicit opt-in, and no OTPs in logs.

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryRows: vi.fn(),
}));
vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({ sendNotification: vi.fn().mockResolvedValue({}), sendToMultiple: vi.fn(), sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn() }));
vi.mock('../../src/lib/msg91.js', () => ({
  isConfigured: () => false,
  sendOTP: vi.fn(),
  verifyOTP: vi.fn(),
  sendTransactionalSMS: vi.fn(),
}));
const redisStore = new Map();
const redis = {
  get: vi.fn(async (k) => redisStore.get(k) ?? null),
  set: vi.fn(async (k, v) => { redisStore.set(k, v); return 'OK'; }),
  del: vi.fn(async (k) => { redisStore.delete(k); return 1; }),
};
vi.mock('../../src/db/redis.js', () => ({ getRedisClient: () => redis }));
// A password "verifies" when the stored hash is `hash:<password>`, so a test
// can give two namesakes different (or identical) passwords.
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(async (pw, hash) => hash === `hash:${pw}`) },
}));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});
afterAll(() => server.close());
beforeEach(() => {
  queryOne.mockReset();
  queryRows.mockReset();
  redisStore.clear();
});

// Every test uses its own client IP: the limiters are module state shared by
// the whole file, and trust proxy makes X-Forwarded-For the client address.
let ipSeq = 0;
const freshIp = () => `203.0.113.${++ipSeq}`;

async function post(path, body, ip) {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

function guardRow(over = {}) {
  return {
    id: 'g1', community_id: 'c1', unit_id: null, name: 'Ravi', mobile: '9000000001',
    type: 'guard', password_hash: 'hash:pw-1', preferred_language: null,
    is_active: true, valet_until: null, community_config: {},
    community_name: 'Hotel One', gate_id: 'gate-1', gate_name: 'Porch',
    ...over,
  };
}

describe('trust proxy', () => {
  it('trusts exactly one proxy hop (nginx), not every X-Forwarded-For entry', () => {
    expect(app.get('trust proxy')).toBe(1);
  });

  it('buckets the per-IP limiter by the forwarded client IP, not nginx\'s 127.0.0.1', async () => {
    queryRows.mockResolvedValue([]);
    const sprayer = freshIp();
    // 30 different usernames from one IP: the identity buckets never fill,
    // only the per-IP one does.
    for (let i = 0; i < 30; i++) {
      const r = await post('/auth/guard-login', { username: `user${i}`, password: 'x' }, sprayer);
      expect(r.status).toBe(401);
    }
    const blocked = await post('/auth/guard-login', { username: 'user-next', password: 'x' }, sprayer);
    expect(blocked.status).toBe(429);
    expect(blocked.json).toEqual({ success: false, error: { message: 'Too many login attempts, please try again later' } });

    // Someone else behind the same nginx is unaffected.
    const other = await post('/auth/guard-login', { username: 'user0', password: 'x' }, freshIp());
    expect(other.status).toBe(401);
  });
});

describe('per-identity login limiter', () => {
  it("user A's failures do not 429 user B on the same IP", async () => {
    queryRows.mockResolvedValue([guardRow()]);
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      expect((await post('/auth/guard-login', { username: 'Ravi', password: 'wrong' }, ip)).status).toBe(401);
    }
    expect((await post('/auth/guard-login', { username: 'Ravi', password: 'wrong' }, ip)).status).toBe(429);
    // Case-folded: a different capitalisation is the same bucket.
    expect((await post('/auth/guard-login', { username: 'RAVI', password: 'wrong' }, ip)).status).toBe(429);

    queryRows.mockResolvedValue([guardRow({ id: 'g2', name: 'Suresh', password_hash: 'hash:pw-2' })]);
    const b = await post('/auth/guard-login', { username: 'Suresh', password: 'pw-2' }, ip);
    expect(b.status).toBe(200);
  });

  it('admin-login is bucketed per username too', async () => {
    queryOne.mockResolvedValue(null);
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await post('/auth/admin-login', { username: 'alice', password: 'x' }, ip);
    expect((await post('/auth/admin-login', { username: 'alice', password: 'x' }, ip)).status).toBe(429);
    expect((await post('/auth/admin-login', { username: 'bob', password: 'x' }, ip)).status).toBe(401);
  });

  it('resident OTP routes are bucketed per phone', async () => {
    queryOne.mockResolvedValue(null); // unknown phone -> generic "OTP sent"
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      expect((await post('/auth/resident-otp', { phone: '9111111111' }, ip)).status).toBe(200);
    }
    expect((await post('/auth/resident-otp', { phone: '9111111111' }, ip)).status).toBe(429);
    expect((await post('/auth/resident-otp', { phone: '9222222222' }, ip)).status).toBe(200);
  });
});

describe('guard-login with namesakes at different properties', () => {
  it('signs in the one Ravi whose password verifies', async () => {
    queryRows.mockResolvedValueOnce([
      guardRow({ id: 'g-a', community_id: 'hotel-a', password_hash: 'hash:alpha' }),
      guardRow({ id: 'g-b', community_id: 'hotel-b', mobile: '9000000002', password_hash: 'hash:bravo' }),
    ]);
    const r = await post('/auth/guard-login', { username: 'ravi', password: 'bravo' }, freshIp());
    expect(r.status).toBe(200);
    expect(claimsOf(r.json.data.token)).toMatchObject({ sub: 'g-b', community_id: 'hotel-b', role: 'guard' });
  });

  it('refuses when the password verifies for neither', async () => {
    queryRows.mockResolvedValueOnce([
      guardRow({ id: 'g-a', password_hash: 'hash:alpha' }),
      guardRow({ id: 'g-b', mobile: '9000000002', password_hash: 'hash:bravo' }),
    ]);
    const r = await post('/auth/guard-login', { username: 'ravi', password: 'charlie' }, freshIp());
    expect(r.status).toBe(401);
  });

  it('refuses and asks for the mobile number when both namesakes verify', async () => {
    queryRows.mockResolvedValueOnce([
      guardRow({ id: 'g-a', community_id: 'hotel-a', password_hash: 'hash:same' }),
      guardRow({ id: 'g-b', community_id: 'hotel-b', mobile: '9000000002', password_hash: 'hash:same' }),
    ]);
    const r = await post('/auth/guard-login', { username: 'ravi', password: 'same' }, freshIp());
    expect(r.status).toBe(401);
    expect(r.json.error.message).toMatch(/mobile number/i);
    expect(r.json.data?.token).toBeUndefined();
  });

  it('prefers an exact mobile match over a guard whose name is that string', async () => {
    queryRows.mockResolvedValueOnce([
      guardRow({ id: 'by-name', name: '9000000009', mobile: '9000000777', password_hash: 'hash:same' }),
      guardRow({ id: 'by-mobile', mobile: '9000000009', password_hash: 'hash:same' }),
    ]);
    const r = await post('/auth/guard-login', { username: '9000000009', password: 'same' }, freshIp());
    expect(r.status).toBe(200);
    expect(claimsOf(r.json.data.token).sub).toBe('by-mobile');
  });
});

describe('revoked staff at guard-login', () => {
  it('refuses an inactive guard', async () => {
    queryRows.mockResolvedValueOnce([guardRow({ is_active: false })]);
    const r = await post('/auth/guard-login', { username: 'Ravi', password: 'pw-1' }, freshIp());
    expect(r.status).toBe(401);
  });

  it('refuses a temporary driver past valet_until', async () => {
    queryRows.mockResolvedValueOnce([guardRow({ valet_until: new Date(Date.now() - 60_000).toISOString() })]);
    const r = await post('/auth/guard-login', { username: 'Ravi', password: 'pw-1' }, freshIp());
    expect(r.status).toBe(401);
  });

  it('admits a temporary driver whose valet_until is still ahead', async () => {
    queryRows.mockResolvedValueOnce([guardRow({ valet_until: new Date(Date.now() + 3_600_000).toISOString() })]);
    const r = await post('/auth/guard-login', { username: 'Ravi', password: 'pw-1' }, freshIp());
    expect(r.status).toBe(200);
  });

  it('filters expired temps in SQL as well', async () => {
    queryRows.mockResolvedValueOnce([]);
    await post('/auth/guard-login', { username: 'Ravi', password: 'pw-1' }, freshIp());
    const sql = queryRows.mock.calls[0][0];
    expect(sql).toMatch(/r\.is_active = true/);
    expect(sql).toMatch(/valet_until IS NULL OR r\.valet_until > NOW\(\)/);
  });
});

describe('/auth/refresh', () => {
  const refresh = (sub) => post('/auth/refresh', { refreshToken: generateTestToken({ sub, type: 'refresh' }, '7d') }, freshIp());

  it('keeps account_id on a client admin token, exactly as admin-login signs it', async () => {
    queryOne
      .mockResolvedValueOnce(null) // not a residents row
      .mockResolvedValueOnce({ id: 'ad1', name: 'Group Admin', role: 'client_admin', community_id: null, account_id: 'acc-1', is_active: true });
    const r = await refresh('ad1');
    expect(r.status).toBe(200);
    const claims = claimsOf(r.json.data.token);
    expect(claims).toMatchObject({ sub: 'ad1', role: 'client_admin', community_id: null, account_id: 'acc-1', name: 'Group Admin' });
    expect(queryOne.mock.calls[1][0]).toMatch(/account_id/);
  });

  it('gives a guard the same claims as guard-login (gate_id, no unit_id)', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'g1', community_id: 'c1', unit_id: null, name: 'Ravi', mobile: '9000000001',
      type: 'guard', is_active: true, valet_until: null, is_committee: false, gate_id: 'gate-1',
    });
    const r = await refresh('g1');
    expect(r.status).toBe(200);
    const claims = claimsOf(r.json.data.token);
    expect(claims).toMatchObject({ sub: 'g1', role: 'guard', community_id: 'c1', gate_id: 'gate-1', name: 'Ravi' });
    expect(claims).not.toHaveProperty('unit_id');
  });

  it('keeps is_committee on a resident token', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'r1', community_id: 'c1', unit_id: 'u1', name: 'Asha', mobile: '9', type: 'owner',
      is_active: true, valet_until: null, is_committee: true, gate_id: 'gate-1',
    });
    const r = await refresh('r1');
    expect(claimsOf(r.json.data.token)).toMatchObject({ role: 'resident', unit_id: 'u1', is_committee: true });
  });

  it('401s a deactivated staff member instead of minting a token', async () => {
    queryOne.mockResolvedValueOnce({ id: 'g1', type: 'guard', is_active: false, valet_until: null });
    const r = await refresh('g1');
    expect(r.status).toBe(401);
    expect(r.json.data?.token).toBeUndefined();
  });

  it('401s a temporary driver past valet_until', async () => {
    queryOne.mockResolvedValueOnce({
      id: 'g1', type: 'guard', is_active: true, valet_until: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await refresh('g1')).status).toBe(401);
  });

  it('401s a deactivated admin', async () => {
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ad1', name: 'A', role: 'community_admin', community_id: 'c1', account_id: null, is_active: false });
    expect((await refresh('ad1')).status).toBe(401);
  });
});

describe('dev master OTP', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['ALLOW_DEV_MASTER_OTP', 'DEV_MASTER_OTP', 'NODE_ENV']) saved[k] = process.env[k];
    process.env.DEV_MASTER_OTP = '424242';
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  const residentRow = { id: 'r1', community_id: 'c1', unit_id: 'u1', name: 'Asha', mobile: '9333333333', is_committee: false, unit_number: 'A-1' };

  it('is refused when DEV_MASTER_OTP is set but not explicitly allowed', async () => {
    delete process.env.ALLOW_DEV_MASTER_OTP;
    queryOne.mockResolvedValue(residentRow);
    const r = await post('/auth/resident-verify', { phone: '9333333333', otp: '424242' }, freshIp());
    expect(r.status).toBe(401);
  });

  it('is refused when allowed but NODE_ENV=production', async () => {
    process.env.ALLOW_DEV_MASTER_OTP = 'true';
    process.env.NODE_ENV = 'production';
    queryOne.mockResolvedValue(residentRow);
    const r = await post('/auth/resident-verify', { phone: '9333333333', otp: '424242' }, freshIp());
    expect(r.status).toBe(401);
  });

  it('is refused at register-verify unless allowed', async () => {
    delete process.env.ALLOW_DEV_MASTER_OTP;
    redisStore.set('reg:9444444444', JSON.stringify({ otp: '111111', community_id: 'c1', unit_id: 'u1' }));
    const r = await post('/auth/resident-register-verify', { phone: '9444444444', otp: '424242' }, freshIp());
    expect(r.status).toBe(401);
  });

  it('works only with ALLOW_DEV_MASTER_OTP=true outside production', async () => {
    process.env.ALLOW_DEV_MASTER_OTP = 'true';
    process.env.NODE_ENV = 'test';
    queryOne.mockResolvedValue(residentRow);
    const r = await post('/auth/resident-verify', { phone: '9333333333', otp: '424242' }, freshIp());
    expect(r.status).toBe(200);
  });
});

describe('OTP logging', () => {
  it('never logs the OTP and logs the phone only by its last four digits', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      queryOne.mockResolvedValueOnce({ id: 'r1' });
      await post('/auth/resident-otp', { phone: '9555551234' }, freshIp());

      queryOne
        .mockResolvedValueOnce({ id: 'c1', name: 'Palm Meadows' })
        .mockResolvedValueOnce({ id: 'u1', unit_number: 'A-1', block_id: null })
        .mockResolvedValueOnce(null);
      await post('/auth/resident-register', { community_code: 'PALM', phone: '9666665678', unit_number: 'A-1' }, freshIp());

      const loginOtp = redisStore.get('otp:9555551234');
      const regOtp = JSON.parse(redisStore.get('reg:9666665678')).otp;
      expect(loginOtp).toMatch(/^\d{6}$/);
      expect(regOtp).toMatch(/^\d{6}$/);

      const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
      expect(logged).not.toContain(loginOtp);
      expect(logged).not.toContain(regOtp);
      expect(logged).not.toContain('9555551234');
      expect(logged).not.toContain('9666665678');
      expect(logged).toContain('1234');
      expect(logged).toContain('5678');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
