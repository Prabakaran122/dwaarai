# Events Module — Backend & Admin Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server side and RWA admin controls for the Events module — stall inventory and booking with real concurrency safety, community donation funds, guest booking through a public link, the 3% platform fee, and the settlement bookkeeping that makes it auditable.

**Architecture:** Extends the existing `events` table rather than replacing it. Payments **generalise the proven dues flow** (`lib/razorpay.js` → order → signature-verified webhook → receipt) into a `payment_orders` table that carries a `purpose`, so stalls, donations and dues all share one audit trail and one webhook. The live dues path is left byte-for-byte alone.

**Tech Stack:** Node 20 ESM, Express, Postgres (`pg`), zod, vitest, Razorpay REST via `src/lib/razorpay.js`, SMS via `src/lib/msg91.js`. Admin Portal is Next.js 14 under `basePath: '/admin'`.

**BRD:** `Dwaar_AI_BRD_Events_Module_v1.0.docx`.

**Scope note:** The Basera app screens are a SEPARATE plan. This one delivers a testable API + admin portal on its own.

## What already exists — reuse, do NOT rebuild

Verified by survey:

- `events` + `event_rsvps` tables (`028_events.sql`) and `routes/community-events.js` — `GET/POST /community-events`, `GET /community-events/:id`, `POST /community-events/:id/rsvp`. Extend these.
- `src/lib/razorpay.js` — a **real** REST integration: `createOrder(amountPaise, receipt)`, `verifyWebhookSignature(rawBody, signature)` (HMAC-SHA256, `timingSafeEqual`), `isLiveMode()`, `getKeyId()`. With no keys configured it returns a clearly-marked `order_test_…` object, so the whole flow is exercisable without a gateway. **This is the payment stub — do not write another one.**
- `dues` + `due_payments` (`015_dues.sql`) and `routes/dues.js` — the order → webhook → PDF receipt pattern to generalise, including `POST /payments/webhook`.
- `src/lib/msg91.js` — SMS sending, for guest receipts.
- `src/lib/fcm.js` — `sendNotification`, `sendToMultiple` for push.

## Global Constraints

- **ESM only**, Node 20. Follow existing route file conventions.
- **Migrations start at `041`.** `040` is claimed by `docs/superpowers/plans/2026-08-05-home-myunit-gaps.md`. Check the directory before choosing.
- **Do not change the existing dues payment path.** It is live and taking money. New purposes go through new tables; the webhook keeps its current dues branch first and adds a second branch.
- **Money is integer paise.** Never a float. The platform fee is 3% of the stall fee **rounded to the nearest rupee** (BRD acceptance criteria), and is **never** charged on donations.
- **Card data must never touch our servers** (BRD NFR). We create orders and verify webhooks; the gateway collects the instrument.
- **Exactly one booking may win a contested stall** (BRD acceptance criteria). This is a database-level guarantee, not an application check.
- Guest mobile numbers are retained for the event + 90 days (BRD NFR / DPDP Act 2023).
- Every permission is enforced server-side.
- Tests: `pnpm --filter api-gateway test` (424 passing at plan time). No regressions.

---

### Task 1: Migration 041 — events commerce schema

**Files:**
- Create: `services/api-gateway/migrations/041_events_commerce.sql`
- Test: applied twice; CI's `migrations` job asserts the second run is a no-op.

**Interfaces:**
- Produces the tables every later task reads: `events` extensions, `event_stalls`, `stall_bookings`, `donation_funds`, `donations`, `payment_orders`, `guest_booking_links`.

- [ ] **Step 1: Write the migration**

