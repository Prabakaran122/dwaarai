# Community BRD Closeout + Events Resident UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the eight open Community BRD requirements and build the Events resident UI (stall booking, donations, Razorpay checkout) that the Events BRD specifies but which was never built.

**Architecture:** Part A is backend-heavy work in the existing api-gateway route/cron/migration structure plus small resident-app additions. Part B is almost entirely resident-app client work against an already-complete, already-tested events-commerce backend, plus one new payment-status endpoint. Both follow the repo's existing conventions: one route file per domain, one zustand store per domain, screens swapped by local state (the app has no navigation stack).

**Tech Stack:** Node 20 ESM + Express + Postgres (vitest), Expo/React Native + zustand (jest), `react-native-razorpay`, msg91, FCM via Expo push.

**Spec:** `docs/superpowers/specs/2026-08-21-community-closeout-and-events-ui-design.md`

## Global Constraints

- Money is integer paise everywhere; never floats. Platform fee is 3% of the stall fee rounded to whole rupees, and never applied to donations (`lib/money.js`).
- Role checks are server-side. Committee status is read fresh via `resolveCaller()` in `lib/committee.js` — **never** from the JWT.
- The installed Basera APK must keep working: `priority` accepts `normal|urgent` forever, and `closesAt` stays optional server-side.
- Brand tokens only: Deep Ocean `#1B3A4B`, Gate Teal `#00BFA6`, Amber `#F59E0B`, Mist `#E8F4F8`. Use `src/theme/` tokens, never literals.
- Every new test name carries its BRD ID (e.g. `F-22`, `FR-STL-04`).
- `ANNOUNCEMENT_SMS_ENABLED` defaults to off. An SMS failure must never fail the publish.
- Migrations are sequential and idempotent; a second run must be a no-op (CI enforces).

---

## File Structure

**Part A — api-gateway**
- Modify `src/routes/polls.js` — future-dated `closesAt` validation (F-14)
- Create `src/cron/close-polls.js` — auto-close + summary push (F-19)
- Modify `src/index.js` — wire both new crons
- Modify `src/lib/fcm.js` — `sendToMultiple` gains an options arg (F-21)
- Modify `src/routes/notices.js` — tiers, `publishNotice()`, pin cap, replies gate (F-21, F-22, F-25)
- Create `src/routes/trending.js` — `GET /community/trending` (F-06)
- Create `migrations/042_notice_scheduling.sql` — `scheduled_at`, `replies_enabled` (F-24, F-25)
- Create `src/cron/publish-notices.js` — release scheduled announcements (F-24)

**Part A — resident-app**
- Modify `src/screens/PollCreateScreen.tsx` — required closing date (F-14)
- Modify `src/screens/ComposeSheet.tsx` — priority picker + live preview (F-21, F-23)
- Modify `src/screens/CommunityScreen.tsx` — trending chips (F-06)

**Part B — api-gateway**
- Create `src/routes/payment-orders.js` — `GET /payment-orders/:id` (B2)

**Part B — resident-app**
- Modify `src/api/client.ts` — events commerce endpoints
- Create `src/store/eventsStore.ts` — events/stalls/donations state
- Create `src/lib/checkout.ts` — Razorpay soft-require + confirm polling
- Rewrite `src/screens/EventsScreen.tsx` — chips, hero, tagged cards, donation card
- Create `src/screens/StallBookingScreen.tsx` — map, filters, summary, pay
- Create `src/screens/DonateSheet.tsx` — progress, quick amounts, pay
- Create `src/screens/BookingConfirmationScreen.tsx`
- Modify `app/index.tsx` — Events tab new-content dot (B5)

---

### Task 1: Poll closing date must be in the future (F-14)

**Files:**
- Modify: `services/api-gateway/src/routes/polls.js`
- Test: `services/api-gateway/src/__tests__/community.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `POST /polls` rejects a past `closesAt` with 400; absent `closesAt` still succeeds

- [x] **Step 1: Write the failing tests**

```js
it('F-14: rejects a poll whose closesAt is already in the past', async () => {
  const res = await request(app).post('/api/v1/polls')
    .set('Authorization', `Bearer ${committeeToken}`)
    .send({ question: 'Gym timings?', options: ['6am', '7am'],
            closesAt: new Date(Date.now() - 3600_000).toISOString() });
  expect(res.status).toBe(400);
});

