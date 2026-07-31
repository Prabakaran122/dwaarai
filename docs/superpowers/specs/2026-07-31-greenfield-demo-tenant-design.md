# Greenfield Faridabad Sector 43 — demo tenant & live traffic generator

**Date:** 2026-07-31 · **Status:** approved design, not yet implemented
**Target:** EC2 (`54.235.41.163`), reachable at `https://dwaarai.in/admin`

## Goal

A permanently-live demo society that can be shown to a prospect at any hour without
preparation. Sign in from the marketing site, switch to the community, and every page of
the admin portal shows a plausible mid-size Faridabad society — with new gate traffic
arriving while the prospect watches.

## Non-goals

- No new UI. The portal and the site's "Sign in" link already exist and are unchanged.
- No new admin account. `superadmin` already reaches any community.
- Not a load test. Volume is tuned for believability, not throughput.

## What already exists (verified 31 Jul 2026)

| Piece | Where | State |
|---|---|---|
| "Sign in" → `/admin` | `dist/index.html`, `how-it-works.html`, `resources.html` | live, no change needed |
| Admin login | `apps/admin-portal/app/login/page.tsx` | exists |
| Dashboard (KPIs, charts, live feed, gate-ops, edge-health, performance) | `apps/admin-portal/app/page.tsx` | exists (PR #13) |
| Community scoping | `dashboard.js:46` reads `req.user.community_id` | every query is scoped |
| Super-admin cross-community view | `middleware/auth.js:33` honours `X-Community-Id` | portal sends it from `cg_selected_community_id` (`lib/api.ts`) |
| Event ingestion | `POST /events/sync`, `routes/gates.js:206` | inserts `gate_events` **and** broadcasts `gate:event` |
| Device auth | `middleware/auth.js:44` | JWT signed with `JWT_SECRET`, carries `community_id` + `gate_id` |

**Consequence:** the demo needs *data* and a *generator*, not new product surface.

## Architecture

```
demo-traffic (systemd, EC2)                    api-gateway
  ├─ mints device JWT per gate  ──────────►  authenticateDevice
  └─ POST /api/v1/events/sync   ──────────►  INSERT gate_events
                                              └─ broadcast('gate:event') ──► portal live feed
```

The generator is an ordinary API client. Events travel the same path a real edge node
uses, so the dashboard's behaviour during a demo is evidence about the product rather
than about the seeder.

**Rejected:** direct DB inserts (no socket broadcast — the live feed would sit frozen,
which defeats the point); running the real edge node with its mocks (drags ANPR and
hardware dependencies onto EC2 for a 24/7 process).

## 1. Tenant

- **Community:** `Greenfield Faridabad Sector 43`, city Faridabad, 450 units.
- **Blocks:** Towers A–F, 12 floors each.
- **Units:** `A-1204` style. Mostly `occupied`, a realistic tail of `vacant` and `rented`.
- **Residents:** ~1,100, Haryana/Delhi-belt names, owner/tenant mix, one primary per unit.
- **Vehicles:** ~600 (see §2).
- **Gates:** Main Entry, Exit Gate, Service & Vendor Gate.
- **Guards:** ~8 across three shifts.

The community row uses a **fixed UUID** so the generator can be pinned to it and the whole
tenant removed with one scoped delete. Child rows use generated UUIDs and are reached via
`community_id`.

## 2. Local authenticity

Plates weighted to the catchment area, normalised (`HR51AB1234`) with display form
(`HR 51 AB 1234`):

| Series | Share | Why |
|---|---|---|
| HR-51 | ~45% | Faridabad RTO |
| HR-38 | ~15% | Faridabad/Ballabgarh |
| DL-xx | ~20% | Delhi commuters — very common in this belt |
| HR-26 | ~10% | Gurgaon |
| UP-16 / UP-14 | ~10% | Noida/Ghaziabad |

Vehicle mix reflects what actually parks in such a society: Swift, Baleno, Brezza, i20,
Creta, Nexon, Punch, City, Scorpio, XUV700, Innova, Seltos — plus a real two-wheeler
population (Activa, Splendor, Pulsar, Classic 350) and service e-rickshaws/tempos at the
vendor gate. Roughly 55% cars, 35% two-wheelers, 10% commercial/service.

## 3. History backfill

Dashboard queries look back 25 hours, 3 days, 7 days and 8 days. The seed writes
**10 days** of `gate_events` (~1,150/day, ~11.5k rows) already shaped by the §4 rhythm, so
every chart is populated at first login rather than filling in over the following week.

## 4. Live generator

A Node service, `dwaarai-demo-traffic`, run by systemd on EC2. Always on.

**Arrival process.** Inter-arrival gaps are drawn from an exponential distribution whose
rate depends on hour-of-day and day-of-week — a Poisson process. This matters: a uniform
random delay produces an even drip that reads as synthetic to anyone who knows the
domain, whereas a Poisson process clusters naturally into bursts and lulls.

Rate curve (events/hour **community-wide across all three gates**, weekday). It sums to
~1,150 events/day, matching the backfill volume in §3. Per-gate split is roughly
55% main entry / 30% exit / 15% service:

| Window | Rate | Character |
|---|---|---|
| 01:00–05:00 | ~3 | near-dead; the odd cab or late return |
| 06:00–08:00 | ~45 | milk/paper/staff arrivals, early walkers |
| 08:00–10:00 | ~130 | office + school rush, the day's peak |
| 10:00–13:00 | ~55 | deliveries, domestic staff, visitors |
| 13:00–17:00 | ~40 | school return, steady trickle |
| 18:00–21:00 | ~110 | evening return peak |
| 21:00–24:00 | ~30 | tapering |

Weekends flatten the commute peaks and raise midday visitor traffic.

**Event mix.**

- *Decisions:* ~92% `allow`, ~4% `guard_review`, ~3% `deny`, ~1% `override`.
- *Deny reasons:* not on whitelist, expired pass, blacklisted plate, unreadable plate.
- *Methods:* RFID, ANPR, QR pass, manual/guard, biometric — weighted by gate (the service
  gate skews manual/QR; the main gate skews RFID/ANPR).
- *Direction:* entry/exit balanced over the day, entry-heavy in the evening.
- *Detail:* ANPR confidence and `processing_ms` drawn from plausible distributions, not
  constants.

Residents recur: the same vehicles come and go across days, so a prospect scrolling the
feed sees familiar plates rather than 600 strangers.

## 5. Portal depth

Every nav item is seeded so nothing is a dead end mid-demo:

visitors & passes · deliveries (Amazon, Flipkart, Blinkit, Zepto, Swiggy) · incidents ·
resolved SOS alerts · RWA notices (water tanker, AGM, Diwali) · dues · facilities
(clubhouse, gym, pool, banquet) with bookings · committee polls · guards, shifts and
handovers · RFID cards · staff access windows (maids, drivers, cooks) · pets.

The generator also trickles new **deliveries** and **visitor entries**, so those pages
move too rather than showing a frozen snapshot.

## 6. Production code change (the only one)

`routes/gates.js:206` hardcodes `is_offline_event = true`, so generated events would all
look like late offline syncs and could skew the edge-health and attention panels.

**Change:** `eventSyncItemSchema` accepts an optional `is_offline_event`; the handler uses
it when present and **defaults to `true`** when absent. Real edge nodes are unaffected.
The generator sends `false`.

The mirrored schema in `gate-command-service/src/routes.js` is widened in step, per the
note in `schemas/event-sync.js`.

## 7. Safety and isolation

- Seed is **idempotent**: it deletes and rewrites only its own `community_id`.
- Generator **refuses to start** if its configured community is not the demo one.
- Palm Meadows and the tester accounts (`guard1`, resident `11708DE8`) are untouched.
- Teardown is one scoped delete across tables in FK order.
- `JWT_SECRET` is read from the environment, never hardcoded.

## 8. Testing

- Rhythm curve: night rate strictly below peak rate; all rates positive.
- Plate generator: matches the Indian plate regex; series distribution within tolerance.
- Decision/method mixes: within tolerance over a large sample.
- **Contract:** generated payloads validate against `eventSyncItemSchema`, reusing
  `src/__tests__/event-sync-contract.test.js`.
- `--dry-run` prints events without posting, for eyeballing realism before going live.

## 9. Deployment

1. Run migrations if any are outstanding.
2. Run the seed once against the EC2 Postgres container.
3. Install and enable `dwaarai-demo-traffic.service`.
4. Verify: log in as `superadmin`, switch to Greenfield, confirm charts are populated and
   the live feed advances.

## 10. Demo flow

Website "Sign in" → `/admin/login` → `superadmin` / `admin123` → select
**Greenfield Faridabad Sector 43** → dashboard.

The selection persists in `localStorage`, so it is a one-time step per browser. On a fresh
browser, select the community *before* screen-sharing rather than during.

## Open items

None blocking. Post-implementation, consider whether the demo tenant should be excluded
from any production reporting that aggregates across communities.
