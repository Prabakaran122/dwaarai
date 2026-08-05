# Home & My Unit — BRD Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps between `Dwaar_AI_BRD_Home_MyUnit_v1.docx` and what the Basera app already ships, without rebuilding the substantial parts that already work.

**Architecture:** Both screens, their stores, the aggregate endpoints (`GET /resident/home`, `GET /resident/unit`) and the whole facility-booking stack already exist and are tested. This plan adds a member detail screen, extends face enrolment from self-only to household members, makes the notification bell real, surfaces documents on My Unit, and finishes several P1 items. No screen is rewritten.

**Tech Stack:** Node 20 ESM + Express + Postgres + vitest; React Native 0.76 / Expo SDK 52 + zustand + jest.

**BRD:** `Dwaar_AI_BRD_Home_MyUnit_v1.docx` (extracted text at the path recorded in the SDD ledger).

## What already exists — do NOT rebuild

Verified by survey before this plan was written:

- `HomeScreen` + `homeStore` + `GET /resident/home` — gate glance, recent gate activity, dues snapshot, community strip, quick actions, pull-to-refresh.
- `MyUnitScreen` + `unitStore` + `GET /resident/unit` — unit hero, members, vehicles, pets, dues.
- Facility booking end to end — `FacilityBookingScreen`, `routes/facilities.js`, `facilities` + `facility_bookings` tables. Server enforces the 7-day window, the 1-hour cancellation cutoff, one-booking-per-sport-per-day-per-unit, past-slot rejection, and a unique index against the double-book race.
- `MembersScreen`, `VehiclesScreen`, `DocumentsScreen`, `PetsScreen`, `FaceIdentityScreen` (self only), recurring passes for helpers.

## Global Constraints

- **Navigation is local state, never routes.** One expo-router entry (`app/index.tsx`) with hand-rolled tabs; detail views are `useState` + early `return` with plain props. Follow `MyUnitScreen`'s existing `overlay` pattern.
- **Biometrics: DPDP Act 2023.** `face_enrollments.vector` stores a face **vector only, never an image** (see `016_face_identity.sql:13`). Nothing in this plan may send, store or log a face image server-side. Consent is per-location and withdrawable, recorded per resident.
- **A household member is a `residents` row** (`013_family_members.sql`), and `face_enrollments.resident_id` is `UNIQUE` — so a member's enrolment is just their own row. No schema change is needed for member enrolment.
- Permissions are enforced server-side; hiding a control is presentation.
- The `type` export from `../theme/typography` shadows the TS `type` keyword.
- Use existing theme tokens only; `src/theme/colors.test.ts` pins them.
- Tests: `pnpm --filter api-gateway test` (424 passing) and `pnpm --filter resident-app test` (155 passing) + `typecheck`. No regressions.

---

### Task 1: Member-scoped face enrolment API

Today every `/face` route is scoped to `req.user.sub` — a resident can only ever enrol themselves. The BRD makes "Face ID enrolment trigger from member detail" a **P0**, and the primary owner is expected to enrol household members. The schema already supports it; only the routes are self-only.

**Files:**
- Modify: `services/api-gateway/src/routes/face.js`
- Test: `services/api-gateway/src/__tests__/face-member.test.js`

**Interfaces:**
- Consumes: `queryOne`, `queryRows` from `../db/queries.js`; `authenticateJWT` from `../middleware/auth.js`.
- Produces: `assertSameUnit(queryOne, actorSub, targetResidentId)` exported from `face.js`; `GET /members/:id/face`, `POST /members/:id/face/enroll`, `PUT /members/:id/face/consent`, `DELETE /members/:id/face`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({ default: { query: vi.fn(), connect: vi.fn(), on: vi.fn() } }));
vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn(), sendToMultiple: vi.fn().mockResolvedValue({ successCount: 0 }),
  sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn(),
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); queryOne.mockResolvedValue(null); });