it('F-14: still accepts a poll with no closesAt (installed APK compatibility)', async () => {
  const res = await request(app).post('/api/v1/polls')
    .set('Authorization', `Bearer ${committeeToken}`)
    .send({ question: 'Gym timings?', options: ['6am', '7am'] });
  expect(res.status).toBe(201);
});
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm --filter api-gateway exec vitest run src/__tests__/community.test.js -t "F-14"`
Expected: the past-date test FAILS with 201 instead of 400.

- [x] **Step 3: Add the validation**

> **Correction, found during execution:** this validation already existed.
> `routes/polls.js` rejects a non-date with 400 and a past date with 422 in the
> handler, not the schema — the audit that produced this plan read only the
> zod line. F-14's real gap was the client never requiring a date at all, so
> the work moved to Task 8; the server was left alone and the tests below were
> kept as a regression guard on behaviour nothing had pinned.

In the `createSchema`, replace `closesAt: z.string().optional()` with:

```js
closesAt: z.string().datetime({ offset: true })
  .refine((s) => new Date(s) > new Date(), { message: 'closesAt must be in the future' })
  .optional(),
```

- [x] **Step 4: Run to verify they pass**

Run: `pnpm --filter api-gateway exec vitest run src/__tests__/community.test.js`
Expected: PASS, and every pre-existing test in the file still passes.

- [x] **Step 5: Commit**

```bash
git add services/api-gateway/src/routes/polls.js services/api-gateway/src/__tests__/community.test.js
git commit -m "feat(api): reject poll closing dates in the past (F-14)"
```

---

### Task 2: Poll auto-close cron with summary push (F-19)

**Files:**
- Create: `services/api-gateway/src/cron/close-polls.js`
- Modify: `services/api-gateway/src/index.js`
- Test: `services/api-gateway/src/__tests__/close-polls.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `closeDuePolls(): Promise<number>` (count closed), `startPollCloseCron(): void`

- [x] **Step 1: Write the failing test**

```js
import { closeDuePolls } from '../cron/close-polls.js';

it('F-19: closes polls past closes_at and notifies eligible voters once', async () => {
  const n = await closeDuePolls();
  expect(n).toBe(1);
  expect(sendToMultiple).toHaveBeenCalledTimes(1);
});

it('F-19: leaves polls whose closes_at is still in the future alone', async () => {
  expect(await closeDuePolls()).toBe(0);
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter api-gateway exec vitest run src/__tests__/close-polls.test.js`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

Follow `src/cron/generate-visits.js` exactly for structure and logging prefix. `closeDuePolls()` selects `id, question, community_id` from polls where `closes_at < NOW() AND status <> 'closed'`, updates each to `closed`, then pushes a summary. Wrap the push in try/catch so a notification failure never blocks the state flip — the close is the product, the push is a courtesy. Schedule with `cron.schedule('*/5 * * * *', ...)` in `startPollCloseCron()`.

- [x] **Step 4: Run to verify it passes**

Run: `pnpm --filter api-gateway exec vitest run src/__tests__/close-polls.test.js`
Expected: PASS

- [x] **Step 5: Wire into index.js next to `startVisitCron()` and commit**

```bash
git add services/api-gateway/src/cron/close-polls.js services/api-gateway/src/index.js services/api-gateway/src/__tests__/close-polls.test.js
git commit -m "feat(api): auto-close due polls and push a result summary (F-19)"
```

---

### Task 3: Push options on sendToMultiple (F-21 groundwork)

**Files:**
- Modify: `services/api-gateway/src/lib/fcm.js`
- Test: `services/api-gateway/src/__tests__/fcm-options.test.js`

**Interfaces:**
- Produces: `sendToMultiple(tokens, title, body, data = {}, opts = {})` where `opts` is `{ priority?: 'default'|'high', sound?: 'default'|null }`, defaulting to `high`/`default` so every existing caller is unchanged.

- [x] **Step 1: Write the failing test**

```js
it('F-21: defaults to high priority with sound so existing callers are unchanged', async () => {
  await sendToMultiple(['tok'], 't', 'b');
  expect(captured[0]).toMatchObject({ priority: 'high', sound: 'default' });
});

it('F-21: honours a normal-priority silent push', async () => {
  await sendToMultiple(['tok'], 't', 'b', {}, { priority: 'default', sound: null });
  expect(captured[0]).toMatchObject({ priority: 'default', sound: null });
});
```

