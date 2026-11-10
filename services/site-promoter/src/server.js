import http from 'node:http';
import { verifyHeader } from './sign.js';
import { buildManifest, liveSkip } from './manifest.js';
import { promote, rollback, listBackups, readLog } from './promote.js';

const MAX_BODY_BYTES = 10_000;

/**
 * Resolves with the body text, or null as soon as it passes MAX_BODY_BYTES.
 * After an overflow the data listener stays attached, so the rest of the
 * body is drained rather than the socket being destroyed before the response.
 * Rejects if the client goes away before the body is complete.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        return resolve(null);
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
    req.on('close', () => reject(new Error('client closed before the body was read')));
  });
}

/**
 * Bound to 127.0.0.1 and reached only through nginx at /_site/. Every request
 * is signed by the staging Promote page; there is no other caller.
 *
 * Promote and rollback answer 202 and carry on in the background, because
 * shared hosting stops a PHP request after ~30 s and a big promote can take
 * longer. The Promote page polls /_site/status until `running` is null.
 */
export function createServer(cfg, { fetchImpl = fetch } = {}) {
  let running = null;

  return http.createServer(async (req, res) => {
    res.on('error', () => {});
    req.on('error', () => {});

    const send = (code, obj) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };

    try {
      const p = new URL(req.url, 'http://local').pathname;

      const declared = Number(req.headers['content-length'] || 0);
      if (declared > MAX_BODY_BYTES) {
        req.resume();
        return send(413, { error: 'too_large' });
      }

      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(400, { error: 'bad_request' });
      }
      if (body === null) return send(413, { error: 'too_large' });

      if (!verifyHeader(cfg.secret, req.headers['x-site-signature'], req.method, p, body)) {
        return send(401, { error: 'bad_signature' });
      }

      if (req.method === 'GET' && p === '/_site/manifest') {
        return send(200, { files: await buildManifest(cfg.live, { skip: liveSkip }) });
      }
      if (req.method === 'GET' && p === '/_site/status') {
        return send(200, { running, log: await readLog(cfg.logFile, 20), backups: await listBackups(cfg.backups) });
      }
      if (req.method === 'POST' && (p === '/_site/promote' || p === '/_site/rollback')) {
        const kind = p.slice('/_site/'.length);

        // Validate everything before the busy check, so the same request
        // gets the same answer whether or not a job is running.
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return send(400, { error: 'bad_json' }); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          return send(400, { error: 'bad_json' });
        }
        if (kind === 'rollback' && (typeof input.backup !== 'string' || !/^\d{8}-\d{6}$/.test(input.backup))) {
          return send(400, { error: 'bad_backup' });
        }

        if (running) return send(409, { error: 'busy', running });

        const by = String(input.by || 'unknown').slice(0, 64);
        const job = kind === 'promote'
          ? () => promote({ ...cfg, by }, { fetchImpl })
          : () => rollback({ ...cfg, by, backup: input.backup });
        running = { kind, by, startedAt: new Date().toISOString() };
        // A failed job is recorded in the log; the lock is released either way.
        Promise.resolve()
          .then(job)
          .catch((e) => console.error('site-promoter job failed:', e))
          .finally(() => { running = null; });
        return send(202, { started: true });
      }
      return send(404, { error: 'not_found' });
    } catch (e) {
      console.error('site-promoter request failed:', e);
      return send(500, { error: 'internal' });
    }
  });
}
