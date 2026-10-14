import { query, queryOne } from '../db.js';

/**
 * Makes a retried write safe to send twice.
 *
 * The app is gaining an offline outbox, and a queue without this is worse than
 * no queue: an intake whose reply is lost on a flaky reconnect gets replayed,
 * and the same car is taken in twice under two display ids with one card bound
 * to a ticket nobody is watching.
 *
 * The client generates a UUID per operation and sends it as `Idempotency-Key`.
 * The first request carrying it does the work and records the answer; later
 * requests carrying the same key are handed that answer back.
 *
 * Opt-in by header, so nothing that exists today has to change at once. A
 * request with no key behaves exactly as it always did.
 */

/** Long enough for a real UUID, short enough that nobody can store an essay. */
const MAX_KEY = 64;

export async function idempotent(req, res, next) {
  const key = String(req.headers['idempotency-key'] ?? '').trim();
  if (!key || key.length > MAX_KEY) return next();

  const communityId = req.user?.community_id;
  if (!communityId) return next();

  const route = String(req.originalUrl || req.url || '').split('?')[0].slice(0, 120);

  let claimed;
  try {
    // Claim BEFORE the work, not after. Claiming afterwards leaves a window in
    // which two retries both pass the check and both take the car in. The
    // INSERT is atomic, so exactly one caller can win it.
    claimed = await queryOne(
      `INSERT INTO valet_idempotency_keys (key, community_id, route)
       VALUES ($1, $2, $3)
       ON CONFLICT (community_id, key) DO NOTHING
       RETURNING key`,
      [key, communityId, route]
    );
  } catch {
    // An attendant with a car in front of them must not be stopped because a
    // dedupe table is unavailable. Being wrong here risks a duplicate a human
    // can see and fix; the alternative is an intake that cannot happen at all.
    return next();
  }

  if (claimed) {
    captureResponse(res, key, communityId);
    return next();
  }

  // Somebody else holds this key. Either they finished -- in which case their
  // answer is ours -- or they are still running.
  let existing;
  try {
    existing = await queryOne(
      `SELECT route, response_status, response_body, completed_at
         FROM valet_idempotency_keys
        WHERE community_id = $1 AND key = $2`,
      [communityId, key]
    );
  } catch {
    return next();
  }

  // Vanishingly unlikely: claimed by someone and swept between the two reads.
  if (!existing) return next();

  // A key reused against a different route is a client bug. Answering with the
  // first route's body would be a silent wrong answer instead of a loud one.
  if (existing.route !== route) {
    return res.status(422).json({
      error: 'idempotency_key_reused',
      message: 'This idempotency key was already used for a different request',
    });
  }

  if (!existing.completed_at) {
    // The original is still in flight. 409 rather than blocking: the caller is
    // an outbox that will come back, and holding the connection open would tie
    // up a worker behind a request we cannot see the end of.
    return res.status(409).json({
      error: 'idempotency_in_progress',
      message: 'An identical request is still being processed',
    });
  }

  return res.status(existing.response_status ?? 200).json(existing.response_body ?? {});
}

/**
 * Records the answer once the route has produced one.
 *
 * Wraps res.json rather than using an 'finish' listener because the body is
 * the thing worth keeping, and by 'finish' it has already been serialised away.
 */
function captureResponse(res, key, communityId) {
  const realJson = res.json.bind(res);

  res.json = (body) => {
    const out = realJson(body);
    // After the reply is on its way. A slow side-table write must not add
    // latency to the attendant's tap.
    // Wrapped in Promise.resolve: this runs INSIDE res.json, so anything that
    // throws here breaks the reply the attendant is waiting for. A query layer
    // that returns a non-promise, or throws synchronously, must not be able to
    // do that.
    void Promise.resolve()
      .then(() => query(
        `UPDATE valet_idempotency_keys
            SET response_status = $3, response_body = $4, completed_at = NOW()
          WHERE community_id = $1 AND key = $2`,
        [communityId, key, res.statusCode, JSON.stringify(body ?? null)]
      ))
      .catch(() => {
        // Nothing useful to do. The cost is that a later replay re-runs the
        // work, which is the behaviour we had before any of this existed.
      });
    return out;
  };
}

/**
 * Drops keys old enough that no client could still be retrying them.
 *
 * Called from the scheduled sweep alongside the media retention passes.
 */
export async function sweepIdempotencyKeys() {
  const hours = Number(process.env.IDEMPOTENCY_RETENTION_HOURS || 48);
  const res = await query(
    `DELETE FROM valet_idempotency_keys WHERE created_at < NOW() - ($1 || ' hours')::interval`,
    [String(hours)]
  );
  return res?.rowCount ?? 0;
}