- [x] **Step 2: Run to verify it fails**
- [x] **Step 3: Add the `opts` parameter, defaulting `priority: 'high'`, `sound: 'default'`**
- [x] **Step 4: Run the whole api-gateway suite** — this touches a shared helper, so `pnpm --filter api-gateway test` must stay fully green, not just the new file.
- [x] **Step 5: Commit**

```bash
git commit -am "refactor(api): let sendToMultiple take push priority and sound (F-21)"
```

---

### Task 4: Three announcement priority tiers with env-gated SMS (F-21)

**Files:**
- Modify: `services/api-gateway/src/routes/notices.js`
- Test: `services/api-gateway/src/__tests__/notice-priority.test.js`

**Interfaces:**
- Consumes: `sendToMultiple(..., opts)` from Task 3
- Produces: `NOTICE_PRIORITIES = ['normal','important','urgent']`, `normalisePriority(input)`, `deliveryFor(priority)` returning `{ push: 'default'|'high', sound, sms: boolean }`, and `publishNotice(notice, communityId)` which performs all delivery.

Delivery matrix — note the approved deviation: General **keeps** push.

| priority | push | sound | sms |
|---|---|---|---|
| `normal` (alias `general`) | `default` | none | no |
| `important` | `high` | yes | no |
| `urgent` | `high` | yes | yes, if `ANNOUNCEMENT_SMS_ENABLED` |

- [x] **Step 1: Write the failing tests**

```js
it("F-21: maps the BRD's 'general' onto the stored 'normal'", () => {
  expect(normalisePriority('general')).toBe('normal');
});

it('F-21: General still pushes, quietly (approved deviation from the BRD)', () => {
  expect(deliveryFor('normal')).toEqual({ push: 'default', sound: null, sms: false });
});

it('F-21: Important pushes with sound and sends no SMS', () => {
  expect(deliveryFor('important')).toEqual({ push: 'high', sound: 'default', sms: false });
});

it('F-21: Urgent requests SMS', () => {
  expect(deliveryFor('urgent').sms).toBe(true);
});

it('F-21: an SMS failure does not fail the publish', async () => {
  process.env.ANNOUNCEMENT_SMS_ENABLED = 'true';
  sendTransactionalSMS.mockRejectedValue(new Error('MSG91 down'));
  const res = await request(app).post('/api/v1/notices')
    .set('Authorization', `Bearer ${committeeToken}`)
    .send({ title: 'Water cut', body: 'From 9am', category: 'official', priority: 'urgent' });
  expect(res.status).toBe(201);
});

it('F-21: sends no SMS while ANNOUNCEMENT_SMS_ENABLED is off', async () => {
  delete process.env.ANNOUNCEMENT_SMS_ENABLED;
  await request(app).post('/api/v1/notices').set('Authorization', `Bearer ${committeeToken}`)
    .send({ title: 'Water cut', body: 'From 9am', category: 'official', priority: 'urgent' });
  expect(sendTransactionalSMS).not.toHaveBeenCalled();
});

it('F-21: still accepts the installed APK vocabulary', async () => {
  for (const priority of ['normal', 'urgent']) {
    const res = await request(app).post('/api/v1/notices')
      .set('Authorization', `Bearer ${committeeToken}`)
      .send({ title: 't', body: 'b', category: 'official', priority });
    expect(res.status).toBe(201);
  }
});
```

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement.** Extend `NOTICE_PRIORITIES`, accept `general` in the zod enum and normalise before insert, extract the existing inline push block into `publishNotice()`, and add the SMS branch guarded by `isConfigured()` and the env flag. Keep `isUrgent()` exported — the feed's rendering rule already uses it.
- [x] **Step 4: Run to verify they pass**
- [x] **Step 5: Commit**

```bash
git commit -am "feat(api): three announcement tiers with env-gated urgent SMS (F-21)"
```

---

### Task 5: Cap pinned announcements at three (F-22)

**Files:**
- Modify: `services/api-gateway/src/routes/notices.js`
- Test: `services/api-gateway/src/__tests__/notice-priority.test.js`

- [x] **Step 1: Write the failing test**

