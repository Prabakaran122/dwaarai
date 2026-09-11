# DwaarAI Valet on WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guest scans one QR at intake instead of being handed a printed card, and walks away with their valet ticket live in WhatsApp — vehicle, status, and a way to ask for the car back.

**Architecture:** A three-layer split inside valet-service. `lib/whatsapp.js` is dumb transport (send text, send template, verify signature) and hides the provider. `lib/whatsapp-guest.js` owns the domain: it decides free-form versus template from the 24-hour window and holds every piece of message copy. `routes/webhooks.js` takes inbound, verifies, de-duplicates, and dispatches. Nothing above the transport file knows which provider is live, and nothing outside the domain file composes a message.

**Tech Stack:** Node 20 ESM, Express 4 via `asyncRouter()`, Postgres, vitest. WhatsApp through MSG91's Business API on the existing account. Next.js 14 (App Router, basePath `/valet`) for the landing page.

**Spec:** `docs/superpowers/specs/2026-09-11-valet-whatsapp-design.md`

## Global Constraints

- **One DwaarAI business number serves every venue.** Messages name the venue in the body; there is no per-venue WhatsApp account.
- **English only.** Templates are approved per language; Hindi and Kannada are out of scope for this plan.
- **The session token never appears in a WhatsApp message.** Only the claim code, which stops resolving when the ticket closes.
- **Every outbound goes through `notifyGuest()`.** No route composes or sends a WhatsApp message directly.
- **Unconfigured means `skipped`, never success.** Matches `lib/sms.js`: a deployment without credentials must report that it sent nothing.
- **Nothing throws into a request path.** A messaging failure must never roll back or 500 a ticket operation; the car is already in the venue's hands.
- New env: `WHATSAPP_PROVIDER` (`msg91` | unset), `WHATSAPP_NUMBER` (E.164 digits, e.g. `919876543210`), `WHATSAPP_WEBHOOK_SECRET`, `WHATSAPP_TEMPLATE_CAR_READY`. Reuses existing `MSG91_AUTH_KEY`.
- Frontend env: `NEXT_PUBLIC_WHATSAPP_NUMBER` for valet-guest.

## File Structure

| File | Responsibility |
|---|---|
| `services/valet-service/src/lib/whatsapp.js` | **Create.** Transport only: `sendText`, `sendTemplate`, `verifySignature`. Provider-specific. |
| `services/valet-service/src/lib/whatsapp-guest.js` | **Create.** Domain: window choice, all message copy, `notifyGuest`. |
| `services/valet-service/src/routes/webhooks.js` | **Create.** Inbound: verify, de-dupe, bind, dispatch commands. |
| `services/valet-service/src/index.js` | **Modify.** Capture raw body; mount `/webhooks`. |
| `services/valet-service/src/routes/guard.js` | **Modify.** QR encodes the landing page; status changes notify. |
| `services/api-gateway/migrations/048_valet_whatsapp.sql` | **Create.** Window column + inbound de-dupe table. |
| `apps/valet-guest/app/w/[code]/page.tsx` | **Create.** The two-door landing page. |

---

### Task 1: The provider boundary

**Files:**
- Create: `services/valet-service/src/lib/whatsapp.js`
- Test: `services/valet-service/src/__tests__/whatsapp.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `sendText(waId: string, body: string): Promise<{status: 'sent'|'skipped'|'failed'}>`, `sendTemplate(waId: string, templateName: string, vars: string[]): Promise<{status}>`, `verifySignature(rawBody: Buffer|string, signature: string): boolean`, `isConfigured(): boolean`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendText, sendTemplate, verifySignature, isConfigured } from '../lib/whatsapp.js';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.WHATSAPP_PROVIDER = 'msg91';
  process.env.MSG91_AUTH_KEY = 'test-key';
  process.env.WHATSAPP_NUMBER = '919999900000';
  process.env.WHATSAPP_WEBHOOK_SECRET = 'shh';
});

afterEach(() => { process.env = { ...ORIGINAL }; });

describe('whatsapp transport', () => {
  it('sends a free-form message to the guest', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ type: 'success' }) });
    vi.stubGlobal('fetch', fetchMock);

    expect(await sendText('919876543210', 'Your car is on its way')).toEqual({ status: 'sent' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toBe('919876543210');
    expect(JSON.stringify(body)).toContain('Your car is on its way');
  });

  it('reports skipped rather than success when no provider is configured', async () => {
    delete process.env.WHATSAPP_PROVIDER;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await sendText('919876543210', 'hi')).toEqual({ status: 'skipped' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isConfigured()).toBe(false);
  });

  it('never throws when the provider is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await sendText('919876543210', 'hi')).toEqual({ status: 'failed' });
  });

  it('sends a template with its variables in order', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ type: 'success' }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendTemplate('919876543210', 'car_ready', ['The Leela', 'DWR-0042']);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.stringify(body)).toContain('car_ready');
    expect(JSON.stringify(body)).toContain('The Leela');
  });

  it('accepts a signature computed over the raw body', () => {
    const crypto = require('crypto');
    const raw = '{"hello":"world"}';
    const sig = crypto.createHmac('sha256', 'shh').update(raw).digest('hex');

    expect(verifySignature(raw, sig)).toBe(true);
  });

  it('rejects a tampered body, a wrong signature and a missing one', () => {
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha256', 'shh').update('{"a":1}').digest('hex');

    expect(verifySignature('{"a":2}', sig)).toBe(false);
    expect(verifySignature('{"a":1}', 'deadbeef')).toBe(false);
    expect(verifySignature('{"a":1}', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/whatsapp.test.js`