```sql
-- Events module (BRD v1.0): stall commerce, donation funds, and a single
-- payment_orders ledger shared by every purpose so there is one audit trail.

-- ── events: type, featured flag, cover image ─────────────────────────────────
-- `category` already exists and means something else (general|sports|festival|
-- meeting|kids). The BRD's filter chips need a separate commerce dimension.
ALTER TABLE events ADD COLUMN IF NOT EXISTS has_stalls    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS has_donations BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_featured   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_path    VARCHAR(255);

-- At most one featured event per community — the BRD renders exactly one hero.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_featured_event_per_community
  ON events(community_id) WHERE is_featured;

-- ── stalls ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_stalls (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id),
  community_id  UUID NOT NULL REFERENCES communities(id),
  code          VARCHAR(20) NOT NULL,            -- 'A1', 'B4' — shown to the user
  stall_type    VARCHAR(20) NOT NULL DEFAULT 'standard', -- standard|premium|corner
  price_paise   INTEGER NOT NULL CHECK (price_paise >= 0),
  row_index     INTEGER NOT NULL DEFAULT 0,      -- grid position for the map
  col_index     INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stall_code_per_event ON event_stalls(event_id, code);

-- ── stall bookings ───────────────────────────────────────────────────────────
-- booker_kind distinguishes a resident (resident_id set) from an external
-- vendor booking through the public link (guest_name/guest_mobile set).
CREATE TABLE IF NOT EXISTS stall_bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stall_id          UUID NOT NULL REFERENCES event_stalls(id),
  event_id          UUID NOT NULL REFERENCES events(id),
  community_id      UUID NOT NULL REFERENCES communities(id),
  booker_kind       VARCHAR(10) NOT NULL,          -- 'resident' | 'guest'
  resident_id       UUID REFERENCES residents(id),
  unit_id           UUID REFERENCES units(id),
  guest_name        VARCHAR(120),
  guest_mobile      VARCHAR(15),
  stall_fee_paise   INTEGER NOT NULL,
  platform_fee_paise INTEGER NOT NULL,
  total_paise       INTEGER NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'reserved', -- reserved|booked|released
  order_id          UUID,                          -- -> payment_orders.id
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  booked_at         TIMESTAMPTZ,
  released_at       TIMESTAMPTZ
);

-- THE concurrency guarantee. The BRD requires that two people booking the same
-- stall produce exactly one booking and one clear error. A SELECT-then-INSERT
-- cannot promise that; this partial unique index can: only one non-released
-- booking may exist per stall, and the loser gets a 23505 the route turns into
-- a 409.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_booking_per_stall
  ON stall_bookings(stall_id) WHERE status <> 'released';

-- ── donation funds ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS donation_funds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id   UUID NOT NULL REFERENCES communities(id),
  event_id       UUID REFERENCES events(id),
  name           VARCHAR(160) NOT NULL,
  description    VARCHAR(2000),
  target_paise   INTEGER NOT NULL CHECK (target_paise > 0),
  is_open        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS donations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id       UUID NOT NULL REFERENCES donation_funds(id),
  community_id  UUID NOT NULL REFERENCES communities(id),
  resident_id   UUID REFERENCES residents(id),
  unit_id       UUID REFERENCES units(id),
  donor_name    VARCHAR(120),
  amount_paise  INTEGER NOT NULL CHECK (amount_paise > 0),
  status        VARCHAR(20) NOT NULL DEFAULT 'created', -- created|paid|failed
  order_id      UUID,
  is_anonymous  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_donations_fund_paid ON donations(fund_id) WHERE status = 'paid';

-- ── payment orders (shared ledger) ───────────────────────────────────────────
-- One row per gateway order regardless of what is being paid for. dues keeps
-- its own due_payments table untouched — that path is live.
CREATE TABLE IF NOT EXISTS payment_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id       UUID NOT NULL REFERENCES communities(id),
  purpose            VARCHAR(20) NOT NULL,          -- 'stall' | 'donation'
  subject_id         UUID NOT NULL,                 -- stall_bookings.id | donations.id
  amount_paise       INTEGER NOT NULL,
  platform_fee_paise INTEGER NOT NULL DEFAULT 0,
  gateway            VARCHAR(20) NOT NULL DEFAULT 'razorpay',
  gateway_order_id   VARCHAR(100),
  gateway_payment_id VARCHAR(100),
  status             VARCHAR(20) NOT NULL DEFAULT 'created', -- created|paid|failed
  test_mode          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at            TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_order_gateway_id
  ON payment_orders(gateway_order_id) WHERE gateway_order_id IS NOT NULL;

-- ── guest booking links ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guest_booking_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id),
  community_id UUID NOT NULL REFERENCES communities(id),
  token        VARCHAR(64) NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ,
  is_revoked   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Apply it twice and confirm the second run is a no-op**

Run: `cd services/api-gateway && node src/db/migrate.js && node src/db/migrate.js`
Expected: first applies `041_events_commerce.sql`; second prints that everything is up to date. If no database is reachable, say so plainly in your report — CI's `migrations` job is then the gate.

- [ ] **Step 3: Run the suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/migrations/041_events_commerce.sql
git commit -m "feat(db): events commerce schema — stalls, donations, payment orders"
```