```js
it('F-22: pinning a fourth announcement unpins the oldest', async () => {
  for (const t of ['one', 'two', 'three', 'four']) {
    await request(app).post('/api/v1/notices').set('Authorization', `Bearer ${committeeToken}`)
      .send({ title: t, body: 'b', category: 'official' });
  }
  const pinned = await queryRows('SELECT title FROM notices WHERE is_pinned = true ORDER BY created_at');
  expect(pinned.map((p) => p.title)).toEqual(['two', 'three', 'four']);
});
```

- [x] **Step 2: Run to verify it fails** — expect four pinned rows.
- [x] **Step 3: Implement** in the same transaction as the insert:

```sql
UPDATE notices SET is_pinned = false
 WHERE community_id = $1 AND category = 'official' AND is_pinned = true
   AND id NOT IN (
     SELECT id FROM notices
      WHERE community_id = $1 AND category = 'official' AND is_pinned = true
      ORDER BY created_at DESC LIMIT 3)
```

- [x] **Step 4: Run to verify it passes**
- [x] **Step 5: Commit**

```bash
git commit -am "feat(api): keep at most three pinned announcements (F-22)"
```

---

### Task 6: Scheduling and replies toggle (F-24, F-25)

**Files:**
- Create: `services/api-gateway/migrations/042_notice_scheduling.sql`
- Create: `services/api-gateway/src/cron/publish-notices.js`
- Modify: `services/api-gateway/src/routes/notices.js`, `src/index.js`
- Test: `services/api-gateway/src/__tests__/notice-scheduling.test.js`

**Interfaces:**
- Consumes: `publishNotice()` from Task 4
- Produces: `releaseDueNotices(): Promise<number>`, `startNoticePublishCron(): void`

- [x] **Step 1: Write the migration**

```sql
-- Scheduled announcements (F-24) and per-post reply control (F-25).
ALTER TABLE notices ADD COLUMN IF NOT EXISTS scheduled_at    TIMESTAMPTZ;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS replies_enabled BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_notices_scheduled ON notices(scheduled_at) WHERE scheduled_at IS NOT NULL;
```

- [x] **Step 2: Write the failing tests**

```js
it('F-24: a future-scheduled announcement is withheld from residents', async () => {
  await createScheduled({ at: future });
  const res = await request(app).get('/api/v1/notices').set('Authorization', `Bearer ${residentToken}`);
  expect(res.body.data.find((n) => n.title === 'Scheduled')).toBeUndefined();
});

it('F-24: committee members see it with a scheduled marker', async () => {
  const res = await request(app).get('/api/v1/notices').set('Authorization', `Bearer ${committeeToken}`);
  expect(res.body.data.find((n) => n.title === 'Scheduled').scheduledAt).toBeTruthy();
});

it('F-24: scheduling does not notify at creation time', async () => {
  await createScheduled({ at: future });
  expect(sendToMultiple).not.toHaveBeenCalled();
});

it('F-24: the cron releases it and notifies exactly once', async () => {
  await createScheduled({ at: past });
  expect(await releaseDueNotices()).toBe(1);
  expect(sendToMultiple).toHaveBeenCalledTimes(1);
  expect(await releaseDueNotices()).toBe(0);
});

it('F-25: replies are rejected when the author disabled them', async () => {
  const id = await createNotice({ repliesEnabled: false });
  const res = await request(app).post(`/api/v1/notices/${id}/replies`)
    .set('Authorization', `Bearer ${residentToken}`).send({ body: 'hi' });
  expect(res.status).toBe(403);
});

it('F-25: replies stay enabled by default', async () => {
  const id = await createNotice({});
  const res = await request(app).post(`/api/v1/notices/${id}/replies`)
    .set('Authorization', `Bearer ${residentToken}`).send({ body: 'hi' });
  expect(res.status).toBe(201);
});
```

- [x] **Step 3: Run to verify they fail**
- [x] **Step 4: Implement.** Add `scheduledAt` and `repliesEnabled` to `createSchema` and `shapeNotice`; filter `scheduled_at IS NULL OR scheduled_at <= NOW()` from resident list queries; skip `publishNotice()` when scheduling; `releaseDueNotices()` clears `scheduled_at` and calls `publishNotice()`; reply route 403s when `replies_enabled` is false.
- [x] **Step 5: Verify migration idempotency**

Run: `pnpm --filter api-gateway migrate` twice. Expected: the second run prints "up to date".

- [x] **Step 6: Commit**

```bash
git add -A services/api-gateway
git commit -m "feat(api): scheduled announcements and per-post replies toggle (F-24, F-25)"
```