Expected: FAIL — cannot resolve `../lib/whatsapp.js`.

- [ ] **Step 3: Implement**

```js
import crypto from 'crypto';

/**
 * Transport only. Everything about *what* to say lives in whatsapp-guest.js;
 * this file knows only how to put bytes on the wire and how to check a
 * signature, so swapping MSG91 for Meta's Cloud API touches nothing else --
 * the same split storage.js uses for S3 versus local disk.
 */

const MSG91_WHATSAPP_URL = 'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

const provider = () => process.env.WHATSAPP_PROVIDER || '';
const authKey = () => process.env.MSG91_AUTH_KEY || '';
const fromNumber = () => process.env.WHATSAPP_NUMBER || '';

export function isConfigured() {
  return provider() === 'msg91' && !!authKey() && !!fromNumber();
}

async function post(payload) {
  // Reports rather than throws, on every path. By the time any of this runs
  // the car is already in the venue's hands; a messaging failure must not
  // become a failed ticket operation.
  if (!isConfigured()) return { status: 'skipped' };
  try {
    const res = await fetch(MSG91_WHATSAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: authKey() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return data?.type === 'error' ? { status: 'failed' } : { status: 'sent' };
  } catch {
    return { status: 'failed' };
  }
}

export function sendText(waId, body) {
  return post({
    integrated_number: fromNumber(),
    content_type: 'text',
    to: waId,
    payload: { type: 'text', text: { body } },
  });
}

export function sendTemplate(waId, templateName, vars = []) {
  return post({
    integrated_number: fromNumber(),
    content_type: 'template',
    to: waId,
    payload: {
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: [{
          type: 'body',
          parameters: vars.map((text) => ({ type: 'text', text })),
        }],
      },
    },
  });
}

/**
 * Signature over the RAW body, not the parsed object: re-serialising JSON
 * reorders keys and changes whitespace, which changes the hash. Mirrors
 * api-gateway's razorpay.js.
 */
export function verifySignature(rawBody, signature) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  if (!secret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody))
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/whatsapp.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add services/valet-service/src/lib/whatsapp.js services/valet-service/src/__tests__/whatsapp.test.js
git commit -m "feat(valet): WhatsApp transport, behind a provider boundary"
```

---

### Task 2: Schema for the window and for de-duplication

**Files:**
- Create: `services/api-gateway/migrations/048_valet_whatsapp.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `valet_tickets.whatsapp_last_inbound_at TIMESTAMPTZ`; table `valet_whatsapp_messages(id, provider_message_id UNIQUE, ticket_id, direction, received_at)`.

- [ ] **Step 1: Write the migration**

```sql
-- WhatsApp as a way into a valet ticket.
--
-- Two things the flow cannot work without, and nothing more.

-- When the guest last messaged us. WhatsApp allows free-form replies only
-- within 24 hours of a user-initiated message; outside that window only an
-- approved template may be sent. Every outbound decision reads this column,
-- so it is stamped on every inbound.
ALTER TABLE valet_tickets ADD COLUMN IF NOT EXISTS whatsapp_last_inbound_at TIMESTAMPTZ;

-- Inbound de-duplication.
--
-- Providers retry a webhook they believe failed. Without this, a retried
-- "bring my car" is acted on twice and a valet is sent for a car already on
-- its way. The UNIQUE constraint is the whole mechanism: the insert is
-- attempted before the message is processed, and a 23505 means "already done".
CREATE TABLE IF NOT EXISTS valet_whatsapp_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_message_id VARCHAR(128) NOT NULL UNIQUE,
  ticket_id           UUID REFERENCES valet_tickets(id),
  direction           VARCHAR(8)   NOT NULL CHECK (direction IN ('in', 'out')),
  received_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valet_whatsapp_ticket
  ON valet_whatsapp_messages(ticket_id);
