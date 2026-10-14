import http from 'http';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import guardRoutes from './routes/guard.js';
import guestRoutes from './routes/guest.js';
import webhookRoutes from './routes/webhooks.js';
import adminRoutes from './routes/admin.js';
import { initRealtime } from './lib/realtime.js';
import { startExpirySweep } from './lib/expiry.js';

const app = express();

app.use(express.json({
  limit: '2mb',
  // Kept for the WhatsApp webhook: its signature is computed over the exact
  // bytes sent, and re-serialising the parsed object reorders keys and changes
  // whitespace, either of which changes the hash.
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// The guest page is a separate origin from the service, and it is opened by a
// stranger scanning a card, so it needs CORS. Restrict it in any real
// deployment via CORS_ORIGIN.
app.use((req, res, next) => {
  const allowed = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim());
  const origin = req.headers.origin;
  if (!allowed || allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Community-Id');
  // PATCH is load-bearing and was missing. Six routes answer it -- pausing a
  // valet point, saving property details, running a promotion, editing a staff
  // member -- and a browser refuses the preflight for a verb that is not
  // listed, so every one of those failed before a request was ever sent. No
  // 500, no access log line, no server-side trace at all: the failure exists
  // only in the browser, which is why curl and the service tests both said the
  // endpoints were fine. src/__tests__/cors.test.js now checks this header
  // against the route table so a new verb cannot go unlisted again.
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  res.locals.requestId = req.headers['x-request-id'] || uuidv4();
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'valet-service' });
});

app.use('/guard', guardRoutes);
app.use('/guest', guestRoutes);
app.use('/admin', adminRoutes);
app.use('/webhooks', webhookRoutes);

// Multer rejects an oversized upload with its own error code; surface it as a
// 413 rather than letting it fall through as an opaque 500.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file_too_large' });
  }
  console.error('valet-service error:', err);
  res.status(500).json({ error: 'internal_error' });
});

const PORT = process.env.PORT || 3060;

if (process.env.NODE_ENV !== 'test') {
  const server = http.createServer(app);
  initRealtime(server).catch((err) => console.error('realtime init failed:', err));

  // Off by default: with more than one instance every instance would sweep,
  // and deletion belongs on a schedule outside the request-serving process.
  // scripts/valet-sweep.js is the entrypoint for that scheduled task.
  if (process.env.VALET_RUN_SWEEP_IN_PROCESS === 'true') {
    startExpirySweep();
  }

  server.listen(PORT, () => {
    console.log(`valet-service listening on :${PORT}`);
  });
}

export default app;