---

### Task 7: Trending topics (F-06)

**Files:**
- Create: `services/api-gateway/src/routes/trending.js`
- Modify: `services/api-gateway/src/index.js`
- Test: `services/api-gateway/src/__tests__/trending.test.js`

**Interfaces:**
- Produces: `GET /community/trending` → `{ data: [{ term, count }] }`, max 5; `STOPWORDS: Set<string>`; `topTerms(titles, limit)` pure and exported for unit testing.

- [x] **Step 1: Write the failing tests**

```js
it('F-06: returns at most five terms', () => {
  expect(topTerms(['a b c d e f g h'], 5).length).toBeLessThanOrEqual(5);
});

it('F-06: excludes stopwords and very short words', () => {
  const terms = topTerms(['The water is for the block', 'the water'], 5).map((t) => t.term);
  expect(terms).toContain('water');
  expect(terms).not.toContain('the');
  expect(terms).not.toContain('is');
});

it('F-06: ranks by frequency', () => {
  expect(topTerms(['water water lift'], 5)[0].term).toBe('water');
});
```

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement.** Query titles from notices and issues over 7 days for the caller's community, lowercase, split on non-letters, drop stopwords and words under 3 characters, count, sort desc, take 5.
- [x] **Step 4: Run to verify they pass**
- [x] **Step 5: Commit**

```bash
git add -A services/api-gateway && git commit -m "feat(api): trending community topics (F-06)"
```

---

### Task 8: Resident-app Community UI — required close date, priority picker, live preview, trending chips (F-14, F-21, F-23, F-06)

**Files:**
- Modify: `apps/resident-app/src/screens/PollCreateScreen.tsx`, `src/screens/ComposeSheet.tsx`, `src/screens/CommunityScreen.tsx`, `src/store/communityStore.ts`, `src/api/client.ts`
- Test: `apps/resident-app/src/screens/ComposeSheet.test.tsx`, `src/screens/PollCreateScreen.test.tsx`

- [x] **Step 1: Write the failing tests**

```tsx
it('F-14: keeps Post poll disabled until a future closing date is set', () => {
  const { getByText } = render(<PollCreateScreen onClose={jest.fn()} />);
  expect(getByText('Post poll').props.accessibilityState.disabled).toBe(true);
});

it('F-23: previews the announcement as the committee member types', () => {
  const { getByPlaceholderText, getByTestId } = render(<ComposeSheet kind="announcement" />);
  fireEvent.changeText(getByPlaceholderText('Title'), 'Water cut');
  expect(getByTestId('announcement-preview')).toHaveTextContent('Water cut');
});

it('F-21: offers all three priority tiers', () => {
  const { getByText } = render(<ComposeSheet kind="announcement" />);
  ['General', 'Important', 'Urgent'].forEach((t) => expect(getByText(t)).toBeTruthy());
});
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm --filter resident-app exec jest src/screens/ComposeSheet.test.tsx src/screens/PollCreateScreen.test.tsx`

- [x] **Step 3: Implement.** Poll close date defaults to today + 7 days and gates the submit button. ComposeSheet gains a three-chip priority selector (announcement tab only) and renders the real feed card component as a live preview. CommunityScreen renders trending chips above the feed that set the existing filter.
- [x] **Step 4: Run to verify they pass, then the full resident-app suite**
- [x] **Step 5: Commit**

```bash
git add -A apps/resident-app && git commit -m "feat(app): poll close date, priority tiers, live preview, trending chips"
```

---

### Task 9: Payment status endpoint (B2)

**Files:**
- Create: `services/api-gateway/src/routes/payment-orders.js`
- Modify: `services/api-gateway/src/index.js`
- Test: `services/api-gateway/src/__tests__/payment-orders.test.js`

**Interfaces:**
- Produces: `GET /payment-orders/:id` → `{ id, purpose, status, amountPaise, platformFeePaise, subjectId, testMode }`, resident-scoped to their own community.

- [x] **Step 1: Write the failing tests**

