# Dwaar AI Home Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Home tab placeholder with a live, light-Dwaar dashboard (Gate at a Glance, quick actions, recent gate activity, dues snapshot, community strip) backed by a new resident aggregate endpoint and a resident parcels loop.

**Architecture:** Add three backend routes in `services/api-gateway` (`GET /resident/home` aggregate via `Promise.allSettled`; resident `GET /deliveries` and `POST /deliveries/:id/collect`). On the client, add API methods + a `homeStore` (zustand), build small token-driven presentational components, a `ParcelsScreen`, and assemble `HomeScreen`, then route it from `app/index.tsx`.

**Tech Stack:** Node 20 ESM + Express + zod + **vitest** (api-gateway tests mock `db/queries.js`); Expo SDK 52 / React Native 0.76, expo-router, zustand, **jest-expo** + @testing-library/react-native (resident-app tests).

**Spec:** `docs/superpowers/specs/2026-06-12-dwaar-home-design.md`
**Branch:** `redesign/dwaar-light`

### Conventions for every task
- Backend tests: `pnpm --filter api-gateway test <pattern>`. Frontend tests: `pnpm --filter resident-app test <pattern>`.
- Type gate (frontend): `pnpm --filter resident-app exec tsc --noEmit`.
- All colours/spacing/type from foundation tokens — no hardcoded hex in components (PlateText's statutory yellow is the only exception, already in place).
- Backend routes follow the existing pattern: `authenticateJWT(['resident'])`, `success(res, data)` / `error(res, msg, code)`, queries via `query`/`queryOne`/`queryRows`.

### File structure (created / modified)
- Modify `services/api-gateway/src/routes/deliveries.js` — add resident `GET /deliveries` + `POST /deliveries/:id/collect`.
- Create `services/api-gateway/src/routes/resident-home.js` — aggregate endpoint.
- Modify `services/api-gateway/src/index.js` — mount the new route.
- Modify `services/api-gateway/src/__tests__/deliveries.test.js` — resident cases.
- Create `services/api-gateway/src/__tests__/resident-home.test.js`.
- Modify `apps/resident-app/src/api/client.ts` — 3 methods.
- Create `apps/resident-app/src/store/homeStore.ts` (+ `homeStore.test.ts`).
- Create components: `GateActivityRow.tsx`, `GateGlanceCard.tsx`, `QuickActionGrid.tsx`, `DuesSnapshotCard.tsx`, `CommunityStrip.tsx` (+ tests for the first four).
- Create `apps/resident-app/src/screens/ParcelsScreen.tsx` (+ test).
- Replace `apps/resident-app/src/screens/HomeScreen.tsx`.
- Modify `apps/resident-app/app/index.tsx` — render `HomeScreen` for the Home tab.
- Modify `apps/resident-app/src/screens/VisitorsScreen.tsx` — optional `onClose` back control (interim).

### Interim decision flagged for review
The **Invite Visitor** and **Pre-approve** quick actions open the existing (legacy, dark) `VisitorsScreen` as an overlay rather than a placeholder, to preserve working functionality. `VisitorsScreen` gets a small optional `onClose` back control (Task 11b). If you'd rather they show a branded "Coming in this redesign" placeholder instead, say so and Task 11b/12 change accordingly.

---

## Task 1: Resident `GET /deliveries` (list my unit's parcels)

**Files:**
- Modify: `services/api-gateway/src/routes/deliveries.js`
- Test: `services/api-gateway/src/__tests__/deliveries.test.js`

- [ ] **Step 1: Add failing tests**

Append inside the `describe('Delivery management', ...)` block in `deliveries.test.js`:
```js
  it('GET /deliveries (resident) requires a resident token', async () => {
    const r1 = await request('GET', '/api/v1/deliveries');
    expect(r1.status).toBe(401);
    const r2 = await request('GET', '/api/v1/deliveries', { headers: { Authorization: `Bearer ${guard}` } });
    expect(r2.status).toBe(403);
  });

  it('GET /deliveries lists the resident unit\'s parcels', async () => {
    queryRows.mockResolvedValueOnce([
      { id: 'd1', company: 'Amazon', note: 'Brown box', status: 'waiting', unit_id: 'u1', logged_by_name: 'Ramesh', created_at: new Date(), resolved_at: null },
    ]);
    const { status, json } = await request('GET', '/api/v1/deliveries', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].company).toBe('Amazon');
    // scoped to the caller's unit
    expect(queryRows.mock.calls[0][1]).toEqual(['c1', 'u1']);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api-gateway test deliveries`
Expected: the two new tests FAIL (401 expected but route missing → 404; or assertion on `json.data`).

- [ ] **Step 3: Implement the resident list route**

In `deliveries.js`, add this route just above `export default router;`:
```js
// -- GET /deliveries (resident) — my unit's parcels --------------------------

router.get('/deliveries', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { community_id, unit_id } = req.user;
    const statusFilter = req.query.status || null;
    let sql = 'SELECT * FROM deliveries WHERE community_id = $1 AND unit_id = $2';
    const params = [community_id, unit_id];
    if (statusFilter) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(statusFilter);
    }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const rows = await queryRows(sql, params);
    return success(res, rows.map(shape));
  } catch (err) {
    console.error('GET /deliveries error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter api-gateway test deliveries`
Expected: PASS (all delivery tests).

- [ ] **Step 5: Commit**
```bash
git add services/api-gateway/src/routes/deliveries.js services/api-gateway/src/__tests__/deliveries.test.js
git commit -m "feat(api): resident GET /deliveries (parcels for my unit)"
```

---

## Task 2: Resident `POST /deliveries/:id/collect`

**Files:**
- Modify: `services/api-gateway/src/routes/deliveries.js`
- Test: `services/api-gateway/src/__tests__/deliveries.test.js`

- [ ] **Step 1: Add failing tests**

Append inside the same `describe` block:
```js
  it('POST /deliveries/:id/collect requires a resident', async () => {
    const r = await request('POST', '/api/v1/deliveries/d1/collect', { headers: { Authorization: `Bearer ${guard}` } });
    expect(r.status).toBe(403);
  });

  it('collect returns 404 for an unknown delivery', async () => {
    queryOne.mockResolvedValueOnce(null);
    const { status } = await request('POST', '/api/v1/deliveries/dX/collect', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(404);
  });

  it('collect rejects another unit\'s parcel with 403', async () => {
    queryOne.mockResolvedValueOnce({ id: 'd1', unit_id: 'u2', status: 'waiting' });
    const { status } = await request('POST', '/api/v1/deliveries/d1/collect', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(403);
  });

  it('collect rejects an already-resolved parcel with 409', async () => {
    queryOne.mockResolvedValueOnce({ id: 'd1', unit_id: 'u1', status: 'delivered' });
    const { status } = await request('POST', '/api/v1/deliveries/d1/collect', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(409);
  });

  it('collect marks the parcel delivered and broadcasts', async () => {
    queryOne.mockResolvedValueOnce({ id: 'd1', unit_id: 'u1', status: 'waiting' });
    const { status, json } = await request('POST', '/api/v1/deliveries/d1/collect', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.status).toBe('delivered');
    expect(broadcast.mock.calls[0][1]).toBe('delivery:updated');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api-gateway test deliveries`
Expected: the five new tests FAIL (route missing → 404/401 mismatches).

- [ ] **Step 3: Implement the collect route**

In `deliveries.js`, add just above `export default router;`:
```js
// -- POST /deliveries/:id/collect (resident) — mark my parcel collected ------

router.post('/deliveries/:id/collect', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { community_id, unit_id } = req.user;
    const d = await queryOne(
      'SELECT id, unit_id, status FROM deliveries WHERE id = $1 AND community_id = $2',
      [req.params.id, community_id]
    );
    if (!d) return error(res, 'Delivery not found', 404);
    if (d.unit_id !== unit_id) return error(res, 'Not your delivery', 403);
    if (d.status !== 'waiting') return error(res, 'Delivery already resolved', 409);

    await query("UPDATE deliveries SET status = 'delivered', resolved_at = NOW() WHERE id = $1", [d.id]);
    broadcast(community_id, 'delivery:updated', { id: d.id, status: 'delivered' });
    return success(res, { id: d.id, status: 'delivered' });
  } catch (err) {
    console.error('POST /deliveries/:id/collect error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter api-gateway test deliveries`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add services/api-gateway/src/routes/deliveries.js services/api-gateway/src/__tests__/deliveries.test.js
git commit -m "feat(api): resident POST /deliveries/:id/collect"
```

---

## Task 3: `GET /resident/home` aggregate endpoint

**Files:**
- Create: `services/api-gateway/src/routes/resident-home.js`
- Modify: `services/api-gateway/src/index.js`
- Test: `services/api-gateway/src/__tests__/resident-home.test.js`

- [ ] **Step 1: Write the failing test**

Create `services/api-gateway/src/__tests__/resident-home.test.js`:
```js
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() },
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));
vi.mock('../../src/lib/fcm.js', () => ({ sendNotification: vi.fn().mockResolvedValue({}), sendToMultiple: vi.fn(), sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  return () => server.close();
});
beforeEach(() => { queryOne.mockReset(); queryRows.mockReset(); });

async function request(method, path, { headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers } });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1' });

