import express from 'express';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * An express.Router that forwards async handler rejections to next().
 *
 * Express 4 does not do this itself: when an `async` handler rejects, the
 * rejection surfaces as an unhandled rejection, the error middleware is never
 * called, and no response is ever written — the request simply hangs until the
 * client times out. Every handler in this service is async and talks to
 * Postgres, so a transient database error would leave a guard's tablet
 * spinning on a dead request rather than showing a failure.
 *
 * Wrapping at the router level rather than per-handler means a new route
 * cannot forget to opt in.
 */
export function asyncRouter() {
  const router = express.Router();

  for (const method of METHODS) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) =>
      original(
        path,
        ...handlers.map((handler) => {
          // Leave error-handling middleware (arity 4) alone: re-wrapping it
          // would change its signature and Express would stop recognising it.
          if (typeof handler !== 'function' || handler.length === 4) return handler;
          return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
        })
      );
  }

  return router;
}
