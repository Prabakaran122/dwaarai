/**
 * Small, pure readers of server responses.
 *
 * Kept out of api/valet.ts on purpose: most suites automock that module, which
 * turns every export into a function returning undefined -- a helper living
 * there would silently answer "no" to every question in every test.
 */

type ErrLike = { response?: { status?: number; data?: { error?: string; status?: string } } };

/** The service's own error code, where there is one. */
export function errorCode(err: unknown): string | undefined {
  return (err as ErrLike)?.response?.data?.error;
}

/**
 * Another valet changed this ticket first (409 `status_changed`).
 *
 * The normal outcome of two attendants tapping the same car on a stale queue,
 * not a failure: the right response is to say so and show the fresh queue.
 */
export function isStatusChanged(err: unknown): boolean {
  const e = err as ErrLike;
  return e?.response?.status === 409 && e.response.data?.error === 'status_changed';
}

/**
 * The venue a JWT belongs to, read from its payload.
 *
 * Reads a claim, verifies nothing -- the server checks signatures. Used only to
 * keep queued photos with their own venue.
 */
export function communityOfToken(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part || typeof atob !== 'function') return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof json?.community_id === 'string' ? json.community_id : null;
  } catch {
    return null;
  }
}