```js
it('FR-STL-07: reports a paid order so the app can confirm from the server', async () => {
  const res = await request(app).get(`/api/v1/payment-orders/${paidOrderId}`)
    .set('Authorization', `Bearer ${residentToken}`);
  expect(res.status).toBe(200);
  expect(res.body.data.status).toBe('paid');
});

it('FR-STL-07: does not leak an order from another community', async () => {
  const res = await request(app).get(`/api/v1/payment-orders/${otherCommunityOrderId}`)
    .set('Authorization', `Bearer ${residentToken}`);
  expect(res.status).toBe(404);
});
```

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement.** Single select from `payment_orders` filtered by `id` **and** `community_id = user.community_id`. Return 404, not 403, for a foreign order — a 403 confirms the id exists.
- [x] **Step 4: Run to verify they pass**
- [x] **Step 5: Commit**

```bash
git add -A services/api-gateway && git commit -m "feat(api): payment order status endpoint for booking confirmation"
```

---

### Task 10: Checkout helper and API client (B1)

**Files:**
- Create: `apps/resident-app/src/lib/checkout.ts`
- Modify: `apps/resident-app/package.json`, `src/api/client.ts`
- Test: `apps/resident-app/src/lib/checkout.test.ts`

**Interfaces:**
- Produces: `payWithRazorpay(order, user): Promise<{ ok: boolean; reason?: 'unavailable'|'cancelled'|'failed' }>` and `confirmPayment(orderId, { attempts, delayMs }): Promise<'paid'|'pending'|'failed'>`
- API client: `getEventsFeed(filter)`, `getStalls(eventId)`, `bookStall(eventId, stallId)`, `getDonationFunds()`, `donate(fundId, amountPaise)`, `getPaymentOrder(id)`

- [x] **Step 1: Add the dependency**

```bash
pnpm --filter resident-app add react-native-razorpay
```

- [x] **Step 2: Write the failing tests**

```ts
it('FR-STL-05: reports unavailable when the native module is absent', async () => {
  jest.mock('react-native-razorpay', () => { throw new Error('missing'); });
  expect((await payWithRazorpay(order, user)).reason).toBe('unavailable');
});

it('FR-STL-07: polls until the webhook marks the order paid', async () => {
  getPaymentOrder.mockResolvedValueOnce({ data: { data: { status: 'created' } } })
                 .mockResolvedValueOnce({ data: { data: { status: 'paid' } } });
  await expect(confirmPayment('o1', { attempts: 3, delayMs: 0 })).resolves.toBe('paid');
});

it('FR-STL-07: gives up as pending rather than claiming success', async () => {
  getPaymentOrder.mockResolvedValue({ data: { data: { status: 'created' } } });
  await expect(confirmPayment('o1', { attempts: 2, delayMs: 0 })).resolves.toBe('pending');
});
```

- [x] **Step 3: Run to verify they fail**
- [x] **Step 4: Implement.** Reuse the `getRazorpayCheckout()` soft-require shape already in `DuesScreen.tsx` — move it into `checkout.ts` and have DuesScreen import it, so there is one copy. `confirmPayment` polls `GET /payment-orders/:id`; never treat the SDK callback alone as proof of payment.
- [x] **Step 5: Run to verify they pass**
- [x] **Step 6: Commit**

```bash
git add -A apps/resident-app && git commit -m "feat(app): razorpay checkout helper and events API client"
```

---

### Task 11: eventsStore (B3)

**Files:**
- Create: `apps/resident-app/src/store/eventsStore.ts`
- Test: `apps/resident-app/src/store/eventsStore.test.ts`

**Interfaces:**
- Produces: `useEventsStore` with `{ events, featured, stalls, funds, filter, loading, error, fetch(), setFilter(f), fetchStalls(eventId), book(eventId, stallId), donate(fundId, paise) }`
- Types: `EventItem { id, title, startsAt, location, hasStalls, hasDonations, isFeatured, coverPath }`, `Stall { id, code, stallType, pricePaise, status, rowIndex, colIndex }`, `Fund { id, name, targetPaise, raisedPaise }`

- [x] **Step 1: Write the failing tests**

```ts
it('FR-EVT-03: exposes the featured event separately from the list', async () => {
  await useEventsStore.getState().fetch();
  expect(useEventsStore.getState().featured?.isFeatured).toBe(true);
});

it('FR-EVT-02: refetches when the filter changes', async () => {
  await useEventsStore.getState().setFilter('stalls');
  expect(getEventsFeed).toHaveBeenCalledWith('stalls');
});

it('FR-STL-06: surfaces a lost race as taken rather than a generic failure', async () => {
  bookStall.mockRejectedValue({ response: { status: 409 } });
  await expect(useEventsStore.getState().book('e1', 's1')).resolves.toMatchObject({ error: 'taken' });
});
```

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement** following `communityStore.ts` conventions.
- [x] **Step 4: Run to verify they pass**
- [x] **Step 5: Commit**