```

- [ ] **Step 2: Verify it applies cleanly and is a no-op on re-run**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d postgres
DATABASE_URL=postgresql://cguser:testpass@localhost:5432/communitygate pnpm --filter api-gateway migrate
DATABASE_URL=postgresql://cguser:testpass@localhost:5432/communitygate pnpm --filter api-gateway migrate
```
Expected: applies on the first run, reports up-to-date on the second. `IF NOT EXISTS` everywhere is what makes the second run safe.

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/migrations/048_valet_whatsapp.sql
git commit -m "feat(valet): schema for the WhatsApp window and inbound de-duplication"
```

---

### Task 3: The domain layer — window choice and copy

**Files:**
- Create: `services/valet-service/src/lib/whatsapp-guest.js`
- Test: `services/valet-service/src/__tests__/whatsapp-guest.test.js`

**Interfaces:**
- Consumes: `sendText`, `sendTemplate`, `isConfigured` from `lib/whatsapp.js`.
- Produces: `notifyGuest(ticket, kind, extra = {}): Promise<{status}>` where `kind` is one of `'bound' | 'accepted' | 'en_route' | 'arrived' | 'closed'`, and `ticket` is a row carrying `phone_number`, `whatsapp_last_inbound_at`, `display_id`, `plate`, `vehicle_make`, `community_name`, `current_guard_name`, `eta_minutes`, `claim_code`. Also `WINDOW_MS` (number).

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/whatsapp.js', () => ({
  isConfigured: vi.fn(() => true),
  sendText: vi.fn(async () => ({ status: 'sent' })),
  sendTemplate: vi.fn(async () => ({ status: 'sent' })),
}));

import { sendText, sendTemplate } from '../lib/whatsapp.js';
import { notifyGuest, WINDOW_MS } from '../lib/whatsapp-guest.js';

const ticket = (over = {}) => ({
  id: 't1',
  display_id: 'DWR-0042',
  plate: 'KA 03 NJ 0435',
  vehicle_make: 'Maruti Swift',
  community_name: 'The Leela',
  current_guard_name: 'Suresh',
  eta_minutes: 4,
  claim_code: '4K7QP2',
  phone_number: '919876543210',
  whatsapp_last_inbound_at: new Date().toISOString(),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('choosing free-form or template', () => {
  it('sends free-form inside the 24-hour window', async () => {
    await notifyGuest(ticket(), 'arrived');

    expect(sendText).toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('falls back to the template once the window has closed', async () => {
    const stale = new Date(Date.now() - WINDOW_MS - 60000).toISOString();

    await notifyGuest(ticket({ whatsapp_last_inbound_at: stale }), 'arrived');

    // Free-form outside the window is silently dropped by Meta, so a guest on
    // a multi-day stay would never hear their car had arrived.
    expect(sendTemplate).toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('uses the template when the guest has never messaged us', async () => {
    await notifyGuest(ticket({ whatsapp_last_inbound_at: null }), 'arrived');

    expect(sendTemplate).toHaveBeenCalled();
  });

  it('sends nothing at all to a ticket with no number', async () => {
    expect(await notifyGuest(ticket({ phone_number: null }), 'arrived'))
      .toEqual({ status: 'skipped' });
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

describe('what the messages say', () => {
  it('confirms the binding with the vehicle and where to track it', async () => {
    await notifyGuest(ticket(), 'bound');

    const body = sendText.mock.calls[0][1];
    expect(body).toContain('KA 03 NJ 0435');
    expect(body).toContain('The Leela');
    expect(body).toContain('DWR-0042');
    // Every message that needs the guest to act ends in a link back, because
    // the rotating pickup QR cannot be delivered over WhatsApp.
    expect(body).toContain('/valet/');
  });

  it('carries the ETA and the valet name when the car is on its way', async () => {
    await notifyGuest(ticket(), 'en_route');

    const body = sendText.mock.calls[0][1];
    expect(body).toContain('4');
    expect(body).toContain('Suresh');
  });

  it('never puts the session token in a message', async () => {
    await notifyGuest(ticket({ session_token: 'a'.repeat(32) }), 'bound');

    expect(sendText.mock.calls[0][1]).not.toContain('a'.repeat(32));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/whatsapp-guest.test.js`
Expected: FAIL — cannot resolve `../lib/whatsapp-guest.js`.

- [ ] **Step 3: Implement**

```js
import { sendText, sendTemplate } from './whatsapp.js';

/**
 * Everything the guest is ever told, and the one decision about how to tell
 * them.
 *
 * WhatsApp permits free-form replies only within 24 hours of a message the
 * guest sent us. Outside that, only an approved template goes through -- a
 * free-form send is accepted by the API and never delivered, which is the
 * worst possible failure: a guest on a multi-day stay silently never hears
 * that their car is ready. So the window is checked once, here, and no route
 * composes a message of its own.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;

const baseUrl = () => process.env.VALET_GUEST_BASE_URL || 'https://dwaarai.com/valet';

/** The code, never the session token: it stops resolving when the ticket closes. */
const trackUrl = (t) => `${baseUrl()}/w/${t.claim_code}`;

function compose(t, kind, extra) {
  switch (kind) {
    case 'bound':
      return `${t.community_name}: your car is with us.\n`
        + `${t.plate} · ${t.vehicle_make}\nTicket ${t.display_id}\n\n`
        + `Reply CAR when you want it brought round, or track it here: ${trackUrl(t)}`;
    case 'accepted':
      return `${t.community_name}: a valet is getting your car (${t.plate}).\n`
        + `Track it: ${trackUrl(t)}`;
    case 'en_route':
      return `Your car is on its way`
        + (t.eta_minutes ? ` — about ${t.eta_minutes} minutes.` : '.')
        + (t.current_guard_name ? `\n${t.current_guard_name} is bringing it.` : '')
        + `\n\n${trackUrl(t)}`;
    case 'arrived':
      // The pickup QR rotates every 18 seconds and only the newest validates,
      // so it cannot be sent as an image. The link is the delivery mechanism.
      return `Your car is at the pickup point.\n`
        + `Open this to show the valet your code: ${trackUrl(t)}`;
    case 'closed':
      return `Thank you for visiting ${t.community_name}.\nTicket ${t.display_id}`;
    default:
      return `${t.community_name}: ${trackUrl(t)}`;
  }
}

function withinWindow(t) {
  if (!t.whatsapp_last_inbound_at) return false;
  return Date.now() - new Date(t.whatsapp_last_inbound_at).getTime() < WINDOW_MS;
}

export async function notifyGuest(ticket, kind, extra = {}) {
  if (!ticket?.phone_number) return { status: 'skipped' };

  if (withinWindow(ticket)) {
    return sendText(ticket.phone_number, compose(ticket, kind, extra));
  }

  // One template covers re-engagement. Utility category: "your car is ready"
  // is a service message, which is both cheaper and far easier to get
  // approved than anything marketing-shaped.
  const name = process.env.WHATSAPP_TEMPLATE_CAR_READY || 'car_ready';
  return sendTemplate(ticket.phone_number, name, [
    ticket.community_name || 'Your venue',
    ticket.display_id || '',
    trackUrl(ticket),
  ]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/whatsapp-guest.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add services/valet-service/src/lib/whatsapp-guest.js services/valet-service/src/__tests__/whatsapp-guest.test.js
git commit -m "feat(valet): guest message copy, and the one place the 24h window is decided"
```

