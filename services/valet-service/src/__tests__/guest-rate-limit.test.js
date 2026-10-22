import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * The guest API's per-IP limits and CORS, through the real app in index.js.
 *
 * X-Forwarded-For stands in for nginx: with trust proxy at 1 it is the
 * client's address, and each test uses its own so buckets do not bleed.
 */

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(async () => null),
  queryRows: vi.fn(async () => []),
}));

let app;
let request;
const COMMUNITY = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  ({ default: app } = await import('../index.js'));
  ({ request } = await import('./helpers.js'));
});

// The memory store resets every key on one fixed clock that starts with the
// store, not with each client's first request. A reset can land mid-loop and
// restart the count, so each test sends up to two windows' worth and asserts
// on the first 429 rather than on request number N.
async function untilLimited(path, headers, limit) {
  const statuses = [];
  let res;
  for (let i = 0; i < limit * 2 + 1; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    res = await request(app, 'GET', typeof path === 'function' ? path(i) : path, { headers });
    statuses.push(res.status);
    if (res.status === 429) break;
  }
  return { statuses, last: res };
}

describe('guest rate limits', () => {
  it('429s card lookups past the per-minute limit', async () => {
    const { statuses } = await untilLimited(
      (i) => `/guest/cards/${COMMUNITY}/A${String(i).padStart(3, '0')}`,
      { 'X-Forwarded-For': '203.0.113.10' }, 30,
    );

    expect(statuses.at(-1)).toBe(429);
    expect(statuses.length).toBeGreaterThan(30);
    expect(statuses.slice(0, -1).every((s) => s === 404)).toBe(true);
  });

  it('keeps one client\'s exhaustion from blocking another', async () => {
    const res = await request(app, 'GET', `/guest/cards/${COMMUNITY}/A001`, {
      headers: { 'X-Forwarded-For': '203.0.113.11' },
    });

    expect(res.status).toBe(404);
  });

  it('answers the 429 as JSON the guest page can read', async () => {
    const { last } = await untilLimited('/guest/claim/ABCDEF', { 'X-Forwarded-For': '203.0.113.12' }, 240);

    expect(last.status).toBe(429);
    expect(last.body.error).toBe('rate_limited');
  });
});

describe('CORS', () => {
  it('lets the card page send its device id through the preflight', async () => {
    const res = await request(app, 'OPTIONS', `/guest/cards/${COMMUNITY}/A001`, {
      headers: { Origin: 'http://localhost:3110', 'X-Forwarded-For': '203.0.113.13' },
    });

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toMatch(/X-Valet-Device/i);
  });
});

describe('CORS when CORS_ORIGIN is unset', () => {
  let corsPolicy;
  beforeAll(async () => { ({ corsPolicy } = await import('../index.js')); });

  it('fails closed in production, and says so', () => {
    expect(corsPolicy({ NODE_ENV: 'production' })).toEqual({ allowed: [], open: false, misconfigured: true });
  });

  it('stays permissive for local development', () => {
    expect(corsPolicy({ NODE_ENV: 'development' }).open).toBe(true);
    expect(corsPolicy({}).open).toBe(true);
  });

  it('allows only the listed origins when set, as deploy-valet.sh does', () => {
    const p = corsPolicy({ NODE_ENV: 'production', CORS_ORIGIN: 'https://dwaarai.com, http://localhost:8081' });
    expect(p.open).toBe(false);
    expect(p.allowed).toEqual(['https://dwaarai.com', 'http://localhost:8081']);
  });
});