```bash
git add -A apps/resident-app && git commit -m "feat(app): events store for stalls and donations"
```

---

### Task 12: EventsScreen rebuild (FR-EVT-01..04)

**Files:**
- Rewrite: `apps/resident-app/src/screens/EventsScreen.tsx`
- Modify: `apps/resident-app/src/components/EventCard.tsx`
- Test: `apps/resident-app/src/screens/EventsScreen.test.tsx`

- [x] **Step 1: Write the failing tests**

```tsx
it('FR-EVT-02: offers all five filter chips', () => {
  const { getByText } = render(<EventsScreen />);
  ['All', 'Upcoming', 'Stall Booking', 'Donations', 'Past']
    .forEach((c) => expect(getByText(c)).toBeTruthy());
});

it('FR-EVT-03: renders the featured event as a hero above the list', () => {
  expect(render(<EventsScreen />).getByTestId('featured-hero')).toBeTruthy();
});

it('FR-EVT-04: tags an event that has stalls and donations', () => {
  const { getByText } = render(<EventsScreen />);
  expect(getByText('Stalls available')).toBeTruthy();
  expect(getByText('Donations open')).toBeTruthy();
});
```

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement** using theme tokens only; horizontally scrollable chips, active chip underlined in Amber.
- [x] **Step 4: Run to verify they pass**
- [x] **Step 5: Commit**

```bash
git add -A apps/resident-app && git commit -m "feat(app): rebuild Events tab with filters, hero and tags"
```

---

### Task 13: StallBookingScreen (FR-STL-01..08)

**Files:**
- Create: `apps/resident-app/src/screens/StallBookingScreen.tsx`
- Test: `apps/resident-app/src/screens/StallBookingScreen.test.tsx`

- [x] **Step 1: Write the failing tests**

```tsx
it('FR-STL-02: marks the tapped stall selected', () => {
  const { getByText, getByTestId } = render(<StallBookingScreen eventId="e1" onBack={jest.fn()} />);
  fireEvent.press(getByText('A1'));
  expect(getByTestId('stall-A1').props.accessibilityState.selected).toBe(true);
});

it('FR-STL-03: selecting a second stall replaces the first', () => {
  const { getByText, getByTestId } = render(<StallBookingScreen eventId="e1" onBack={jest.fn()} />);
  fireEvent.press(getByText('A1'));
  fireEvent.press(getByText('A2'));
  expect(getByTestId('stall-A1').props.accessibilityState.selected).toBe(false);
});

it('FR-STL-04: breaks out stall fee, 3% platform fee and total', () => {
  const { getByText } = render(<StallBookingScreen eventId="e1" onBack={jest.fn()} />);
  fireEvent.press(getByText('A1'));           // 2000.00 stall
  expect(getByText('₹60.00')).toBeTruthy();   // 3% platform fee
  expect(getByText('₹2,060.00')).toBeTruthy();
});

it('FR-STL-01: a booked stall cannot be selected', () => {
  const { getByTestId } = render(<StallBookingScreen eventId="e1" onBack={jest.fn()} />);
  expect(getByTestId('stall-B1').props.accessibilityState.disabled).toBe(true);
});
```

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement.** Grid from `rowIndex`/`colIndex`; available/selected/taken colour states; type chips fade non-matching stalls to 30% opacity; a 409 renders "That stall was just taken" and refetches the map.
- [x] **Step 4: Run to verify they pass**
- [x] **Step 5: Commit**

```bash
git add -A apps/resident-app && git commit -m "feat(app): stall booking screen with map and fee breakdown"
```

---

### Task 14: DonateSheet and BookingConfirmationScreen (FR-DON-02/03, FR-STL-07)

**Files:**
- Create: `apps/resident-app/src/screens/DonateSheet.tsx`, `src/screens/BookingConfirmationScreen.tsx`
- Test: `apps/resident-app/src/screens/DonateSheet.test.tsx`

- [x] **Step 1: Write the failing tests**

