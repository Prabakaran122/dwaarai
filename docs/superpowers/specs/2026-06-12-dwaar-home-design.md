# Dwaar AI Resident App — Home Tab

**Date:** 2026-06-12
**Branch:** `redesign/dwaar-light`
**Status:** Approved design — ready for implementation plan
**Sub-project:** 1 of 6 (Home) in the Dwaar AI resident-app redesign

---

## 1. Background

Sub-project 0 (Foundation + Nav Shell) is complete and committed: the light Dwaar
palette, DM Sans fonts, eight base components under `src/components/ui/`, the 5-tab
shell, and a dev component gallery. All four content tabs currently render a branded
`TabPlaceholder`.

This sub-project replaces the **Home** placeholder with the real Home dashboard, plus
the backend it needs. It is a **full-stack** sub-project per decision D3 of the
Foundation spec: every feature shown on Home that lacks a backend gets one here.

### Sources of truth
- **Foundation spec** — `docs/superpowers/specs/2026-06-11-dwaar-foundation-design.md`
  (tokens, components, nav shell, decisions D1–D4).
- **Design Brief v1.0** — brand colours, typography, spacing, component rules. The
  brief wins where mockups conflict (D1: light mode).
- **`docs/design-sources/share-home.txt`** — written Home-screen design rationale: lead
  with live gate activity, a compact quick-actions grid (evolved to six cards), a
  scannable "Recent at the gate" log with status badges, and a thin community strip.
  Deliberately *not* the cluttered Adda feature-dump.
- **Product requirement design Feedback.docx** (summarised in Foundation spec): "Gate at
  a Glance" with Visitor / Parcel / Helpers; a "My Dues" snapshot.

### Decisions inherited
- **D1** — Light mode (Mist background, Deep Ocean surfaces/headers).
- **D4** — "Gate at a Glance" / activity shows the resident's **own unit only.**

### Decisions taken for this sub-project
- **H1 — Data layer: a single aggregate endpoint** `GET /resident/home`, not a
  client-side fan-out. One round-trip, server-composed, independently testable.
- **H2 — Parcels: build the full resident loop now** — `GET /deliveries` (list) and
  `POST /deliveries/:id/collect` (mark collected). The guard already has the write side
  (`POST /deliveries`, `GET /deliveries/active`, `POST /deliveries/:id/status`).
- **H3 — Quick actions: all six cards from the brief**; the three whose tabs are not yet
  built (Book facility, Raise ticket, Announcements) deep-link to their tab placeholder.
- **H4 — Community strip: pinned notice (real) + a stubbed upcoming-event card** that is
  inert until the Events sub-project (4) ships an events backend.
- **H5 — Parcel photo is out of scope.** The `deliveries` table has no image column;
  adding guard photo capture touches the schema and the guard app, which is My Unit
  (sub-project 2) work. Home's parcels show company + note + age-coloured status only.

---

## 2. Goal

Replace the Home placeholder with a calm, live dashboard that, on open, answers "what's
happening at my gate right now" — backed by a single aggregate API and a resident
parcels loop. When complete, a logged-in resident sees Gate at a Glance counts, recent
gate activity, their dues status, and a community nudge, all in the light Dwaar brand,
built only from Foundation tokens/components.

**Explicitly NOT in scope:** parcel photo capture/upload (H5); real Events data (H4 stub);
the destination screens for Book facility / Raise ticket / Announcements (their own
sub-projects — Home only deep-links to placeholders); next-invoice projection in dues;
Hindi/Kannada string translation.

---

## 3. Backend — new work (`services/api-gateway`)

All routes require a resident JWT and are scoped to the caller's `unit_id`. Follow the
existing route/handler patterns in `src/routes/` and the standard
`{ success, data, error, meta }` response envelope. Add tests with the existing
jest + supertest setup.

### 3.1 `GET /api/v1/resident/home` (new route file `src/routes/resident-home.js`)
Aggregates the unit's home summary in one call. Sub-queries run with
`Promise.allSettled`; a rejected sub-query nulls **its own** section and is logged — it
never fails the whole response. Shape:

```jsonc
{
  "gateGlance": {
    "visitors": { "expected": 2 },          // visitor_passes status='active' for unit
    "parcels":  { "pending": 1 },           // deliveries status='waiting' for unit
    "helpers":  { "expected": 3, "arrived": 1 } // recurring_passes scheduled today; arrived via expected_visits
  },
  "recentActivity": [                        // ≤5 gate_events for the unit, newest first
    { "id", "ts", "plate", "method", "direction", "decision", "residentName" }
  ],
  "dues": { "outstanding": 4500, "earliestDueDate": "2026-06-30", "pendingCount": 2 },
  "community": {
    "pinnedNotice": { "id", "title", "authorName", "createdAt" } | null,
    "upcomingEvent": null                    // stub until sub-project 4
  }
}
```

