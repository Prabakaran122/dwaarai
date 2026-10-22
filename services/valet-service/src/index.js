import http from 'http';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import guardRoutes from './routes/guard.js';
import guestRoutes from './routes/guest.js';
import webhookRoutes from './routes/webhooks.js';
import adminRoutes from './routes/admin.js';
import { initRealtime } from './lib/realtime.js';
import { startExpirySweep } from './lib/expiry.js';

const app = express();

// One hop: nginx. Without this req.ip is nginx's 127.0.0.1 for every guest,
// so the per-IP limits below would be one shared bucket for the whole
// internet. Exactly 1, not `true` -- trusting every hop would let a client
// pick its own address by sending X-Forwarded-For.
app.set('trust proxy', 1);

app.use(express.json({
  limit: '2mb',
  // Kept for the WhatsApp webhook: its signature is computed over the exact
  // bytes sent, and re-serialising the parsed object reorders keys and changes
  // whitespace, either of which changes the hash.
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// The guest page is a separate origin from the service, and it is opened by a
// stranger scanning a card, so it needs CORS. CORS_ORIGIN lists the origins
// allowed; deploy-valet.sh always sets it.
//
// Unset is permissive only off production. It used to reflect any origin
// whatever the environment, so a box that lost the variable would have let
// any website drive the admin API from a signed-in operator's browser. In
// production it now allows no cross-origin caller and says so at startup.
export function corsPolicy(env = process.env) {
  const allowed = env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const open = allowed.length ? allowed.includes('*') : env.NODE_ENV !== 'production';
  return { allowed, open, misconfigured: !allowed.length && env.NODE_ENV === 'production' };
}

const CORS = corsPolicy();
if (CORS.misconfigured) {
  console.error('valet-service: CORS_ORIGIN is not set; refusing every cross-origin request. '
    + 'Set it to the guest and admin origins (deploy-valet.sh does).');
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (CORS.open) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else if (origin && CORS.allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  // X-Valet-Device is the card page's device id (see guest.js). A custom
  // header the preflight does not list is refused by the browser before the
  // request is sent, and the card would look permanently locked.
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Community-Id, X-Valet-Device');
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

// The guest API is public, so it is rate limited per client IP. Card lookups
// get the tight bucket: card codes are sequential, and walking A001..Z999 is
// the obvious probe. Everything else under /guest gets a looser one sized for
// the ticket page's own polling.
//
// Sized for a shared address, not one phone. Hotel Wi-Fi and mobile CGNAT put
// many guests behind one IP; a waiting card page polls 12 times a minute and a
// ticket page about 20, so the defaults leave room for a few guests at once
// while still turning a sweep of the code space into hours.
//
// Loopback is exempt: that is this box's own guest app rendering a WhatsApp
// image server-side (VALET_INTERNAL_API_URL), and with trust proxy at 1
// nothing that came through nginx can present as loopback.
const guestLimiter = (perMinute) => rateLimit({
  windowMs: 60 * 1000,
  limit: perMinute,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1',
  message: { error: 'rate_limited', message: 'Too many requests. Please wait a minute and try again.' },
});

app.use('/guard', guardRoutes);
app.use('/guest/cards', guestLimiter(Number(process.env.VALET_GUEST_CARD_RATE_PER_MIN || 30)));
app.use('/guest', guestLimiter(Number(process.env.VALET_GUEST_RATE_PER_MIN || 240)));
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