---

### Task 4: Raw body capture

**Files:**
- Modify: `services/valet-service/src/index.js:12`

**Interfaces:**
- Consumes: nothing.
- Produces: `req.rawBody` (Buffer) on every request, for `verifySignature`.

- [ ] **Step 1: Make the change**

`index.js` currently mounts `express.json({ limit: '2mb' })` globally, which consumes the request stream before any route sees it. A signature computed over re-serialised JSON will not match, because key order and whitespace change. Capture the bytes as they are parsed:

```js
app.use(express.json({
  limit: '2mb',
  // Kept for the WhatsApp webhook: its signature is over the exact bytes
  // sent, and re-serialising the parsed object changes them.
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
```

- [ ] **Step 2: Verify nothing else broke**

Run: `pnpm --filter valet-service run test`
Expected: PASS, all existing tests — this adds a property and changes no behaviour.

- [ ] **Step 3: Commit**

```bash
git add services/valet-service/src/index.js
git commit -m "chore(valet): keep the raw request body for webhook signatures"
```

---

### Task 5: The webhook — verify, de-duplicate, bind

**Files:**
- Create: `services/valet-service/src/routes/webhooks.js`
- Modify: `services/valet-service/src/index.js` (mount `/webhooks`)
- Test: `services/valet-service/src/__tests__/webhooks.test.js`

**Interfaces:**
- Consumes: `verifySignature` from `lib/whatsapp.js`; `notifyGuest` from `lib/whatsapp-guest.js`; `normalizeClaimCode` from `lib/claim-code.js`; `query`, `queryOne` from `db.js`; `logEvent` from `lib/events.js`.
- Produces: `POST /webhooks/whatsapp`, default-exported router.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../db.js', () => ({
  default: {}, query: vi.fn(), queryOne: vi.fn(), queryRows: vi.fn(),
}));
vi.mock('../lib/events.js', () => ({ logEvent: vi.fn() }));
vi.mock('../lib/realtime.js', () => ({ emitTicketUpdate: vi.fn() }));
vi.mock('../lib/whatsapp-guest.js', () => ({ notifyGuest: vi.fn(async () => ({ status: 'sent' })) }));

import { query, queryOne } from '../db.js';
import { notifyGuest } from '../lib/whatsapp-guest.js';
import webhookRoutes from '../routes/webhooks.js';
import { createApp, request } from './helpers.js';

process.env.WHATSAPP_WEBHOOK_SECRET = 'shh';
const app = createApp(webhookRoutes, '/webhooks');

function inbound(text, { messageId = 'wamid.1', from = '919876543210' } = {}) {
  return { messages: [{ id: messageId, from, type: 'text', text: { body: text } }] };
}
const sign = (body) =>
  crypto.createHmac('sha256', 'shh').update(JSON.stringify(body)).digest('hex');

beforeEach(() => vi.clearAllMocks());