---

### Task 2: Money helpers

Every later task depends on getting the fee arithmetic right, and the BRD is specific about it. Isolate it so it is testable without a database.

**Files:**
- Create: `services/api-gateway/src/lib/money.js`
- Test: `services/api-gateway/src/__tests__/money.test.js`

**Interfaces:**
- Produces: `PLATFORM_FEE_RATE`, `platformFeePaise(stallFeePaise)`, `stallTotalPaise(stallFeePaise)`, `rupees(paise)`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { PLATFORM_FEE_RATE, platformFeePaise, stallTotalPaise, rupees } from '../lib/money.js';

describe('platform fee', () => {
  it('is 3% of the stall fee', () => {
    expect(PLATFORM_FEE_RATE).toBe(0.03);
    expect(platformFeePaise(100000)).toBe(3000);       // ₹1000 -> ₹30
  });

  it('rounds to the nearest RUPEE, per the BRD acceptance criteria', () => {
    // ₹1500 * 3% = ₹45.00 exactly
    expect(platformFeePaise(150000)).toBe(4500);
    // ₹1250 * 3% = ₹37.50 -> ₹38
    expect(platformFeePaise(125000)).toBe(3800);
    // ₹1010 * 3% = ₹30.30 -> ₹30
    expect(platformFeePaise(101000)).toBe(3000);
  });

  it('never returns a fraction of a paise, and never a float', () => {
    for (const fee of [1, 99, 100, 12345, 999999]) {
      const f = platformFeePaise(fee);
      expect(Number.isInteger(f)).toBe(true);
      expect(f % 100).toBe(0); // whole rupees
    }
  });

  it('charges nothing on a zero-fee stall', () => {
    expect(platformFeePaise(0)).toBe(0);
  });

  it('totals the stall fee plus the platform fee', () => {
    expect(stallTotalPaise(125000)).toBe(125000 + 3800);
  });

  it('formats paise as rupees for display', () => {
    expect(rupees(125000)).toBe('1250.00');
    expect(rupees(0)).toBe('0.00');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test money`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
/**
 * Money is integer paise everywhere. Floats do not survive a ledger.
 *
 * The BRD fixes the platform fee at 3% of the stall fee, "rounded to the
 * nearest rupee" — so the fee is always a whole number of rupees, and is
 * NEVER charged on a donation (taking a cut of a religious or community
 * collection is a deliberate non-goal).
 */
export const PLATFORM_FEE_RATE = 0.03;

export function platformFeePaise(stallFeePaise) {
  const rawPaise = stallFeePaise * PLATFORM_FEE_RATE;
  return Math.round(rawPaise / 100) * 100;
}

export function stallTotalPaise(stallFeePaise) {
  return stallFeePaise + platformFeePaise(stallFeePaise);
}

export function rupees(paise) {
  return (paise / 100).toFixed(2);
}
```

- [ ] **Step 4: Run it, then the suite, then commit**

```bash
git add services/api-gateway/src/lib/money.js services/api-gateway/src/__tests__/money.test.js
git commit -m "feat(api): integer-paise money helpers with the BRD's 3% platform fee"
```

---

### Task 3: Stall inventory and availability

**Files:**
- Create: `services/api-gateway/src/routes/stalls.js`
- Modify: `services/api-gateway/src/index.js` (mount it)
- Test: `services/api-gateway/src/__tests__/stalls.test.js`

**Interfaces:**
- Consumes: `platformFeePaise` from `../lib/money.js`.
- Produces: `GET /events/:id/stalls` (resident + admin) returning `{ stalls: [{ id, code, stallType, pricePaise, platformFeePaise, totalPaise, status, row, col }], available, total }`; `POST /admin/events/:id/stalls` (admin) accepting a layout array.

- [ ] **Step 1: Write the failing test**

Cover: the list returns every active stall with its computed fee and total; a stall with a non-released booking reports `status: 'booked'`; an event from another community 404s; the admin layout endpoint rejects a duplicate `code` within one event; a non-admin cannot create stalls.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter api-gateway test stalls`

- [ ] **Step 3: Implement**

Compute `platformFeePaise`/`totalPaise` **server-side** on every read so the client never derives money. Derive `status` by left-joining `stall_bookings` on `status <> 'released'`. Mount in `index.js` beside the other routes and verify with `grep -c` and `node --check`, per the convention a past merge conflict established in that file.

- [ ] **Step 4: Run the suite and commit**

```bash
git add services/api-gateway/src/routes/stalls.js services/api-gateway/src/index.js services/api-gateway/src/__tests__/stalls.test.js
git commit -m "feat(api): stall inventory with server-computed pricing"
```

---

### Task 4: Booking a stall — the concurrency guarantee

The BRD's sharpest acceptance criterion: *two residents attempting to book the same stall simultaneously result in exactly one successful booking and one clear error message — not two bookings and not two errors.*

**Files:**
- Modify: `services/api-gateway/src/routes/stalls.js`
- Test: `services/api-gateway/src/__tests__/stall-booking.test.js`

**Interfaces:**
- Consumes: `createOrder`, `isLiveMode`, `getKeyId` from `../lib/razorpay.js`; the money helpers.
- Produces: `POST /events/:id/stalls/:stallId/book` → `{ bookingId, orderId, gatewayOrderId, keyId, amountPaise, testMode }`.

- [ ] **Step 1: Write the failing test**

Must include:
- a successful reservation returns an order and leaves the booking `reserved`, **not** `booked` — only the webhook may mark it booked;
- a second booking attempt on the same stall returns **409**, and the error message names the stall;
- a Postgres `23505` raised by `uniq_live_booking_per_stall` surfaces as that same 409, not a 500 — this is the race, and the index is what actually decides it;
- the amounts stored are `stall_fee + platform_fee = total`, computed server-side and **not** taken from the request body (a client must not be able to name its own price);
- a released booking frees the stall for someone else.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

In one transaction: `SELECT ... FOR UPDATE` the stall, insert the `stall_bookings` row (`status = 'reserved'`), insert the `payment_orders` row, call `createOrder`, store `gateway_order_id`, COMMIT. Catch `23505` and return 409. Never trust a price from the client.

Return `keyId` from `getKeyId()` and `testMode` from `isLiveMode()` so the app knows whether to open a real checkout — the same signal `DuesScreen` already uses.

- [ ] **Step 4: Run the suite and commit**

```bash
git add services/api-gateway/src/routes/stalls.js services/api-gateway/src/__tests__/stall-booking.test.js
git commit -m "feat(api): stall booking with a database-enforced single winner"
```

---

### Task 5: Donation funds

**Files:**
- Create: `services/api-gateway/src/routes/donations.js`
- Modify: `services/api-gateway/src/index.js`
- Test: `services/api-gateway/src/__tests__/donations.test.js`

**Interfaces:**
- Produces: `GET /donation-funds` (resident), `GET /donation-funds/:id` with `{ raisedPaise, targetPaise, percent, donorCount }`, `POST /donation-funds/:id/donate` → an order, `POST /admin/donation-funds` (admin), `GET /admin/donation-funds/:id/donors` (admin).

- [ ] **Step 1: Write the failing test**

Cover: progress is computed from **paid** donations only (a `created` donation must not inflate the bar); `percent` is capped at 100 and never divides by zero; **no platform fee is ever attached to a donation** — assert `platform_fee_paise` is 0 on the order; a custom amount below ₹1 is rejected; the donor list is admin-only; an anonymous donation is excluded from the public-facing donor name but still counted in the total.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

The quick-select amounts (₹51/101/251/501) are a **client** concern — the server accepts any positive integer paise. Do not hardcode the ladder server-side.

- [ ] **Step 4: Run the suite and commit**

```bash
git add services/api-gateway/src/routes/donations.js services/api-gateway/src/index.js services/api-gateway/src/__tests__/donations.test.js
git commit -m "feat(api): donation funds with fee-free, paid-only progress"
```

---

### Task 6: One webhook, two new purposes

**Files:**
- Modify: `services/api-gateway/src/routes/dues.js` (the existing `POST /payments/webhook`)
- Test: `services/api-gateway/src/__tests__/payments-webhook.test.js`

**Interfaces:**
- Produces: the webhook additionally resolves `payment_orders` by `gateway_order_id` and settles the subject.

- [ ] **Step 1: Write the failing test**

Cover, in this order of importance:
- **the existing dues branch still works, unchanged** — this is live and taking money;
- a `payment.captured` for a stall order flips the order to `paid` and the booking to `booked`, and stamps `booked_at`;
- a `payment.captured` for a donation order flips both to `paid` and the fund's progress moves;
- an **unknown** order id is a 200 with `received: true` and no writes — Razorpay must not retry forever;
- a **bad signature** is 401 and writes nothing;
- **replay**: the same webhook delivered twice leaves exactly one booking and does not double-count a donation. Assert this explicitly — gateways retry, and a duplicate settlement is a money bug.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

Keep the dues lookup first and untouched; add the `payment_orders` lookup as a second branch. Make settlement idempotent by only transitioning `status = 'created' → 'paid'` (a `WHERE status = 'created'` on the UPDATE, and act on the row count) rather than by reading first.

- [ ] **Step 4: Run the suite and commit**

```bash
git add services/api-gateway/src/routes/dues.js services/api-gateway/src/__tests__/payments-webhook.test.js
git commit -m "feat(api): settle stall and donation payments through the existing webhook"
```

---

### Task 7: Guest booking through a public link

**Files:**
- Create: `services/api-gateway/src/routes/guest-booking.js`
- Modify: `services/api-gateway/src/index.js`
- Test: `services/api-gateway/src/__tests__/guest-booking.test.js`

**Interfaces:**
- Consumes: `sendSMS` (or the real export name) from `../lib/msg91.js`.
- Produces: `POST /admin/events/:id/guest-link` (admin) → `{ token, url, expiresAt }`; `GET /public/stalls/:token` (**no auth**); `POST /public/stalls/:token/book` (**no auth**).

- [ ] **Step 1: Write the failing test**

This is the only unauthenticated write surface in the system, so the tests matter more than usual. Cover:
- a valid token lists stalls and prices but leaks **nothing** about residents — assert no resident name, unit number or mobile appears anywhere in the response;
- an expired token, a revoked token and an unknown token all 404 (do not distinguish — that is an enumeration oracle);
- booking requires a name and a **valid Indian mobile**; an invalid one is 400;
- the same `uniq_live_booking_per_stall` 409 applies — a guest cannot take a stall a resident already holds;
- the 3% platform fee applies identically to guests (BRD FR-GST-05);
- rate limiting: repeated booking attempts from one caller are throttled. If the repo has no rate-limit middleware to reuse, say so in the report rather than inventing one.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

Token is `crypto.randomBytes(32).toString('hex')` — never sequential, never guessable. On payment the webhook (Task 6) already settles the booking; send the SMS receipt from there, in its own try/catch, so a failed SMS can never fail a paid booking.

Store `guest_mobile` only as long as the BRD permits (event + 90 days) and note in a comment where the deletion job would live — do **not** silently keep it forever.

- [ ] **Step 4: Run the suite and commit**

```bash
git add services/api-gateway/src/routes/guest-booking.js services/api-gateway/src/index.js services/api-gateway/src/__tests__/guest-booking.test.js
git commit -m "feat(api): public guest stall booking with SMS receipt"
```

---

### Task 8: Events listing with the BRD's filters

**Files:**
- Modify: `services/api-gateway/src/routes/community-events.js`
- Test: `services/api-gateway/src/__tests__/events-filters.test.js`

**Interfaces:**
- Produces: `GET /community-events?filter=all|upcoming|stalls|donations|past`; every event gains `hasStalls`, `hasDonations`, `isFeatured`, `coverUrl`, `stallsAvailable`; `POST /admin/events/:id/feature` (admin).

- [ ] **Step 1: Write the failing test**

Cover each filter value; an unknown filter is a 400 and never reaches SQL; `stalls` returns only events with an available stall (not merely `has_stalls`); featuring an event **unfeatures** the previous one (the partial unique index from Task 1 enforces one per community — assert the route cooperates rather than 500ing on 23505); `past` events are listed but flagged unbookable.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

Preserve the existing `scope=upcoming|past` parameter — **the shipped Basera app sends it.** Add `filter` alongside it; when both are absent behave exactly as today.

- [ ] **Step 4: Run the suite and commit**

```bash
git add services/api-gateway/src/routes/community-events.js services/api-gateway/src/__tests__/events-filters.test.js
git commit -m "feat(api): event commerce filters and featured event"
```

---

### Task 9: Admin Portal — events, stall layout, donation funds

**Files:**
- Create: `apps/admin-portal/app/community-events/page.tsx`
- Create: `apps/admin-portal/components/StallLayoutBuilder.tsx`
- Modify: `apps/admin-portal/components/Sidebar.tsx`, `apps/admin-portal/lib/api.ts`

- [ ] **Step 1: Build the page**

Mirror `app/units/page.tsx` for loading, error and table patterns — do not invent new ones. The page lists events, creates one, toggles Featured, opens the stall layout builder, generates a guest link (with copy-to-clipboard), and creates a donation fund.

**Use `next/link` for the nav entry, never a raw `<a href>`** — the portal runs under `basePath: '/admin'`, which Next applies to `Link` but not to a raw anchor. That bug has already shipped once in this portal.

`apiFetch` already attaches `X-Community-Id` from localStorage; a super-admin's token carries `community_id: null`, so anything server-side must read the header. Verify rather than assume.

- [ ] **Step 2: The layout builder**

A grid where the admin sets rows × columns, then assigns each cell a type (Standard / Premium / Corner) and a price, and saves the whole layout to `POST /admin/events/:id/stalls`. Stall codes are generated `A1`, `A2`, `B1`… from the grid position.

- [ ] **Step 3: Verify**

Run `pnpm --filter admin-portal typecheck`. Note that `pnpm --filter admin-portal lint` is **not runnable in this repo** — the script is `next lint` with no ESLint config, and it drops into an interactive setup prompt. Use `tsc --noEmit` and say so in your report.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/app/community-events/page.tsx apps/admin-portal/components/StallLayoutBuilder.tsx apps/admin-portal/components/Sidebar.tsx apps/admin-portal/lib/api.ts
git commit -m "feat(portal): event, stall layout and donation fund management"
```

---

### Task 10: Admin Portal — bookings, donors, settlement

**Files:**
- Create: `apps/admin-portal/app/community-events/[id]/page.tsx`
- Modify: `services/api-gateway/src/routes/stalls.js`, `src/routes/donations.js`
- Test: `services/api-gateway/src/__tests__/settlement.test.js`

**Interfaces:**
- Produces: `GET /admin/events/:id/bookings`, `GET /admin/settlement?from=&to=` → `{ stallFeesPaise, platformFeesPaise, netToRwaPaise, rows[] }`.

- [ ] **Step 1: Write the failing settlement test**

The BRD wants "stall fees collected, platform fees deducted, net settled to RWA". Assert: only **paid** orders count; `net = stallFees - platformFees` exactly, in integer paise, with no float drift across many rows; donations appear with **zero** platform fee and settle 100% to the RWA; the range is inclusive of its bounds.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement the endpoints and the page**

The bookings dashboard shows stall code, booker (resident + flat, or guest name + phone), amount, time and payment status. The donor list shows fund, donor, flat/phone, amount and timestamp, with CSV export.

- [ ] **Step 4: Run everything and commit**

```bash
git add apps/admin-portal/app/community-events/[id]/page.tsx services/api-gateway/src/routes/stalls.js services/api-gateway/src/routes/donations.js services/api-gateway/src/__tests__/settlement.test.js
git commit -m "feat: bookings dashboard, donor list and settlement report"
```

---

## Deferred to the Basera app plan

The Events tab rebuild — filter chips, featured hero card, the stall map with type filters, the booking summary with its fee line item, the donation card with goal progress and quick-select amounts, and the Razorpay checkout (reusing `DuesScreen`'s existing guarded `react-native-razorpay` pattern).

## Not in this module

Per the BRD's own out-of-scope list: RSVP/headcount changes (RSVP already exists and is untouched), in-app paid ticketing, vendor ratings, multi-day stall bookings, and the refund flow (manual RWA process for v1.0).

## Open BRD questions carried into this plan

1. **OQ-01 settlement architecture** — Razorpay Route (split payments) vs manual payout is unresolved. This plan **records** what is owed to whom (`payment_orders.platform_fee_paise` and the settlement report) but does not move money to the RWA. Wiring Route or a payout API is a follow-up once the account question is answered.
2. **OQ-03 WhatsApp vs SMS receipts** — this plan sends SMS via the existing `msg91` lib. WhatsApp Business API is not integrated.
3. **OQ-04 stall layout shape** — implemented as a free-form rows × columns grid with per-cell type and price, which covers a fixed template as a special case.
4. **OQ-05 refund policy** — out of scope for v1.0 by the BRD's own decision; there is no refund endpoint and `released` exists only for an unpaid reservation.
