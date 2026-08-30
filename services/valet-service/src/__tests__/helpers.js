import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-only-secret';

export const COMMUNITY_ID = '11111111-1111-1111-1111-111111111111';
export const GUARD_ID = '22222222-2222-2222-2222-222222222222';
export const TICKET_ID = '33333333-3333-3333-3333-333333333333';
export const SESSION_TOKEN = 'a'.repeat(32);

export function guardToken(overrides = {}) {
  return jwt.sign(
    { sub: GUARD_ID, role: 'guard', community_id: COMMUNITY_ID, name: 'Ramesh', ...overrides },
    JWT_SECRET
  );
}

export function adminToken(overrides = {}) {
  return jwt.sign(
    { sub: GUARD_ID, role: 'community_admin', community_id: COMMUNITY_ID, name: 'Ops', ...overrides },
    JWT_SECRET
  );
}

export function createApp(routes, mountPath = '/') {
  const app = express();
  app.use(express.json());
  app.use(mountPath, routes);
  app.use((err, _req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
    res.status(500).json({ error: 'internal_error', message: err.message });
  });
  return app;
}

/**
 * Issues one real HTTP request against an ephemeral listener.
 *
 * Deliberately not supertest: the repo's existing service tests use the same
 * raw-http approach, and adding a test dependency for one helper is not worth
 * the divergence.
 */
export function request(app, method, path, { body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const opts = {
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      };

      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });

      req.on('error', (err) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

/** A row shaped like the join that findTicket() in the routes performs. */
export function ticketRow(overrides = {}) {
  return {
    id: TICKET_ID,
    community_id: COMMUNITY_ID,
    display_id: 'SRT-0001',
    session_token: SESSION_TOKEN,
    plate: 'KA03NJ0435',
    plate_normalized: 'KA03NJ0435',
    vehicle_make: 'Maruti Swift',
    status: 'parked',
    stay_end_at: new Date(Date.now() + 86400000).toISOString(),
    created_by_guard_id: GUARD_ID,
    current_guard_id: null,
    eta_minutes: null,
    en_route_started_at: null,
    disputed: false,
    disputed_at: null,
    created_at: new Date().toISOString(),
    closed_at: null,
    community_name: 'Prestige Lakeside',
    created_guard_name: 'Ramesh',
    current_guard_name: null,
    ...overrides,
  };
}