describe('POST /webhooks/whatsapp', () => {
  it('refuses an unsigned payload', async () => {
    const body = inbound('4K7QP2');

    const res = await request(app, 'POST', '/webhooks/whatsapp', { body });

    expect(res.status).toBe(401);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('refuses a payload whose signature does not match the body', async () => {
    const body = inbound('4K7QP2');

    const res = await request(app, 'POST', '/webhooks/whatsapp', {
      body, headers: { 'x-whatsapp-signature': sign(inbound('SOMETHINGELSE')) },
    });

    expect(res.status).toBe(401);
  });

  it('binds the number to the ticket the claim code names', async () => {
    const body = inbound('Hi, my code is 4K7QP2');
    queryOne
      .mockResolvedValueOnce(null)                                  // not seen before
      .mockResolvedValueOnce({ id: 't1', claim_code: '4K7QP2', phone_number: null });

    const res = await request(app, 'POST', '/webhooks/whatsapp', {
      body, headers: { 'x-whatsapp-signature': sign(body) },
    });

    expect(res.status).toBe(200);
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/phone_number/);
    expect(sql).toMatch(/whatsapp_last_inbound_at/);
    expect(notifyGuest).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'bound');
  });

  it('acts on a redelivered message exactly once', async () => {
    const body = inbound('4K7QP2', { messageId: 'wamid.dup' });
    queryOne.mockResolvedValueOnce({ id: 'seen' });   // already recorded

    const res = await request(app, 'POST', '/webhooks/whatsapp', {
      body, headers: { 'x-whatsapp-signature': sign(body) },
    });

    // A provider retry must not re-bind or re-notify.
    expect(res.status).toBe(200);
    expect(notifyGuest).not.toHaveBeenCalled();
  });

  it('asks for the code when the message carries none', async () => {
    const body = inbound('hello?');
    queryOne.mockResolvedValueOnce(null);

    const res = await request(app, 'POST', '/webhooks/whatsapp', {
      body, headers: { 'x-whatsapp-signature': sign(body) },
    });

    // Silence reads as a broken channel to a guest who just typed something.
    expect(res.status).toBe(200);
    expect(notifyGuest).not.toHaveBeenCalled();
  });

  it('does not rebind a ticket that already belongs to another number', async () => {
    const body = inbound('4K7QP2', { from: '919000000000' });
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 't1', claim_code: '4K7QP2', phone_number: '919876543210' });

    await request(app, 'POST', '/webhooks/whatsapp', {
      body, headers: { 'x-whatsapp-signature': sign(body) },
    });

    // A valet stand is a public place; a ticket must not migrate to whoever
    // scanned the screen last.
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).not.toMatch(/SET[\s\S]*phone_number\s*=\s*\$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/webhooks.test.js`
Expected: FAIL — cannot resolve `../routes/webhooks.js`.

- [ ] **Step 3: Implement**

```js
import { asyncRouter } from '../lib/async-router.js';
import { query, queryOne } from '../db.js';
import { verifySignature } from '../lib/whatsapp.js';
import { notifyGuest } from '../lib/whatsapp-guest.js';
import { normalizeClaimCode } from '../lib/claim-code.js';
import { logEvent } from '../lib/events.js';

const router = asyncRouter();

/**
 * Inbound WhatsApp.
 *
 * Public by necessity, so the signature is the only thing standing between
 * this route and anyone who knows the URL. Checked against the raw bytes
 * before a single query runs.
 */

// Six characters from the claim-code alphabet. That alphabet deliberately
// omits O, I, S, 0, 1 and 5, which makes this specific enough that ordinary
// words in a greeting do not match it.
const CODE_PATTERN = /\b[ABCDEFGHJKLMNPQRTUVWXYZ23456789]{6}\b/i;

function extractCode(text) {
  const found = String(text || '').toUpperCase().match(CODE_PATTERN);
  return found ? normalizeClaimCode(found[0]) : null;
}

router.post('/whatsapp', async (req, res) => {
  const signature = req.headers['x-whatsapp-signature'];
  if (!verifySignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'bad_signature' });
  }

  const message = req.body?.messages?.[0];
  // Acknowledge anything we do not understand. A non-200 is retried forever.
  if (!message?.id) return res.status(200).json({ ok: true });

  // Recorded before it is acted on: the UNIQUE constraint is what makes a
  // provider retry a no-op rather than a second car request.
  const seen = await queryOne(
    'SELECT id FROM valet_whatsapp_messages WHERE provider_message_id = $1',
    [message.id]
  );
  if (seen) return res.status(200).json({ ok: true, duplicate: true });

  const code = extractCode(message.text?.body);
  if (!code) {
    await query(
      `INSERT INTO valet_whatsapp_messages (provider_message_id, direction)
       VALUES ($1, 'in') ON CONFLICT DO NOTHING`,
      [message.id]
    );
    return res.status(200).json({ ok: true, unmatched: true });
  }

  const ticket = await queryOne(
    `SELECT t.*, c.name AS community_name
       FROM valet_tickets t
       JOIN communities c ON c.id = t.community_id
      WHERE t.claim_code = $1 AND t.status NOT IN ('final_closed', 'expired')
      LIMIT 1`,
    [code]
  );

  await query(
    `INSERT INTO valet_whatsapp_messages (provider_message_id, ticket_id, direction)
     VALUES ($1, $2, 'in') ON CONFLICT DO NOTHING`,
    [message.id, ticket?.id || null]
  );

  if (!ticket) return res.status(200).json({ ok: true, unmatched: true });

  const alreadyBoundToSomeoneElse =
    ticket.phone_number && ticket.phone_number !== message.from;

  if (alreadyBoundToSomeoneElse) {
    // Window still refreshes so we can answer them, but the ticket does not move.
    await query(
      'UPDATE valet_tickets SET whatsapp_last_inbound_at = NOW() WHERE id = $1',
      [ticket.id]
    );
    return res.status(200).json({ ok: true, alreadyBound: true });
  }

  const firstBind = !ticket.phone_number;
  await query(
    `UPDATE valet_tickets
        SET phone_number = $2,
            phone_consent_at = COALESCE(phone_consent_at, NOW()),
            whatsapp_last_inbound_at = NOW()
      WHERE id = $1`,
    [ticket.id, message.from]
  );

  if (firstBind) {
    await logEvent(ticket.id, 'whatsapp_bound');
    await notifyGuest(
      { ...ticket, phone_number: message.from, whatsapp_last_inbound_at: new Date().toISOString() },
      'bound'
    );
  }

  return res.status(200).json({ ok: true });
});