const owner = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1', name: 'Asha' });

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('member face enrolment is scoped to the caller\'s own unit', () => {
  it('refuses a member who belongs to another unit', async () => {
    queryOne.mockResolvedValueOnce(null); // same-unit lookup finds nothing
    const { status } = await call('POST', '/api/v1/members/r9/face/enroll', { vector: [0.1, 0.2] });
    expect(status).toBe(404);
  });

  it('enrols a member of the same unit', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'r2', unit_id: 'u1', name: 'Ravi' }) // same-unit lookup
      .mockResolvedValueOnce({ id: 'f1', resident_id: 'r2', status: 'pending' });
    const { status } = await call('POST', '/api/v1/members/r2/face/enroll', { vector: [0.1, 0.2] });
    expect(status).toBe(201);
  });

  it('never accepts an image, only a vector', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r2', unit_id: 'u1', name: 'Ravi' });
    const { status, json } = await call('POST', '/api/v1/members/r2/face/enroll', { image: 'data:image/jpeg;base64,AAAA' });
    expect(status).toBe(400);
    expect(JSON.stringify(json)).not.toMatch(/base64|data:image/);
  });

  it('reads a member\'s enrolment status', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'r2', unit_id: 'u1', name: 'Ravi' })
      .mockResolvedValueOnce({ status: 'active', enrolled_at: '2026-08-01T00:00:00Z' });
    const { status, json } = await call('GET', '/api/v1/members/r2/face');
    expect(status).toBe(200);
    expect(json.data.status).toBe('active');
  });

  it('withdraws a member\'s enrolment', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'r2', unit_id: 'u1', name: 'Ravi' })
      .mockResolvedValueOnce({ id: 'f1' });
    const { status } = await call('DELETE', '/api/v1/members/r2/face');
    expect(status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test face-member`
Expected: FAIL — the routes 404 because they do not exist.

- [ ] **Step 3: Add the unit guard**

In `services/api-gateway/src/routes/face.js`:

```js
/**
 * A resident may act on another resident's face record ONLY when both live in
 * the same unit. Household members are rows in `residents` (013_family_members),
 * so this is the whole authorisation rule — checked against the database, never
 * against anything the client sent.
 */
export async function assertSameUnit(queryOneFn, actorSub, targetResidentId) {
  return queryOneFn(
    `SELECT t.id, t.unit_id, t.name
       FROM residents t
       JOIN residents a ON a.unit_id = t.unit_id AND a.id = $1
      WHERE t.id = $2 AND t.is_active = true`,
    [actorSub, targetResidentId]
  );
}
```

- [ ] **Step 4: Add the four member-scoped routes**

Mirror the existing self-scoped handlers, replacing `req.user.sub` with the verified target id. Each route starts with:

```js
    const target = await assertSameUnit(queryOne, req.user.sub, req.params.id);
    if (!target) return error(res, 'Member not found', 404);
```

Reject any body carrying an image before touching the database — the vector is the only biometric this system may receive:

```js
    // DPDP Act 2023: a face IMAGE must never reach the server. Only the
    // derived vector is accepted, and it is stored encrypted at rest.
    if (req.body && ('image' in req.body || 'photo' in req.body)) {
      return error(res, 'Face images are not accepted; send the derived vector only', 400);
    }
```

Do not log the vector, and do not echo it back in any response.

- [ ] **Step 5: Run the suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add services/api-gateway/src/routes/face.js services/api-gateway/src/__tests__/face-member.test.js
git commit -m "feat(api): enrol household members for face ID, scoped to the caller's unit"
```

---

### Task 2: Member detail screen with face enrolment

**Files:**
- Create: `apps/resident-app/src/screens/MemberDetailScreen.tsx`
- Modify: `apps/resident-app/src/api/client.ts`
- Modify: `apps/resident-app/src/screens/MyUnitScreen.tsx`
- Test: `apps/resident-app/src/screens/MemberDetailScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1's endpoints.
- Produces client functions `getMemberFace(id)`, `enrollMemberFace(id, vector)`, `setMemberFaceConsent(id, consents)`, `deleteMemberFace(id)`; `MemberDetailScreen` with props `{ member: UnitMember; onBack: () => void }`.

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import MemberDetailScreen from './MemberDetailScreen';
import * as api from '../api/client';

jest.mock('../api/client');

const member: any = { id: 'r2', name: 'Ravi', relationship: 'spouse', isPrimary: false, faceEnrolled: false, appAccess: false };

beforeEach(() => {
  jest.clearAllMocks();
  (api.getMemberFace as jest.Mock).mockResolvedValue({ data: { data: { status: 'not_enrolled', consents: [] } } });
  (api.enrollMemberFace as jest.Mock).mockResolvedValue({ data: { data: { status: 'pending' } } });
  (api.deleteMemberFace as jest.Mock).mockResolvedValue({ data: { data: { ok: true } } });
});

describe('MemberDetailScreen', () => {
  it('shows the member and their enrolment status', async () => {
    const { getByText } = render(<MemberDetailScreen member={member} onBack={() => {}} />);
    await waitFor(() => expect(getByText('Ravi')).toBeTruthy());
    expect(getByText(/Not enrolled/i)).toBeTruthy();
  });

  it('offers enrolment and calls the member-scoped endpoint', async () => {
    const { getByText } = render(<MemberDetailScreen member={member} onBack={() => {}} />);
    await waitFor(() => expect(getByText('Ravi')).toBeTruthy());
    fireEvent.press(getByText(/Enrol face ID/i));
    await waitFor(() => expect(api.enrollMemberFace).toHaveBeenCalledWith('r2', expect.anything()));
  });

  it('offers removal once enrolled, and never renders a raw vector', async () => {
    (api.getMemberFace as jest.Mock).mockResolvedValue({
      data: { data: { status: 'active', consents: ['gate'], vector: [0.1, 0.2] } },
    });
    const { getByText, queryByText, toJSON } = render(<MemberDetailScreen member={member} onBack={() => {}} />);
    await waitFor(() => expect(getByText(/Remove face ID/i)).toBeTruthy());
    expect(queryByText(/0\.1/)).toBeNull();
    expect(JSON.stringify(toJSON())).not.toMatch(/0\.1/);
  });

  it('surfaces a load failure rather than an empty screen', async () => {
    (api.getMemberFace as jest.Mock).mockRejectedValue(new Error('offline'));
    const { getByText } = render(<MemberDetailScreen member={member} onBack={() => {}} />);
    await waitFor(() => expect(getByText(/Could not load/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/screens/MemberDetailScreen.test.tsx`
Expected: FAIL — cannot resolve `./MemberDetailScreen`.

- [ ] **Step 3: Add the client functions**

```ts
export const getMemberFace = (id: string) => api.get(`/members/${id}/face`);
export const enrollMemberFace = (id: string, vector: number[]) =>
  api.post(`/members/${id}/face/enroll`, { vector });
export const setMemberFaceConsent = (id: string, consents: string[]) =>
  api.put(`/members/${id}/face/consent`, { consents });
export const deleteMemberFace = (id: string) => api.delete(`/members/${id}/face`);
```

- [ ] **Step 4: Build the screen**

Follow `FaceIdentityScreen.tsx` for the enrolment affordance and consent toggles, and `NoticeBoardScreen`'s `ThreadView` for the back-prop shape. Render: an `AppBar` with the member's name and `onBack`; the relationship and primary/app-access badges; the Face-ID status; per-location consent toggles (`gate`, `pool`, `clubhouse`, `gym`); an "Enrol face ID" action when not enrolled and "Remove face ID" when active.

The vector is never rendered, never logged, and never stored in component state beyond the call that sends it.

- [ ] **Step 5: Wire it up from My Unit**

In `MyUnitScreen.tsx`, add `const [member, setMember] = useState<UnitMember | null>(null)`, make each `MemberRow` pressable to `setMember(m)`, and early-return `<MemberDetailScreen member={member} onBack={() => { setMember(null); fetch(); }} />` when set — matching the existing `overlay` pattern in that file.

- [ ] **Step 6: Run everything**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/resident-app/src/screens/MemberDetailScreen.tsx apps/resident-app/src/screens/MemberDetailScreen.test.tsx apps/resident-app/src/api/client.ts apps/resident-app/src/screens/MyUnitScreen.tsx
git commit -m "feat(app): member detail screen with face ID enrolment"
```

---

### Task 3: A real notification bell

`HomeScreen.tsx:71` passes `bellCount={0}` — hardcoded, so the badge never appears. The BRD makes the unread count a P1 requirement.

**Files:**
- Modify: `services/api-gateway/src/routes/resident-home.js`
- Modify: `apps/resident-app/src/store/homeStore.ts`
- Modify: `apps/resident-app/src/screens/HomeScreen.tsx`
- Test: `services/api-gateway/src/__tests__/resident-home-unread.test.js`, `apps/resident-app/src/store/homeStore.test.ts`

**Interfaces:**
- Produces: `GET /resident/home` response gains `unreadCount: number`; `HomeSummary` gains `unreadCount`.

- [ ] **Step 1: Decide what "unread" means and write it down**

There is no per-resident read-state table. Rather than inventing one, count what the resident has genuinely not acted on, from data that already exists:
- pending visitor approvals awaiting this resident,
- parcels waiting at the gate for this unit,
- notices created since the resident's last app open is **not** available — do not fake it.

Write the chosen definition as a comment on the query. If you cannot produce a defensible count from existing tables, STOP and report rather than inventing a number — a badge that shows a made-up figure is worse than no badge.

- [ ] **Step 2: Write the failing tests**

Backend: assert `GET /resident/home` returns `unreadCount` and that it is the sum of the sources chosen in Step 1, and that a failure in the unread query degrades to `0` rather than 500ing the whole aggregate (the handler already uses `Promise.allSettled` — preserve that).

Store: assert `useHomeStore.fetch()` surfaces `unreadCount` on `summary`.

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter api-gateway test resident-home-unread` and `pnpm --filter resident-app exec jest src/store/homeStore.test.ts`

- [ ] **Step 4: Implement**

Add the count as another `Promise.allSettled` section in `resident-home.js` so one failing source cannot empty the rest, then thread it through `homeStore` and replace the literal in `HomeScreen.tsx` with `summary?.unreadCount ?? 0`.

- [ ] **Step 5: Run both suites and commit**

```bash
git add services/api-gateway/src/routes/resident-home.js services/api-gateway/src/__tests__/resident-home-unread.test.js apps/resident-app/src/store/homeStore.ts apps/resident-app/src/store/homeStore.test.ts apps/resident-app/src/screens/HomeScreen.tsx
git commit -m "feat: real unread count on the home notification bell"
```

---

### Task 4: Documents on My Unit, and the facility deep link

Two small BRD items. The BRD specifies a **2×2 document grid** on My Unit; today that section is static text. It also specifies that Home's "Book facility" quick action **deep-links into the booking sub-screen** — today it only switches tabs.

**Files:**
- Modify: `apps/resident-app/src/screens/MyUnitScreen.tsx`
- Modify: `apps/resident-app/src/store/unitStore.ts`
- Modify: `services/api-gateway/src/routes/resident-unit.js`
- Modify: `apps/resident-app/src/screens/HomeScreen.tsx`, `apps/resident-app/app/index.tsx`
- Test: `apps/resident-app/src/screens/MyUnitScreen.test.tsx`

**Interfaces:**
- Produces: `GET /resident/unit` response gains `documents: { id, title, category }[]` (most recent 3); `MyUnitScreen` renders a 2×2 grid of three document tiles plus an "Add document" tile; `MyUnitScreen` accepts `initialOverlay?: 'facilities'`.

- [ ] **Step 1: Write the failing test**

```tsx
it('shows document tiles and an add tile', async () => {
  // unitStore mocked to return two documents
  // expect both titles, plus 'Add document', to render
});

it('opens facility booking directly when asked', async () => {
  const { getByText } = render(<MyUnitScreen initialOverlay="facilities" />);
  await waitFor(() => expect(getByText(/Book/i)).toBeTruthy());
});
```

Fill both in against the real component API before implementing.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter resident-app exec jest src/screens/MyUnitScreen.test.tsx`

- [ ] **Step 3: Add documents to the unit aggregate**

In `resident-unit.js`, add a documents section to the existing `Promise.allSettled` set, selecting `id, title, category` from `unit_documents` where `unit_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 3`. Do not return `file_path` — the tile does not need it and it is not the client's business.

- [ ] **Step 4: Render the grid and wire the deep link**

Render the 2×2 grid on `MyUnitScreen` using existing tokens; tapping a tile opens the existing `DocumentsScreen` overlay. Add `initialOverlay` to `MyUnitScreen`, and in `app/index.tsx` set it when the Home quick action fires, clearing it on tab change exactly as `pendingIssueId` is cleared.

- [ ] **Step 5: Run everything and commit**

```bash
git add apps/resident-app/src/screens/MyUnitScreen.tsx apps/resident-app/src/screens/MyUnitScreen.test.tsx apps/resident-app/src/store/unitStore.ts apps/resident-app/src/screens/HomeScreen.tsx apps/resident-app/app/index.tsx services/api-gateway/src/routes/resident-unit.js
git commit -m "feat(app): document grid on My Unit and a direct facility-booking deep link"
```

---

### Task 5: Admin-configurable booking policy + booking push

The BRD makes the booking window, slots-per-flat and cancellation cutoff **admin-configurable** (P1), and requires a **push notification on booking** (P1). Today all three limits are hardcoded in `routes/facilities.js` and no push is sent.

**Files:**
- Create: `services/api-gateway/migrations/040_facility_policy.sql`
- Modify: `services/api-gateway/src/routes/facilities.js`
- Test: `services/api-gateway/src/__tests__/facility-policy.test.js`

**Interfaces:**
- Produces: `facilities` gains `advance_days INT NOT NULL DEFAULT 7`, `cancel_cutoff_minutes INT NOT NULL DEFAULT 60`, `max_per_unit_per_day INT NOT NULL DEFAULT 1`; `bookingPolicy(facility)` exported from `facilities.js`.

- [ ] **Step 1: Write the migration**

```sql
-- Booking limits were hardcoded in routes/facilities.js. The BRD makes them
-- per-society settings, so they move onto the facility row with the previous
-- hardcoded values as defaults — every existing facility keeps behaving
-- exactly as it does today.
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS advance_days           INT NOT NULL DEFAULT 7;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS cancel_cutoff_minutes  INT NOT NULL DEFAULT 60;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS max_per_unit_per_day   INT NOT NULL DEFAULT 1;
```

Check the migrations directory first — **040 must not already be taken.**

- [ ] **Step 2: Write the failing test**

Cover: a facility with `advance_days = 14` accepts a booking 10 days out (today's code rejects it); `cancel_cutoff_minutes = 0` allows cancelling right up to the start; `max_per_unit_per_day = 2` allows a second booking for the same sport on the same day. Each of these fails against the current hardcoded implementation, which is the point.

- [ ] **Step 3: Run it and confirm failure**

Run: `pnpm --filter api-gateway test facility-policy`

- [ ] **Step 4: Read the policy from the row**

Replace the hardcoded `7`, `3600000` and one-per-sport rule with values from the facility row, via a small exported `bookingPolicy(facility)` helper that applies the defaults when a column is null. **Keep every rule server-side** — the BRD is explicit that these are not client-side limits.

- [ ] **Step 5: Send the booking push**

After the booking commits, send an FCM notification via the existing `sendNotification` in `../lib/fcm.js` — **after** the transaction, in its own try/catch, never able to fail the booking. Mirror `notifyIssueResolved` in `routes/issues.js`, which already establishes this shape.

- [ ] **Step 6: Verify idempotency, run the suite, commit**

Apply the migration twice and confirm the second run is a no-op, as CI does.

```bash
git add services/api-gateway/migrations/040_facility_policy.sql services/api-gateway/src/routes/facilities.js services/api-gateway/src/__tests__/facility-policy.test.js
git commit -m "feat(api): per-facility booking policy and a booking confirmation push"
```

---

### Task 6: Remaining P1 polish

Four small BRD items, grouped because none carries its own test cycle meaningfully.

**Files:**
- Modify: `apps/resident-app/src/components/GateGlanceCard.tsx`
- Modify: `apps/resident-app/src/screens/MembersScreen.tsx`
- Modify: `apps/resident-app/src/screens/VehiclesScreen.tsx`
- Test: the co-located `.test.tsx` for each

- [ ] **Step 1: Write the failing tests**

- `GateGlanceCard` renders "All quiet at the gate" when every count is zero and there is no latest event (BRD empty state, P1).
- `MembersScreen` renders a ghost row reading "Add house help / staff" that opens the helper flow (BRD 4.4, P1).
- `VehiclesScreen` shows a "How to link FASTag" affordance on a vehicle whose `fastagLinked` is false (BRD 4.5 / FASTag linking guide, P1).

- [ ] **Step 2: Run them and confirm they fail**

- [ ] **Step 3: Implement all three**

Use existing tokens. The live dot in `GateGlanceCard` is currently a static teal circle; the BRD calls it "pulsing" — animate it with `react-native-reanimated` (already a dependency) **only if** doing so does not complicate the test, otherwise leave it static and note the deviation in the report. It is decoration, not information.

- [ ] **Step 4: Run everything and commit**

```bash
git add apps/resident-app/src/components/GateGlanceCard.tsx apps/resident-app/src/components/GateGlanceCard.test.tsx apps/resident-app/src/screens/MembersScreen.tsx apps/resident-app/src/screens/VehiclesScreen.tsx
git commit -m "feat(app): gate empty state, staff ghost row and FASTag linking guide"
```

---

## Deferred

- **Multi-flat selector** (P2) — needs a product answer on whether a multi-flat owner gets a switcher or separate logins (BRD open question 4).
- **Maintenance receipt from accounting software** — BRD open question 6 is unresolved; documents stay resident-uploaded.

## Open BRD questions that affect this plan

The BRD lists six unresolved questions. Two were decided here to keep the work moving, and both should be confirmed:

1. **Face-ID enrolment location (Q2).** This plan accepts a derived **vector only** and rejects any request carrying an image, because the BRD's own non-functional section requires biometric data not be stored server-side under DPDP Act 2023. If the intent is instead to redirect entirely to the ZKTeco device enrolment flow, Task 1 shrinks to a status-read endpoint.
2. **Slots per flat per day (Q3).** Made per-facility (`max_per_unit_per_day`), which satisfies both readings — global by setting every facility the same.

Q1 (gate card scope), Q4 (multi-flat), Q5 (vehicle cap) and Q6 (receipts) do not block anything in this plan.