```tsx
it('FR-DON-03: offers the four quick amounts and a custom field', () => {
  const { getByText, getByPlaceholderText } = render(<DonateSheet fundId="f1" onClose={jest.fn()} />);
  ['₹51', '₹101', '₹251', '₹501'].forEach((a) => expect(getByText(a)).toBeTruthy());
  expect(getByPlaceholderText('Other amount')).toBeTruthy();
});

it('FR-DON-04: shows no platform fee on a donation', () => {
  const { queryByText } = render(<DonateSheet fundId="f1" onClose={jest.fn()} />);
  expect(queryByText(/platform fee/i)).toBeNull();
});

it('FR-DON-02: renders progress toward the target', () => {
  expect(render(<DonateSheet fundId="f1" onClose={jest.fn()} />).getByTestId('fund-progress')).toBeTruthy();
});
```

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement.** Confirmation screen shows stall code, event, date and amount, and is reached only after `confirmPayment()` returns `paid`; a `pending` result shows "Payment is confirming" rather than a success screen.
- [x] **Step 4: Run to verify they pass**
- [x] **Step 5: Commit**

```bash
git add -A apps/resident-app && git commit -m "feat(app): donation sheet and booking confirmation"
```

---

### Task 15: Events tab new-content dot (FR-EVT-05)

**Files:**
- Modify: `apps/resident-app/app/index.tsx`
- Test: `apps/resident-app/src/store/eventsStore.test.ts`

**Interfaces:**
- Produces: `hasUnseenEvents(newestCreatedAt, lastSeenIso): boolean`, pure and exported so the rule is testable without rendering the tab bar.

- [x] **Step 1: Write the failing tests**

```ts
it('FR-EVT-05: dots the tab when an event is newer than the last visit', () => {
  expect(hasUnseenEvents('2026-08-21T10:00:00Z', '2026-08-20T10:00:00Z')).toBe(true);
});

it('FR-EVT-05: no dot when nothing is newer', () => {
  expect(hasUnseenEvents('2026-08-19T10:00:00Z', '2026-08-20T10:00:00Z')).toBe(false);
});

it('FR-EVT-05: dots on first ever visit', () => {
  expect(hasUnseenEvents('2026-08-19T10:00:00Z', null)).toBe(true);
});
```

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement.** Last-seen ISO string in AsyncStorage, written when the Events tab opens. The existing `dot` style in the tab bar is the active-tab indicator — use a distinct badge so the two are not confused.
- [x] **Step 4: Run to verify they pass**
- [x] **Step 5: Commit**

```bash
git add -A apps/resident-app && git commit -m "feat(app): unseen-events indicator on the Events tab"
```

---

### Task 16: Full verification, deploy backend, build and publish APK

**Files:** none — verification and release.

- [x] **Step 1: Full suites and typecheck**

```bash
pnpm --filter api-gateway test
pnpm --filter resident-app test
pnpm --filter resident-app typecheck
```
Expected: api-gateway ≥ 557 + new tests, resident-app green, **no new** tsc errors (two pre-existing ones are documented and expected).

- [x] **Step 2: Migration idempotency**

```bash
pnpm --filter api-gateway migrate && pnpm --filter api-gateway migrate
```
Expected: second run reports up to date.

- [x] **Step 3: Deploy the api-gateway to EC2 and apply migration 042**

Back up the DB first. Restart `communitygate-api` and verify the new endpoints return 200.

- [x] **Step 4: Build the APK**

```bash
cd apps/resident-app && eas build -p android --profile preview
```
Bump `version`/`versionCode` first — `react-native-razorpay` is native, so this cannot ship over OTA.

- [x] **Step 5: Publish**

Download the artifact, scp to `/opt/communitygate/landing/apps/dwaar-resident.apk` on EC2, keeping a `.bak-<ts>` of the old one, and verify by md5.

- [x] **Step 6: Commit and open the PR**

---

## Self-Review

**Spec coverage:** A1→T1, A2→T2, A3→T3+T4, A4→T5, A5→T7, A6→T8, A7/A8→T6, B1→T10, B2→T9, B3→T11–T14, B4→T13, B5→T15, delivery→T16. No spec section is unimplemented.

**Placeholders:** none — every code step carries real code or an exact command.

**Type consistency:** `payWithRazorpay`/`confirmPayment` (T10) are consumed by T13/T14 under those names; `getEventsFeed`/`bookStall`/`donate`/`getPaymentOrder` (T10) match the store's calls in T11; `publishNotice()` (T4) is consumed by T6; `sendToMultiple(..., opts)` (T3) is consumed by T4.