export default router;
```

Then mount it in `index.js`, beside the existing routers:

```js
import webhookRoutes from './routes/webhooks.js';
// ...
app.use('/webhooks', webhookRoutes);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/webhooks.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add services/valet-service/src/routes/webhooks.js services/valet-service/src/__tests__/webhooks.test.js services/valet-service/src/index.js
git commit -m "feat(valet): inbound WhatsApp — verified, de-duplicated, bound to a ticket"
```

---

### Task 6: Requesting the car from the thread

**Files:**
- Modify: `services/valet-service/src/routes/webhooks.js`
- Test: `services/valet-service/src/__tests__/webhooks.test.js`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces: no new exports; `POST /webhooks/whatsapp` now transitions `parked`/`parked_again` to `requested`.

- [ ] **Step 1: Write the failing tests**

```js
describe('asking for the car from WhatsApp', () => {
  const bound = (status) => ({
    id: 't1', claim_code: '4K7QP2', phone_number: '919876543210',
    status, community_name: 'The Leela', display_id: 'DWR-0042',
  });

  it('requests the car when it is parked', async () => {
    const body = inbound('4K7QP2 CAR');
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(bound('parked'));

    await request(app, 'POST', '/webhooks/whatsapp', {
      body, headers: { 'x-whatsapp-signature': sign(body) },
    });

    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).toMatch(/status\s*=\s*'requested'/);
  });

  it('does not request a car that is already on its way', async () => {
    const body = inbound('4K7QP2 CAR');
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(bound('en_route'));

    await request(app, 'POST', '/webhooks/whatsapp', {
      body, headers: { 'x-whatsapp-signature': sign(body) },
    });

    // Requesting twice sends a second valet for the same car.
    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).not.toMatch(/status\s*=\s*'requested'/);
  });

  it('replies with status when the message is not a request', async () => {
    const body = inbound('4K7QP2 thanks!');
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(bound('parked'));

    await request(app, 'POST', '/webhooks/whatsapp', {
      body, headers: { 'x-whatsapp-signature': sign(body) },
    });

    const sql = query.mock.calls.map((c) => c[0]).join(' ');
    expect(sql).not.toMatch(/status\s*=\s*'requested'/);
    expect(notifyGuest).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/webhooks.test.js -t "asking for the car"`
Expected: FAIL — no status transition happens.

- [ ] **Step 3: Implement**

Add above the route, and call it after the bind block:

```js
// One intent. Anything else gets status and a link rather than a guess at
// conversation.
const REQUEST_PATTERN = /\b(car|gaadi|vehicle|bring|ready|pick\s*up|pickup)\b/i;

const REQUESTABLE = ['parked', 'parked_again'];
```

Replace the final `return res.status(200).json({ ok: true });` with:

```js
  const wantsCar = REQUEST_PATTERN.test(message.text?.body || '');
  const fresh = { ...ticket, phone_number: message.from, whatsapp_last_inbound_at: new Date().toISOString() };

  if (firstBind) {
    await logEvent(ticket.id, 'whatsapp_bound');
    await notifyGuest(fresh, 'bound');
    return res.status(200).json({ ok: true });
  }

  if (wantsCar && REQUESTABLE.includes(ticket.status)) {
    await query(`UPDATE valet_tickets SET status = 'requested' WHERE id = $1`, [ticket.id]);
    await logEvent(ticket.id, 'requested', { metadata: { via: 'whatsapp' } });
    await notifyGuest({ ...fresh, status: 'requested' }, 'accepted');
    return res.status(200).json({ ok: true, requested: true });
  }

  // Already moving, already here, or not a request at all: say where things
  // stand. Never nothing.
  const kind = ticket.status === 'arrived' ? 'arrived'
    : ticket.status === 'en_route' ? 'en_route'
    : ticket.status === 'requested' ? 'accepted'
    : 'bound';
  await notifyGuest(fresh, kind);
  return res.status(200).json({ ok: true });
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/webhooks.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add services/valet-service/src/routes/webhooks.js services/valet-service/src/__tests__/webhooks.test.js
git commit -m "feat(valet): a guest can ask for their car from the WhatsApp thread"
```

---

### Task 7: Pushing status changes into the thread

**Files:**
- Modify: `services/valet-service/src/routes/guard.js` (the `/accept`, `/arrived` and `/confirm-pickup` handlers)
- Test: `services/valet-service/src/__tests__/guard.test.js`

**Interfaces:**
- Consumes: `notifyGuest` from `lib/whatsapp-guest.js`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Add the mock alongside the existing ones at the top of `guard.test.js`:

```js
vi.mock('../lib/whatsapp-guest.js', () => ({ notifyGuest: vi.fn(async () => ({ status: 'sent' })) }));
```

and import it: `import { notifyGuest } from '../lib/whatsapp-guest.js';`

```js
describe('keeping the WhatsApp thread up to date', () => {
  it('tells the guest when a valet is on the way', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'requested', phone_number: '919876543210' }))
      .mockResolvedValueOnce(ticketRow({ status: 'en_route', phone_number: '919876543210' }));
    query.mockResolvedValue({});

    await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept`, {
      token, body: { etaMinutes: 4 },
    });

    expect(notifyGuest).toHaveBeenCalledWith(expect.anything(), 'en_route');
  });

  it('says nothing to a ticket that was never bound to WhatsApp', async () => {
    queryOne
      .mockResolvedValueOnce(ticketRow({ status: 'requested', phone_number: null }))
      .mockResolvedValueOnce(ticketRow({ status: 'en_route', phone_number: null }));
    query.mockResolvedValue({});

    await request(app, 'POST', `/guard/tickets/${SESSION_TOKEN}/accept`, {
      token, body: { etaMinutes: 4 },
    });

    expect(notifyGuest).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/guard.test.js -t "WhatsApp thread"`
Expected: FAIL — `notifyGuest` never called.

- [ ] **Step 3: Implement**

Import at the top of `guard.js`:

```js
import { notifyGuest } from '../lib/whatsapp-guest.js';
```

In the `/accept` handler, after `emitTicketUpdate(updated)`:

```js
  // After the response is decided, and never in a way that can fail it.
  if (updated.phone_number) await notifyGuest(updated, 'en_route');
```

In `/arrived`, after its `emitTicketUpdate`:

```js
  if (updated.phone_number) await notifyGuest(updated, 'arrived');
```

In `/confirm-pickup`, in the `final_closed` branch after the status write:

```js
  if (ticket.phone_number) await notifyGuest({ ...ticket, status: 'final_closed' }, 'closed');
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter valet-service run test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add services/valet-service/src/routes/guard.js services/valet-service/src/__tests__/guard.test.js
git commit -m "feat(valet): push valet status into the guest's WhatsApp thread"
```

---

### Task 8: The two-door landing page

**Files:**
- Create: `apps/valet-guest/app/w/[code]/page.tsx`
- Test: `apps/valet-guest/app/w/[code]/page.test.tsx`

**Interfaces:**
- Consumes: `VALET_BASE` from `@/lib/api`.
- Produces: the route `/valet/w/<code>`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ code: '4K7QP2' }),
  useRouter: () => ({ replace: nav.replace }),
}));

import WhatsAppDoorPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = '919999900000';
});

describe('the door a scanned QR opens', () => {
  it('offers WhatsApp with the code already in the message', async () => {
    render(<WhatsAppDoorPage />);

    const link = await screen.findByRole('link', { name: /whatsapp/i });
    const href = link.getAttribute('href') || '';
    expect(href).toContain('wa.me/919999900000');
    expect(decodeURIComponent(href)).toContain('4K7QP2');
  });

  it('always offers the browser too, so a guest without WhatsApp is not stranded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ sessionToken: 'tok-1' }),
    }));

    render(<WhatsAppDoorPage />);
    fireEvent.click(await screen.findByRole('button', { name: /browser/i }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/v/tok-1'));
  });

  it('says so when the code does not resolve, rather than dead-ending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(<WhatsAppDoorPage />);
    fireEvent.click(await screen.findByRole('button', { name: /browser/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter valet-guest exec vitest run "app/w/[code]/page.test.tsx"`
Expected: FAIL — cannot resolve `./page`.

- [ ] **Step 3: Implement**

```tsx
'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { VALET_BASE } from '@/lib/api';

/**
 * What the QR on the guard's screen opens.
 *
 * Deliberately not a wa.me link directly. A guest without WhatsApp -- or one
 * who simply does not want to message a business -- would scan that and land
 * on a "download WhatsApp" page holding nothing, which is worse than the
 * printed card they were not given. This page owns that moment and offers
 * both doors.
 */
export default function WhatsAppDoorPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || '').toUpperCase();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '';
  const prefill = encodeURIComponent(
    `Hi! This is my valet ticket. Code ${code}\n(Reply CAR here when you want your car brought round.)`
  );
  const waUrl = `https://wa.me/${number}?text=${prefill}`;

  async function continueInBrowser() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${VALET_BASE}/guest/claim/${encodeURIComponent(code)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('unresolved');
      const { sessionToken } = await res.json();
      router.replace(`/v/${sessionToken}`);
    } catch {
      setError('That code does not match a vehicle here right now. Please check with the valet desk.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-white">Your car is with us</h1>
        <p className="mt-2 text-sm text-white/60">Ticket code</p>
        <p className="mt-1 font-mono text-3xl tracking-[0.3em] text-white">{code}</p>

        <a
          href={waUrl}
          className="mt-8 block w-full py-4 rounded-xl bg-[#25D366] text-[#0D2535] font-semibold"
        >
          Continue on WhatsApp
        </a>
        <p className="mt-2 text-xs text-white/40">
          Get updates and ask for your car from your own chat.
        </p>

        <button
          onClick={continueInBrowser}
          disabled={busy}
          className="mt-6 w-full py-3 rounded-xl ring-1 ring-white/20 text-white text-sm font-semibold disabled:opacity-40"
        >
          {busy ? 'Opening…' : 'Continue in the browser'}
        </button>

        {error && (
          <p className="mt-5 text-sm text-amber-300/90" role="alert">{error}</p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter valet-guest run test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add "apps/valet-guest/app/w/[code]"
git commit -m "feat(valet-guest): one QR, two doors — WhatsApp or the browser"
```

---

### Task 9: Point the intake QR at the new door

**Files:**
- Modify: `services/valet-service/src/routes/guard.js` (the `POST /tickets` response)
- Test: `services/valet-service/src/__tests__/guard.test.js`

**Interfaces:**
- Consumes: `isConfigured` from `lib/whatsapp.js`.
- Produces: `qrDataUrl` encodes `<baseUrl>/w/<claimCode>` when WhatsApp is configured, and `<baseUrl>/v/<sessionToken>` otherwise.

- [ ] **Step 1: Write the failing tests**

```js
describe('what the intake QR points at', () => {
  it('opens the WhatsApp door when WhatsApp is configured', async () => {
    vi.mocked(isConfigured).mockReturnValue(true);
    mockCreateFlow('DWR-0004');

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: new Date(Date.now() + 86400000).toISOString() },
    });

    expect(toDataUrl).toHaveBeenCalledWith(expect.stringContaining(`/w/${res.body.claimCode}`));
  });

  it('falls back to the ticket page when it is not', async () => {
    vi.mocked(isConfigured).mockReturnValue(false);
    mockCreateFlow('DWR-0004');

    const res = await request(app, 'POST', '/guard/tickets', {
      token,
      body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: new Date(Date.now() + 86400000).toISOString() },
    });

    // A venue whose deployment has no WhatsApp must behave exactly as before.
    expect(toDataUrl).toHaveBeenCalledWith(expect.stringContaining(`/v/${res.body.sessionToken}`));
  });
});
```

Add to the file's mocks: `vi.mock('../lib/whatsapp.js', () => ({ isConfigured: vi.fn(() => false) }));` and import `isConfigured` and `toDataUrl`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter valet-service exec vitest run src/__tests__/guard.test.js -t "intake QR"`
Expected: FAIL — the QR always encodes the `/v/` URL.

- [ ] **Step 3: Implement**

In `guard.js`, import `isConfigured as whatsappConfigured` from `../lib/whatsapp.js`, then in the `POST /tickets` response replace the `qrDataUrl` line:

```js
    // One QR at intake. With WhatsApp live it opens the door page, which
    // offers both channels; without it, the ticket page directly, exactly as
    // before. The claim code printed underneath is unchanged either way.
    const qrTarget = whatsappConfigured()
      ? `${baseUrl}/w/${claimCode}`
      : guestUrl;

    // ...
      qrDataUrl: await toDataUrl(qrTarget),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter valet-service run test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add services/valet-service/src/routes/guard.js services/valet-service/src/__tests__/guard.test.js
git commit -m "feat(valet): the intake QR opens the WhatsApp door when it is configured"
```

---

### Task 10: Configuration and deployment

**Files:**
- Modify: `.env.example`
- Modify: `deploy/deploy-valet.sh` (valet-service unit environment)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Add the variables to `.env.example`**

```
# ── WhatsApp (DwaarAI Valet) ───────────────────────────────────────
# Unset WHATSAPP_PROVIDER and nothing is sent; every send reports "skipped"
# and the intake QR falls back to the ticket page.
WHATSAPP_PROVIDER=msg91
WHATSAPP_NUMBER=919999900000
WHATSAPP_WEBHOOK_SECRET=change-me
WHATSAPP_TEMPLATE_CAR_READY=car_ready
```

- [ ] **Step 2: Add them to the systemd unit in `deploy/deploy-valet.sh`**

In the `communitygate-valet.service` heredoc, beside the existing `Environment=` lines:

```
Environment=WHATSAPP_PROVIDER=${WHATSAPP_PROVIDER:-}
Environment=WHATSAPP_NUMBER=${WHATSAPP_NUMBER:-}
Environment=WHATSAPP_WEBHOOK_SECRET=${WHATSAPP_WEBHOOK_SECRET:-}
Environment=WHATSAPP_TEMPLATE_CAR_READY=${WHATSAPP_TEMPLATE_CAR_READY:-car_ready}
```

And in the valet-guest build step, beside `NEXT_PUBLIC_VALET_API_URL`:

```
NEXT_PUBLIC_WHATSAPP_NUMBER="${WHATSAPP_NUMBER:-}" \
```

- [ ] **Step 3: Document the channel in `CLAUDE.md`**

Add under the Valet section: the three-layer split, the 24-hour window rule, that every outbound goes through `notifyGuest()`, and that the pickup QR cannot be sent over WhatsApp because it rotates every 18 seconds.

- [ ] **Step 4: Verify the whole suite is green**

Run: `pnpm -r run test`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add .env.example deploy/deploy-valet.sh CLAUDE.md
git commit -m "docs(valet): configuration for the WhatsApp channel"
```

---

## Before this can go live

None of it is code, and all of it can run in parallel with the tasks above:

1. **Meta business verification** for DwaarAI, and a dedicated number that is not on anyone's handset. Days to weeks.
2. **One utility template**, English, named to match `WHATSAPP_TEMPLATE_CAR_READY`, with three body variables in this order: venue name, ticket id, tracking URL. Utility category — it is a service message, not marketing.
3. **The webhook URL** registered with the provider, pointing at `https://dwaarai.com/valet-api/webhooks/whatsapp`, with the shared secret matching `WHATSAPP_WEBHOOK_SECRET`.
4. **An nginx rule** allowing `/valet-api/webhooks/` through unauthenticated, if the existing config restricts that path.

Until step 1 completes, leave `WHATSAPP_PROVIDER` unset: every send reports `skipped`, the intake QR falls back to the ticket page, and the product behaves exactly as it does today.
