import crypto from 'node:crypto';

/**
 * Requests between the staging Promote page and this service are signed with
 * a shared secret over the time, method, path and body. The PHP twin is
 * site_sign() in deploy/site-staging/_staging/lib.php; both are tested against
 * the same vector, so a change to one without the other fails a test.
 */
export const MAX_SKEW_S = 300;

function signature(secret, t, method, path, body) {
  return crypto.createHmac('sha256', secret).update(`${t}.${method.toUpperCase()}.${path}.${body}`).digest('hex');
}

export function signHeader(secret, method, path, body = '', now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${signature(secret, t, method, path, body)}`;
}

export function verifyHeader(secret, header, method, path, body = '', now = Date.now()) {
  if (!secret || typeof header !== 'string') return false;
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(Math.floor(now / 1000) - t) > MAX_SKEW_S) return false;
  const want = Buffer.from(signature(secret, t, method, path, body), 'hex');
  const got = Buffer.from(m[2], 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