// Sub-queries fire in array order: queryOne -> visitors, parcels, helpers, pinnedNotice;
// queryRows -> recentActivity, dues.
function seedHappyPath() {
  queryOne
    .mockResolvedValueOnce({ c: 2 })                                   // visitors expected
    .mockResolvedValueOnce({ c: 1 })                                   // parcels pending
    .mockResolvedValueOnce({ expected: 3, arrived: 1 })               // helpers
    .mockResolvedValueOnce({ id: 'n1', title: 'Water cut 6pm', author_name: 'RWA', created_at: new Date('2026-06-12T10:00:00Z') }); // pinned notice
  queryRows
    .mockResolvedValueOnce([                                           // recent activity
      { id: 'e1', event_ts: new Date('2026-06-12T09:00:00Z'), raw_value: 'KA01AB1234', detection_method: 'FASTag', direction: 'entry', access_decision: 'allow', resident_name: 'Mukesh' },
    ])
    .mockResolvedValueOnce([                                           // pending dues
      { id: 'd1', period: '2026-06', base_amount: 4000, penalty_amount: 500, due_date: '2026-06-30' },
    ]);
}

describe('GET /resident/home', () => {
  it('requires a resident token', async () => {
    expect((await request('GET', '/api/v1/resident/home')).status).toBe(401);
  });

  it('returns the aggregate home summary scoped to the unit', async () => {
    seedHappyPath();
    const { status, json } = await request('GET', '/api/v1/resident/home', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.gateGlance).toEqual({
      visitors: { expected: 2 },
      parcels: { pending: 1 },
      helpers: { expected: 3, arrived: 1 },
    });
    expect(json.data.recentActivity).toHaveLength(1);
    expect(json.data.recentActivity[0].plate).toBe('KA01AB1234');
    expect(json.data.dues).toEqual({ outstanding: 4500, earliestDueDate: '2026-06-30', pendingCount: 1 });
    expect(json.data.community.pinnedNotice.title).toBe('Water cut 6pm');
    expect(json.data.community.upcomingEvent).toBeNull();
  });

  it('degrades a failed section to a default instead of 500', async () => {
    queryOne
      .mockResolvedValueOnce({ c: 2 })
      .mockResolvedValueOnce({ c: 1 })
      .mockResolvedValueOnce({ expected: 0, arrived: 0 })
      .mockResolvedValueOnce(null);
    queryRows
      .mockResolvedValueOnce([])               // activity
      .mockRejectedValueOnce(new Error('db down')); // dues rejects
    const { status, json } = await request('GET', '/api/v1/resident/home', { headers: { Authorization: `Bearer ${resident}` } });
    expect(status).toBe(200);
    expect(json.data.dues).toEqual({ outstanding: 0, earliestDueDate: null, pendingCount: 0 });
    expect(json.data.gateGlance.parcels.pending).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api-gateway test resident-home`
Expected: FAIL (route not mounted → 404/401 mismatches).

- [ ] **Step 3: Create the route**

Create `services/api-gateway/src/routes/resident-home.js`:
```js
import { Router } from 'express';
import { queryOne, queryRows } from '../db/queries.js';
import { success } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// -- GET /resident/home — one aggregate summary for the resident's unit ------
// Sub-queries run independently; a failed section degrades to a default and is
// logged rather than failing the whole response.

router.get('/resident/home', authenticateJWT(['resident']), async (req, res) => {
  const { community_id, unit_id } = req.user;
  const today = new Date().toISOString().slice(0, 10);

  const sections = await Promise.allSettled([
    queryOne(
      "SELECT COUNT(*)::int AS c FROM visitor_passes WHERE community_id = $1 AND unit_id = $2 AND status = 'active'",
      [community_id, unit_id]
    ),
    queryOne(
      "SELECT COUNT(*)::int AS c FROM deliveries WHERE community_id = $1 AND unit_id = $2 AND status = 'waiting'",
      [community_id, unit_id]
    ),
    queryOne(
      `SELECT COUNT(ev.id)::int AS expected,
              (COUNT(*) FILTER (WHERE ev.status = 'arrived'))::int AS arrived
         FROM recurring_passes rp
         LEFT JOIN expected_visits ev
           ON ev.recurring_pass_id = rp.id AND ev.visit_date = $3
        WHERE rp.community_id = $1 AND rp.unit_id = $2 AND rp.status = 'active'`,
      [community_id, unit_id, today]
    ),
    queryRows(
      `SELECT ge.id, ge.event_ts, ge.raw_value, ge.detection_method, ge.direction,
              ge.access_decision, ge.resident_name
         FROM gate_events ge
        WHERE ge.community_id = $1 AND ge.matched_unit_id = $2
        ORDER BY ge.event_ts DESC LIMIT 5`,
      [community_id, unit_id]
    ),
    queryRows(
      `SELECT id, period, base_amount, penalty_amount, due_date FROM dues
        WHERE community_id = $1 AND unit_id = $2 AND status = 'pending'
        ORDER BY due_date ASC NULLS LAST, created_at ASC`,
      [community_id, unit_id]
    ),
    queryOne(
      `SELECT id, title, author_name, created_at FROM notices
        WHERE community_id = $1 AND is_removed = false AND is_pinned = true AND category = 'official'
        ORDER BY last_activity_at DESC LIMIT 1`,
      [community_id]
    ),
  ]);

  const val = (i, fallback) => {
    if (sections[i].status === 'fulfilled') return sections[i].value;
    console.error(`[resident/home] section ${i} failed:`, sections[i].reason?.message);
    return fallback;
  };

  const visitors = val(0, null);
  const parcels = val(1, null);
  const helpers = val(2, null);
  const activity = val(3, []) || [];
  const dues = val(4, []) || [];
  const notice = val(5, null);

  const outstanding = Number(
    dues.reduce((s, d) => s + Number(d.base_amount || 0) + Number(d.penalty_amount || 0), 0).toFixed(2)
  );

  return success(res, {
    gateGlance: {
      visitors: { expected: visitors?.c ?? 0 },
      parcels: { pending: parcels?.c ?? 0 },
      helpers: { expected: helpers?.expected ?? 0, arrived: helpers?.arrived ?? 0 },
    },
    recentActivity: activity.map((r) => ({
      id: r.id,
      ts: r.event_ts,
      plate: r.raw_value || '',
      method: r.detection_method,
      direction: r.direction || 'entry',
      decision: r.access_decision,
      residentName: r.resident_name || '',
    })),
    dues: {
      outstanding,
      earliestDueDate: dues.length ? dues[0].due_date : null,
      pendingCount: dues.length,
    },
    community: {
      pinnedNotice: notice
        ? { id: notice.id, title: notice.title, authorName: notice.author_name, createdAt: notice.created_at }
        : null,
      upcomingEvent: null,
    },
  });
});

export default router;
```

- [ ] **Step 4: Mount the route in `index.js`**

In `services/api-gateway/src/index.js`, add the import near the other route imports (after line 24's `deliveryRoutes` import):
```js
import residentHomeRoutes from './routes/resident-home.js';
```
And mount it with the others (after the `deliveryRoutes` mount, ~line 72):
```js
app.use('/api/v1', residentHomeRoutes);
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter api-gateway test resident-home`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**
```bash
git add services/api-gateway/src/routes/resident-home.js services/api-gateway/src/index.js services/api-gateway/src/__tests__/resident-home.test.js
git commit -m "feat(api): GET /resident/home aggregate dashboard endpoint"
```

---

## Task 4: API client methods (resident-app)

**Files:**
- Modify: `apps/resident-app/src/api/client.ts`

- [ ] **Step 1: Add the methods**

In `client.ts`, after the `// Maintenance dues` block, add:
```ts
// Resident home (aggregate dashboard)
export const getResidentHome = () => api.get('/resident/home');

// Deliveries (parcels) — resident
export const getDeliveries = (params?: Record<string, string>) =>
  api.get('/deliveries', { params });

export const collectDelivery = (id: string) => api.post(`/deliveries/${id}/collect`);
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors.
```bash
git add apps/resident-app/src/api/client.ts
git commit -m "feat(resident): home + deliveries api client methods"
```

---

## Task 5: `homeStore` (zustand)

**Files:**
- Create: `apps/resident-app/src/store/homeStore.ts`
- Test: `apps/resident-app/src/store/homeStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `homeStore.test.ts`:
```ts
jest.mock('../api/client');
import * as api from '../api/client';
import { useHomeStore } from './homeStore';

const sample = {
  gateGlance: { visitors: { expected: 2 }, parcels: { pending: 1 }, helpers: { expected: 3, arrived: 1 } },
  recentActivity: [],
  dues: { outstanding: 4500, earliestDueDate: '2026-06-30', pendingCount: 1 },
  community: { pinnedNotice: null, upcomingEvent: null },
};

beforeEach(() => {
  useHomeStore.setState({ summary: null, loading: false, error: false });
  jest.clearAllMocks();
});

describe('homeStore', () => {
  it('populates summary on success', async () => {
    (api.getResidentHome as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useHomeStore.getState().fetch();
    const s = useHomeStore.getState();
    expect(s.summary?.gateGlance.parcels.pending).toBe(1);
    expect(s.error).toBe(false);
    expect(s.loading).toBe(false);
  });

  it('sets error and preserves the prior summary on failure', async () => {
    useHomeStore.setState({ summary: sample });
    (api.getResidentHome as jest.Mock).mockRejectedValue(new Error('boom'));
    await useHomeStore.getState().fetch();
    const s = useHomeStore.getState();
    expect(s.error).toBe(true);
    expect(s.summary).toEqual(sample);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter resident-app test homeStore`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store**

Create `homeStore.ts`:
```ts
import { create } from 'zustand';
import * as api from '../api/client';

export interface ActivityEvent {
  id: string;
  ts: string;
  plate: string;
  method: string;
  direction: string;
  decision: string;
  residentName: string;
}

export interface PinnedNotice {
  id: string;
  title: string;
  authorName: string;
  createdAt: string;
}

export interface HomeSummary {
  gateGlance: {
    visitors: { expected: number };
    parcels: { pending: number };
    helpers: { expected: number; arrived: number };
  };
  recentActivity: ActivityEvent[];
  dues: { outstanding: number; earliestDueDate: string | null; pendingCount: number };
  community: { pinnedNotice: PinnedNotice | null; upcomingEvent: null };
}

interface HomeState {
  summary: HomeSummary | null;
  loading: boolean;
  error: boolean;
  fetch: () => Promise<void>;
}

export const useHomeStore = create<HomeState>((set) => ({
  summary: null,
  loading: false,
  error: false,
  fetch: async () => {
    set({ loading: true, error: false });
    try {
      const res = await api.getResidentHome();
      set({ summary: res.data.data as HomeSummary });
    } catch {
      set({ error: true });
    } finally {
      set({ loading: false });
    }
  },
}));
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter resident-app test homeStore`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add apps/resident-app/src/store/homeStore.ts apps/resident-app/src/store/homeStore.test.ts
git commit -m "feat(resident): homeStore for aggregate dashboard"
```

---

## Task 6: `GateActivityRow` component

**Files:**
- Create: `apps/resident-app/src/components/GateActivityRow.tsx`
- Test: `apps/resident-app/src/components/GateActivityRow.test.tsx`

- [ ] **Step 1: Write the failing test**

`GateActivityRow.test.tsx`:
```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import GateActivityRow, { relativeTime } from './GateActivityRow';

const base = { id: 'e1', ts: '2026-06-12T09:00:00Z', plate: 'KA01AB1234', method: 'FASTag', direction: 'entry', residentName: 'Mukesh' };

describe('GateActivityRow', () => {
  it('maps decision to a status badge', () => {
    expect(render(<GateActivityRow event={{ ...base, decision: 'allow' }} />).getByText('Granted')).toBeTruthy();
    expect(render(<GateActivityRow event={{ ...base, decision: 'deny' }} />).getByText('Denied')).toBeTruthy();
    expect(render(<GateActivityRow event={{ ...base, decision: 'guard_review' }} />).getByText('Pending')).toBeTruthy();
  });
});

describe('relativeTime', () => {
  it('formats minutes and hours', () => {
    const now = new Date('2026-06-12T09:05:00Z').getTime();
    expect(relativeTime('2026-06-12T09:00:00Z', now)).toBe('5m ago');
    expect(relativeTime('2026-06-12T07:00:00Z', now)).toBe('2h ago');
    expect(relativeTime('2026-06-12T09:05:00Z', now)).toBe('just now');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter resident-app test GateActivityRow`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`GateActivityRow.tsx`:
```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { StatusBadge } from './ui';
import type { BadgePreset } from './ui';
import PlateText from './PlateText';
import type { ActivityEvent } from '../store/homeStore';

const DECISION_PRESET: Record<string, BadgePreset> = {
  allow: 'granted',
  deny: 'denied',
  guard_review: 'pending',
};

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function GateActivityRow({ event }: { event: ActivityEvent }) {
  const preset = DECISION_PRESET[event.decision] ?? 'info';
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        {event.plate ? (
          <PlateText plate={event.plate} size="sm" />
        ) : (
          <Text style={type.body}>{event.residentName || 'Gate event'}</Text>
        )}
        <Text style={type.micro}>
          {event.direction === 'exit' ? 'Exited' : 'Entered'} · {event.method} · {relativeTime(event.ts)}
        </Text>
      </View>
      <StatusBadge preset={preset} size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, gap: spacing.sm },
  left: { gap: 2, flex: 1 },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter resident-app test GateActivityRow`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/resident-app/src/components/GateActivityRow.tsx apps/resident-app/src/components/GateActivityRow.test.tsx
git commit -m "feat(resident): GateActivityRow (decision->badge + relative time)"
```

---

## Task 7: `GateGlanceCard` component

**Files:**
- Create: `apps/resident-app/src/components/GateGlanceCard.tsx`
- Test: `apps/resident-app/src/components/GateGlanceCard.test.tsx`

- [ ] **Step 1: Write the failing test**

`GateGlanceCard.test.tsx`:
```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import GateGlanceCard from './GateGlanceCard';

const glance = { visitors: { expected: 2 }, parcels: { pending: 1 }, helpers: { expected: 3, arrived: 1 } };

describe('GateGlanceCard', () => {
  it('renders the three counts', () => {
    const { getByText } = render(<GateGlanceCard glance={glance} latest={null} />);
    expect(getByText('2')).toBeTruthy();
    expect(getByText('1')).toBeTruthy();
    expect(getByText('1/3')).toBeTruthy();
    expect(getByText('Visitors')).toBeTruthy();
    expect(getByText('Parcels')).toBeTruthy();
    expect(getByText('Helpers')).toBeTruthy();
  });

  it('fires onParcels when the Parcels tile is tapped', () => {
    const onParcels = jest.fn();
    const { getByTestId } = render(<GateGlanceCard glance={glance} latest={null} onParcels={onParcels} />);
    fireEvent.press(getByTestId('glance-parcels'));
    expect(onParcels).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter resident-app test GateGlanceCard`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`GateGlanceCard.tsx`:
```tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';
import { relativeTime } from './GateActivityRow';
import type { HomeSummary, ActivityEvent } from '../store/homeStore';

interface Props {
  glance: HomeSummary['gateGlance'];
  latest: ActivityEvent | null;
  onParcels?: () => void;
}

function Tile({
  icon, value, label, onPress, testID,
}: { icon: any; value: string; label: string; onPress?: () => void; testID?: string }) {
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap style={styles.tile} onPress={onPress} testID={testID}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.teal} />
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </Wrap>
  );
}

export default function GateGlanceCard({ glance, latest, onParcels }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.pulse} />
        <Text style={styles.title}>Gate at a Glance</Text>
      </View>
      <View style={styles.tiles}>
        <Tile icon="account-clock" value={String(glance.visitors.expected)} label="Visitors" />
        <Tile icon="package-variant" value={String(glance.parcels.pending)} label="Parcels" onPress={onParcels} testID="glance-parcels" />
        <Tile icon="broom" value={`${glance.helpers.arrived}/${glance.helpers.expected}`} label="Helpers" />
      </View>
      {latest && (
        <Text style={styles.latest} numberOfLines={1}>
          {latest.plate || latest.residentName || 'Gate event'} {latest.direction === 'exit' ? 'exited' : 'entered'} · {relativeTime(latest.ts)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal },
  title: { ...font(500), fontSize: 14, color: colors.textInverse },
  tiles: { flexDirection: 'row' },
  tile: { flex: 1, alignItems: 'center', gap: 2 },
  value: { ...font(700), fontSize: 24, color: colors.textInverse },
  label: { ...font(400), fontSize: 11, color: colors.mist },
  latest: { ...font(400), fontSize: 12, color: colors.mist, marginTop: spacing.md, textAlign: 'center' },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter resident-app test GateGlanceCard`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/resident-app/src/components/GateGlanceCard.tsx apps/resident-app/src/components/GateGlanceCard.test.tsx
git commit -m "feat(resident): GateGlanceCard (Visitors/Parcels/Helpers)"
```

---

## Task 8: `QuickActionGrid` + `QuickActionCard`

**Files:**
- Create: `apps/resident-app/src/components/QuickActionGrid.tsx`
- Test: `apps/resident-app/src/components/QuickActionGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

`QuickActionGrid.test.tsx`:
```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import QuickActionGrid from './QuickActionGrid';

describe('QuickActionGrid', () => {
  it('renders each action and fires its onPress', () => {
    const onPress = jest.fn();
    const actions = [
      { key: 'invite', label: 'Invite Visitor', sub: 'One-time pass', icon: 'account-plus', onPress },
      { key: 'myunit', label: 'My Unit', sub: 'Members', icon: 'home-city', onPress: jest.fn() },
    ];
    const { getByTestId, getByText } = render(<QuickActionGrid actions={actions} />);
    expect(getByText('Invite Visitor')).toBeTruthy();
    fireEvent.press(getByTestId('qa-invite'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter resident-app test QuickActionGrid`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`QuickActionGrid.tsx`:
```tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';

export interface QuickAction {
  key: string;
  label: string;
  sub: string;
  icon: string;
  onPress: () => void;
}

export function QuickActionCard({ action }: { action: QuickAction }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={action.onPress}
      testID={`qa-${action.key}`}
    >
      <MaterialCommunityIcons name={action.icon as any} size={22} color={colors.brandPrimary} />
      <Text style={styles.label}>{action.label}</Text>
      <Text style={styles.sub}>{action.sub}</Text>
    </Pressable>
  );
}

export default function QuickActionGrid({ actions }: { actions: QuickAction[] }) {
  return (
    <View style={styles.grid}>
      {actions.map((a) => (
        <QuickActionCard key={a.key} action={a} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    width: '31%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  pressed: { opacity: 0.85 },
  label: { ...font(500), fontSize: 12, color: colors.textPrimary },
  sub: { ...font(400), fontSize: 10, color: colors.textTertiary },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter resident-app test QuickActionGrid`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/resident-app/src/components/QuickActionGrid.tsx apps/resident-app/src/components/QuickActionGrid.test.tsx
git commit -m "feat(resident): QuickActionGrid + QuickActionCard"
```

---

## Task 9: `DuesSnapshotCard` component

**Files:**
- Create: `apps/resident-app/src/components/DuesSnapshotCard.tsx`
- Test: `apps/resident-app/src/components/DuesSnapshotCard.test.tsx`

- [ ] **Step 1: Write the failing test**

`DuesSnapshotCard.test.tsx`:
```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import DuesSnapshotCard from './DuesSnapshotCard';

describe('DuesSnapshotCard', () => {
  it('shows the outstanding amount and Pay when dues exist', () => {
    const { getByText } = render(<DuesSnapshotCard outstanding={4500} earliestDueDate="2026-06-30" />);
    expect(getByText(/4,500/)).toBeTruthy();
    expect(getByText('Pay')).toBeTruthy();
  });

  it('shows the clear state when nothing is outstanding', () => {
    const { getByText, queryByText } = render(<DuesSnapshotCard outstanding={0} earliestDueDate={null} />);
    expect(getByText('No dues pending')).toBeTruthy();
    expect(queryByText('Pay')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter resident-app test DuesSnapshotCard`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`DuesSnapshotCard.tsx`:
```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { Card } from './ui';

interface Props {
  outstanding: number;
  earliestDueDate: string | null;
  onPress?: () => void;
}

export default function DuesSnapshotCard({ outstanding, earliestDueDate, onPress }: Props) {
  const due = outstanding > 0;
  const subtitle = due
    ? `₹${outstanding.toLocaleString('en-IN')} outstanding${earliestDueDate ? ` · due ${earliestDueDate}` : ''}`
    : 'No dues pending';
  return (
    <Card accent={due ? colors.warning : colors.success} onPress={onPress}>
      <View style={styles.row}>
        <MaterialCommunityIcons
          name="credit-card-outline"
          size={20}
          color={due ? colors.textWarning : colors.textSuccess}
        />
        <View style={{ flex: 1 }}>
          <Text style={type.h3}>Maintenance dues</Text>
          <Text style={type.bodySecondary}>{subtitle}</Text>
        </View>
        {due ? (
          <View style={styles.payPill}>
            <Text style={styles.payText}>Pay</Text>
          </View>
        ) : (
          <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  payPill: { backgroundColor: colors.actionPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm },
  payText: { ...font(500), fontSize: 13, color: colors.textInverse },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter resident-app test DuesSnapshotCard`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/resident-app/src/components/DuesSnapshotCard.tsx apps/resident-app/src/components/DuesSnapshotCard.test.tsx
git commit -m "feat(resident): DuesSnapshotCard"
```

---

## Task 10: `CommunityStrip` component

**Files:**
- Create: `apps/resident-app/src/components/CommunityStrip.tsx`
- Test: `apps/resident-app/src/components/CommunityStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

`CommunityStrip.test.tsx`:
```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import CommunityStrip from './CommunityStrip';

describe('CommunityStrip', () => {
  it('renders a pinned notice when present', () => {
    const notice = { id: 'n1', title: 'Water cut 6pm', authorName: 'RWA', createdAt: '2026-06-12T10:00:00Z' };
    const { getByText } = render(<CommunityStrip pinnedNotice={notice} upcomingEvent={null} />);
    expect(getByText('Water cut 6pm')).toBeTruthy();
  });

  it('renders the empty notice state when none is pinned', () => {
    const { getByText } = render(<CommunityStrip pinnedNotice={null} upcomingEvent={null} />);
    expect(getByText('No announcements')).toBeTruthy();
    expect(getByText('Nothing scheduled yet')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter resident-app test CommunityStrip`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`CommunityStrip.tsx`:
```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { Card } from './ui';
import type { PinnedNotice } from '../store/homeStore';

interface Props {
  pinnedNotice: PinnedNotice | null;
  upcomingEvent: null; // stub until the Events sub-project
  onNotice?: () => void;
}

export default function CommunityStrip({ pinnedNotice, upcomingEvent, onNotice }: Props) {
  return (
    <View style={styles.wrap}>
      <Card accent={colors.info} onPress={pinnedNotice ? onNotice : undefined}>
        <View style={styles.row}>
          <MaterialCommunityIcons name="bullhorn-outline" size={18} color={colors.info} />
          <View style={{ flex: 1 }}>
            {pinnedNotice ? (
              <>
                <Text style={type.h3} numberOfLines={1}>{pinnedNotice.title}</Text>
                <Text style={type.micro}>Pinned by {pinnedNotice.authorName}</Text>
              </>
            ) : (
              <Text style={type.bodySecondary}>No announcements</Text>
            )}
          </View>
        </View>
      </Card>
      <Card>
        <View style={styles.row}>
          <MaterialCommunityIcons name="calendar-star" size={18} color={colors.textTertiary} />
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>Upcoming event</Text>
            <Text style={type.micro}>Nothing scheduled yet</Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter resident-app test CommunityStrip`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/resident-app/src/components/CommunityStrip.tsx apps/resident-app/src/components/CommunityStrip.test.tsx
git commit -m "feat(resident): CommunityStrip (pinned notice + event stub)"
```

---

## Task 11: `ParcelsScreen`

**Files:**
- Create: `apps/resident-app/src/screens/ParcelsScreen.tsx`
- Test: `apps/resident-app/src/screens/ParcelsScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

`ParcelsScreen.test.tsx`:
```tsx
jest.mock('../api/client');
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as api from '../api/client';
import ParcelsScreen from './ParcelsScreen';

describe('ParcelsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists parcels and marks one collected', async () => {
    (api.getDeliveries as jest.Mock).mockResolvedValue({
      data: { data: [{ id: 'd1', company: 'Amazon', note: 'Brown box', status: 'waiting', logged_by_name: 'Ramesh', created_at: '2026-06-12T08:00:00Z', resolved_at: null }] },
    });
    (api.collectDelivery as jest.Mock).mockResolvedValue({ data: { data: { id: 'd1', status: 'delivered' } } });

    const { getByText, queryByText } = render(<ParcelsScreen onBack={() => {}} />);
    await waitFor(() => expect(getByText('Amazon')).toBeTruthy());

    fireEvent.press(getByText('Mark collected'));
    await waitFor(() => expect(api.collectDelivery).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(queryByText('Amazon')).toBeNull());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter resident-app test ParcelsScreen`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`ParcelsScreen.tsx`:
```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, StatusBadge, Button } from '../components/ui';
import * as api from '../api/client';

interface Parcel {
  id: string;
  company: string;
  note: string | null;
  status: string;
  loggedByName: string | null;
  createdAt: string;
}

function mapParcel(raw: any): Parcel {
  return {
    id: raw.id,
    company: raw.company,
    note: raw.note ?? null,
    status: raw.status,
    loggedByName: raw.logged_by_name ?? null,
    createdAt: raw.created_at,
  };
}

// Older parcels read "hotter": ≥3 days = error accent, ≥1 day = warning, else neutral.
function ageAccent(createdAt: string): string | undefined {
  const days = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  if (days >= 3) return colors.error;
  if (days >= 1) return colors.warning;
  return undefined;
}

export default function ParcelsScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDeliveries();
      setItems((res.data.data || []).map(mapParcel));
    } catch {
      /* leave list as-is; pull-to-refresh or reopen retries */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const collect = async (id: string) => {
    const prev = items;
    setItems(items.filter((p) => p.id !== id)); // optimistic
    try {
      await api.collectDelivery(id);
    } catch {
      setItems(prev); // restore on failure
    }
  };

  return (
    <View style={styles.container}>
      <AppBar title="Parcels" onBack={onBack} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.teal} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}><Text style={type.bodySecondary}>No parcels at the gate</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((p) => (
            <Card key={p.id} accent={ageAccent(p.createdAt)} style={styles.card}>
              <View style={styles.rowTop}>
                <Text style={type.h3}>{p.company}</Text>
                <StatusBadge preset={p.status === 'waiting' ? 'pending' : 'granted'} size="sm" />
              </View>
              {p.note ? <Text style={type.bodySecondary}>{p.note}</Text> : null}
              {p.loggedByName ? <Text style={type.micro}>Received by {p.loggedByName}</Text> : null}
              {p.status === 'waiting' && (
                <Button title="Mark collected" onPress={() => collect(p.id)} style={styles.collectBtn} />
              )}
            </Card>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, gap: spacing.sm },
  card: { gap: spacing.xs },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collectBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter resident-app test ParcelsScreen`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/resident-app/src/screens/ParcelsScreen.tsx apps/resident-app/src/screens/ParcelsScreen.test.tsx
git commit -m "feat(resident): ParcelsScreen (list + mark collected)"
```

---

## Task 11b: Add an optional back control to `VisitorsScreen` (interim)

**Files:**
- Modify: `apps/resident-app/src/screens/VisitorsScreen.tsx`

> Interim: lets Home open the legacy visitor flow as an overlay with a way back. No redesign of VisitorsScreen here — that is a later sub-project.

- [ ] **Step 1: Accept an optional `onClose` and render a back affordance**

Change the component signature:
```tsx
export default function VisitorsScreen({ onClose }: { onClose?: () => void } = {}) {
```
Then, at the very top of the returned JSX (immediately inside the outermost container, before existing content), add a back row that only renders when `onClose` is provided:
```tsx
{onClose && (
  <TouchableOpacity onPress={onClose} style={{ padding: spacing.lg, paddingBottom: 0 }}>
    <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
  </TouchableOpacity>
)}
```
(`TouchableOpacity`, `MaterialCommunityIcons`, `colors`, `spacing` are already imported in this file.)

- [ ] **Step 2: Type-check**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add apps/resident-app/src/screens/VisitorsScreen.tsx
git commit -m "chore(resident): optional onClose back control on VisitorsScreen (interim)"
```

---

## Task 12: Rebuild `HomeScreen`

**Files:**
- Replace: `apps/resident-app/src/screens/HomeScreen.tsx`

- [ ] **Step 1: Replace the file**

`HomeScreen.tsx` (full replacement):
```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type, font } from '../theme/typography';
import { AppBar, SectionHeader, Card } from '../components/ui';
import GateGlanceCard from '../components/GateGlanceCard';
import QuickActionGrid, { QuickAction } from '../components/QuickActionGrid';
import GateActivityRow from '../components/GateActivityRow';
import DuesSnapshotCard from '../components/DuesSnapshotCard';
import CommunityStrip from '../components/CommunityStrip';
import { useHomeStore } from '../store/homeStore';
import { useAuthStore } from '../store/authStore';
import ParcelsScreen from './ParcelsScreen';
import DuesScreen from './DuesScreen';
import VisitorsScreen from './VisitorsScreen';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

type Overlay = 'parcels' | 'dues' | 'visitors' | null;

interface Props {
  onNavigate?: (tab: 'home' | 'myunit' | 'community' | 'events' | 'profile') => void;
}

export default function HomeScreen({ onNavigate }: Props) {
  const user = useAuthStore((s) => s.user);
  const { summary, error, fetch } = useHomeStore();
  const [refreshing, setRefreshing] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);

  const load = useCallback(async () => { await fetch(); }, [fetch]);
  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (overlay === 'parcels') return <ParcelsScreen onBack={() => { setOverlay(null); load(); }} />;
  if (overlay === 'dues') return <DuesScreen onClose={() => { setOverlay(null); load(); }} />;
  if (overlay === 'visitors') return <VisitorsScreen onClose={() => { setOverlay(null); load(); }} />;

  const firstName = user?.name?.split(' ')[0] || 'Resident';
  const glance = summary?.gateGlance ?? {
    visitors: { expected: 0 }, parcels: { pending: 0 }, helpers: { expected: 0, arrived: 0 },
  };
  const activity = summary?.recentActivity ?? [];
  const dues = summary?.dues ?? { outstanding: 0, earliestDueDate: null, pendingCount: 0 };
  const community = summary?.community ?? { pinnedNotice: null, upcomingEvent: null };

  const quickActions: QuickAction[] = [
    { key: 'invite', label: 'Invite Visitor', sub: 'One-time pass', icon: 'account-plus', onPress: () => setOverlay('visitors') },
    { key: 'preapprove', label: 'Pre-approve', sub: 'Silent entry', icon: 'shield-check', onPress: () => setOverlay('visitors') },
    { key: 'facility', label: 'Book facility', sub: 'Courts & halls', icon: 'calendar-check', onPress: () => onNavigate?.('myunit') },
    { key: 'myunit', label: 'My Unit', sub: 'Members & vehicles', icon: 'home-city', onPress: () => onNavigate?.('myunit') },
    { key: 'ticket', label: 'Raise ticket', sub: 'Report an issue', icon: 'alert-circle-outline', onPress: () => onNavigate?.('community') },
    { key: 'announce', label: 'Announcements', sub: 'Notices', icon: 'bullhorn', onPress: () => onNavigate?.('community') },
  ];

  return (
    <View style={styles.container}>
      <AppBar title={user?.communityName || 'Home'} bellCount={0} onBell={() => onNavigate?.('community')} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        <Text style={type.h2}>{getGreeting()}, {firstName}</Text>
        {user?.unitNumber ? (
          <Text style={[type.bodySecondary, styles.unit]}>Unit {user.unitNumber}{user.communityName ? ` · ${user.communityName}` : ''}</Text>
        ) : null}

        <GateGlanceCard glance={glance} latest={activity[0] ?? null} onParcels={() => setOverlay('parcels')} />

        <View style={styles.block}>
          <QuickActionGrid actions={quickActions} />
        </View>

        <View style={styles.block}>
          <SectionHeader title="Recent at the gate" actionLabel="See all" onAction={() => onNavigate?.('myunit')} />
          {activity.length === 0 ? (
            <Card><Text style={type.bodySecondary}>{error ? 'Could not load activity. Pull to refresh.' : 'No recent activity'}</Text></Card>
          ) : (
            <Card>
              {activity.map((e) => <GateActivityRow key={e.id} event={e} />)}
            </Card>
          )}
        </View>

        <View style={styles.block}>
          <DuesSnapshotCard outstanding={dues.outstanding} earliestDueDate={dues.earliestDueDate} onPress={() => setOverlay('dues')} />
        </View>

        <View style={styles.block}>
          <CommunityStrip pinnedNotice={community.pinnedNotice} upcomingEvent={community.upcomingEvent} onNotice={() => onNavigate?.('community')} />
        </View>

        <Text style={styles.tagline}>Open the right door</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['3xl'], gap: spacing.sm },
  unit: { marginBottom: spacing.md },
  block: { marginTop: spacing.md },
  tagline: { ...font(400), fontSize: 12, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xl },
});
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors. (If `user.communityName` / `user.unitNumber` are not on the auth user type, confirm against `authStore` — the old HomeScreen referenced both, so they exist.)

- [ ] **Step 3: Commit**
```bash
git add apps/resident-app/src/screens/HomeScreen.tsx
git commit -m "feat(resident): rebuild HomeScreen on Dwaar light dashboard"
```

---

## Task 13: Route `HomeScreen` from the nav shell

**Files:**
- Modify: `apps/resident-app/app/index.tsx`

- [ ] **Step 1: Import and render HomeScreen for the Home tab**

In `app/index.tsx`, add the import near the other screen imports:
```tsx
import HomeScreen from '../src/screens/HomeScreen';
```
Replace the Home placeholder line in `ResidentApp`'s content block:
```tsx
{tab === 'home' && <TabPlaceholder name="Home" icon="home-variant" />}
```
with:
```tsx
{tab === 'home' && <HomeScreen onNavigate={setTab} />}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors (`setTab` is `(key: TabKey) => void`; `HomeScreen`'s `onNavigate` accepts the same union).

- [ ] **Step 3: Commit**
```bash
git add apps/resident-app/app/index.tsx
git commit -m "feat(resident): route HomeScreen for the Home tab"
```

---

## Task 14: Final verification

- [ ] **Step 1: Backend suite**

Run: `pnpm --filter api-gateway test deliveries resident-home`
Expected: PASS. (Optionally run the full `pnpm --filter api-gateway test` to confirm no regressions.)

- [ ] **Step 2: Frontend suite**

Run: `pnpm --filter resident-app test`
Expected: all suites PASS (existing foundation tests + homeStore, GateActivityRow, GateGlanceCard, QuickActionGrid, DuesSnapshotCard, CommunityStrip, ParcelsScreen).

- [ ] **Step 3: Type gate**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual acceptance** (`pnpm --filter resident-app start`)
  - Home tab: Deep Ocean AppBar, greeting + unit, Gate at a Glance (own-unit counts + latest event line), six quick actions, "Recent at the gate" rows with correct status badges, dues snapshot, community strip (pinned notice + event stub), tagline.
  - Pull-to-refresh updates counts.
  - Tapping the Parcels tile opens `ParcelsScreen`; **Mark collected** removes the parcel.
  - Invite Visitor / Pre-approve open the (interim) VisitorsScreen with a working back; Book facility / My Unit → My Unit tab; Raise ticket / Announcements / bell → Community tab.
  - Dues card opens the existing dues flow.

- [ ] **Step 5: Final commit (if any cleanup)**
```bash
git add -A
git commit -m "chore(resident): Home sub-project verification pass" || echo "nothing to commit"
```

---

## Self-review (author notes)

- **Spec coverage:** §3.1 aggregate → Task 3; §3.2 list → Task 1; §3.3 collect → Task 2; §4 client/store → Tasks 4–5; §5 screen + components → Tasks 6–13 (GateGlanceCard 7, QuickActionGrid 8, GateActivityRow 6, DuesSnapshotCard 9, CommunityStrip 10, ParcelsScreen 11, HomeScreen 12, routing 13); §6 error handling → Task 3 (allSettled), Task 5 (store error+preserve), Task 11 (optimistic restore), Task 12 (error empty-state); §7 tests → each task's test step + Task 14.
- **Out of scope honoured:** no parcel photo (deliveries has no image column); `upcomingEvent` is a stub; Book facility / Raise ticket / Announcements deep-link only; no next-invoice projection; no i18n.
- **Type consistency:** `HomeSummary`/`ActivityEvent`/`PinnedNotice` defined in Task 5 and consumed by Tasks 6, 7, 10, 12; `QuickAction` defined in Task 8 and consumed in Task 12; backend response keys (`gateGlance`, `recentActivity`, `dues`, `community`) match between Task 3 and Task 5.
- **Test runners:** api-gateway uses **vitest** + mocked `db/queries.js` (verified against `deliveries.test.js`); resident-app uses **jest-expo** + @testing-library/react-native (verified against `Button.test.tsx`).
- **Interim flag:** Invite Visitor / Pre-approve open the legacy dark VisitorsScreen (Task 11b adds a back control). Swap to a placeholder if preferred.