- **visitors.expected** — count of `visitor_passes` where `status='active'` for the unit.
- **parcels.pending** — count of `deliveries` where `status='waiting'` for the unit.
- **helpers** — from `recurring_passes` (active) joined to today's `expected_visits`:
  `expected` = passes scheduled today, `arrived` = those with `status='arrived'` today.
- **recentActivity** — same source/shape as `GET /events/my-unit`, limit 5.
- **dues** — `outstanding` = sum of pending `total_amount`; `earliestDueDate` = min
  `due_date` among pending (null if none); `pendingCount` = number of pending dues.
- **community.pinnedNotice** — the top pinned official notice (or null).

### 3.2 `GET /api/v1/deliveries` (resident) — add to `src/routes/deliveries.js`
Lists the caller unit's deliveries, newest first. Optional `?status=waiting|delivered|left_at_gate`.
Returns: `id, company, note, status, logged_by_name, created_at, resolved_at`.
(The existing guard endpoints in this file are unchanged; the new handler is gated to
resident JWT + own unit.)

### 3.3 `POST /api/v1/deliveries/:id/collect` (resident) — add to `src/routes/deliveries.js`
Resident marks their own parcel collected: sets `status='delivered'`, `resolved_at=now()`.
- **403** if the delivery's `unit_id` ≠ caller's unit.
- **409** if the delivery is already resolved (`status≠'waiting'`).
- **404** if no such delivery.

---

## 4. API client + state (`apps/resident-app`)

### 4.1 `src/api/client.ts`
Add:
- `getResidentHome()` → `GET /resident/home`
- `getDeliveries(params?)` → `GET /deliveries`
- `collectDelivery(id)` → `POST /deliveries/:id/collect`

### 4.2 `src/store/homeStore.ts` (new, zustand — mirrors `dueStore`/`vehicleStore`)
State: `summary | null`, `loading`, `error`, `fetch()`. `fetch()` calls `getResidentHome()`,
populates `summary`, sets `error` on failure (keeps last `summary` for resilience).

---

## 5. Home screen — `app/index.tsx` wiring + `src/screens/HomeScreen.tsx` (rebuild)

The Home tab stops rendering `TabPlaceholder` and renders the rebuilt `HomeScreen`. The
existing dark `HomeScreen.tsx` is replaced wholesale (no `LinearGradient`/`GlowCard`).
All colours/spacing/type from Foundation tokens; no hardcoded hex.

Layout, top → bottom, inside a `ScrollView` with pull-to-refresh:
1. **AppBar** (Deep Ocean) — title = community name (fallback "Home"); bell with notif
   count badge.
2. **Greeting row** — `Good {morning|afternoon|evening}, {firstName}` + `Unit {n} · {community}`.
3. **Gate at a Glance** — a card with a live pulse dot, three tiles
   (**Visitors** `expected`, **Parcels** `pending`, **Helpers** `arrived/expected`) and a
   one-line latest gate-event summary. Tapping the Parcels tile opens `ParcelsScreen`.
4. **Quick actions** — six `QuickActionCard`s in a grid: Invite Visitor, Pre-approve,
   Book facility, My Unit, Raise ticket, Announcements. Each calls `onNavigate(tab)`;
   the not-yet-built ones land on the tab placeholder (H3).
5. **Recent at the gate** — `SectionHeader title="Recent at the gate" actionLabel="See all"`
   then ≤5 `GateActivityRow`s. Each row shows the plate (`PlateText` when present),
   direction, method, relative time, and a `StatusBadge` mapped from `decision`
   (`allow→granted`, `deny→denied`, `guard_review→pending`). Empty → branded empty state.
6. **My Dues** — `DuesSnapshotCard`: `₹{outstanding} outstanding · due {earliestDueDate}`
   with an amber **Pay** affordance, or "No dues pending" when `outstanding=0`. Tapping
   opens the existing dues flow.
7. **Community strip** — `CommunityStrip`: the pinned-notice card (tappable → Community
   tab) and a stubbed upcoming-event card (visually present, inert — H4).
8. **Tagline** — "Open the right door", `type.micro`, centered, bottom padding.

### 5.1 New components (`src/components/`, token-driven, each unit-tested where it has logic)
- `GateGlanceCard` — props: the `gateGlance` object + latest activity line + `onParcels`.
- `QuickActionGrid` / `QuickActionCard` — icon, label, sub-label, `onPress`.
- `GateActivityRow` — maps one activity event to a row + `StatusBadge` preset.
- `DuesSnapshotCard` — props `outstanding`, `earliestDueDate`, `onPress`.
- `CommunityStrip` — props `pinnedNotice`, `upcomingEvent` (null-safe).
- `ParcelsScreen` (`src/screens/ParcelsScreen.tsx`) — lists `getDeliveries()`, each parcel
  card shows company + note + status badge (age-coloured: new neutral, 1-day grey,
  ≥3-day error border) + a **Mark collected** `Button` calling `collectDelivery(id)`.
  Back to Home via `AppBar` back chevron.

---

## 6. Data flow & error handling

- Mount → `homeStore.fetch()` → render from `summary`. Pull-to-refresh re-fetches.
- Per-section emptiness (no pinned notice, 0 parcels, no activity) renders as
  empty/hidden — **not** an error.
- Hard fetch failure with no prior `summary` → a branded error state with a **Retry**
  button. With a prior `summary`, the screen keeps showing it and surfaces a quiet
  refresh-failed hint.
- `collectDelivery` optimistic-removes the parcel from `ParcelsScreen` on success; on
  failure it restores the item and shows an inline message.
- The aggregate endpoint's `Promise.allSettled` design means a backend hiccup in one
  feature (e.g. notices) degrades that section to null, not the whole screen.

---

## 7. Testing / acceptance criteria

### Backend (jest + supertest, `services/api-gateway`)
- `GET /resident/home`: returns the documented shape; counts correct against seeded
  fixtures; scoped to the caller's unit only (no cross-unit leakage); requires auth.
- `GET /deliveries` (resident): returns only the caller unit's deliveries; `?status`
  filters; requires auth.
- `POST /deliveries/:id/collect`: marks `delivered` + sets `resolved_at`; **403** on a
  cross-unit parcel; rejects an already-resolved parcel; **404** on unknown id.

### Frontend (jest-expo + @testing-library/react-native, `apps/resident-app`)
- `homeStore.fetch`: populates `summary` on success; sets `error` and preserves prior
  `summary` on failure.
- `GateGlanceCard`: renders the three counts; Parcels tile fires `onParcels`.
- `QuickActionCard`: fires `onPress`.
- `DuesSnapshotCard`: shows outstanding+due when `outstanding>0`; shows "No dues pending"
  when `0`.
- `GateActivityRow`: maps `allow/deny/guard_review` → `granted/denied/pending` badge.
- `ParcelsScreen`: renders a parcel; **Mark collected** calls `collectDelivery` and
  removes the row.

### Manual acceptance (`pnpm --filter resident-app start`)
- Home tab shows the AppBar, greeting, Gate at a Glance (own-unit counts), six quick
  actions, recent gate activity with correct status badges, dues snapshot, and the
  community strip — all in DM Sans / light Dwaar palette, no crashes.
- Pull-to-refresh updates counts. Tapping Parcels opens the list; Mark collected updates
  it. Not-yet-built quick actions land on their placeholder.

### Gates
- `pnpm --filter resident-app test` and `pnpm --filter api-gateway test` pass.
- `pnpm --filter resident-app exec tsc --noEmit` clean.
- No hardcoded hex in new components (tokens only); back-compat colour aliases untouched.

---

## 8. Risks / notes

- **`deliveries` has no photo column** (H5) — Home/Parcels show text + status only; guard
  photo capture is sub-project 2 (schema + guard app).
- **Helpers "expected today"** depends on `recurring_passes.schedule_days` semantics
  matching the `GET /staff` / `expected_visits` logic already in use — reuse that query,
  don't re-derive the schedule rule.
- **Aggregate vs existing routes** — `/resident/home` duplicates count logic that lives in
  individual routes. Keep each sub-query small and, where practical, share helpers rather
  than copy SQL, so the numbers can't drift from the per-feature screens.
- **Old `HomeScreen.tsx` dependencies** (`GlowCard`, `AnimatedEntry`, `IconBadge`,
  `expo-linear-gradient`) remain in the repo for other unrouted dark screens; the rebuilt
  Home stops importing them. Removing those components is deferred to later sub-projects.
