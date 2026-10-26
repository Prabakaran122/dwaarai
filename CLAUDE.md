# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# CommunityGate

Vehicle access control platform for residential communities. Cloud microservices (Node.js/Express) manage residents, vehicles, visitors, and gate commands. Edge nodes (Raspberry Pi, Python) run ANPR cameras, RFID/FASTag/UHF readers, and a ZKTeco C3-100 access controller, syncing with the cloud over MQTT.

**Stack:** Node.js 20+ (ESM), Python 3.11+, PostgreSQL, Redis, MQTT (Mosquitto in dev / AWS IoT Core in prod), pnpm monorepo, AWS CDK for infra, Next.js 14 admin portal, React Native (Expo) guard + resident apps.

## Commands

### Dev environment
```
pnpm dev                # docker compose up: postgres, redis, mosquitto, anpr-service, api-gateway, vehicle-service, gate-command-service, edge-emulator
pnpm db:migrate         # apply services/api-gateway/migrations/*.sql against $DATABASE_URL
```
Note: `docker-compose.dev.yml` does not include `visitor-service`, `notification-service`, or `audit-service` — run those with `pnpm --filter <name> dev` alongside the compose stack when working on them.

### Node services/apps (pnpm workspace: `apps/*`, `services/*`, `infra/cdk`)
```
pnpm --filter api-gateway dev        # node --watch, one service
pnpm -r run test                     # all Node tests (vitest), repo-wide
pnpm --filter vehicle-service test   # vitest for one service
pnpm --filter api-gateway exec vitest run src/__tests__/gateway.test.js   # single test file
pnpm --filter api-gateway migrate    # run pending SQL migrations, idempotent (re-run must print "up to date")
```
Each `services/*` has its own `vitest.config.js` and an `src/__tests__/` (or `src/routes/__tests__`) directory — there is no shared/root test runner config.

### Python (edge + anpr-service)
```
pip install -r edge/requirements.txt
pip install -r services/anpr-service/requirements.txt
pytest tests/ -v --tb=short                          # all Python tests (unit + integration)
pytest tests/unit/test_c3_controller.py -v            # single file
pytest tests/unit/test_c3_controller.py::test_name -v # single test
```
Python tests need edge env vars set (mocks on): `USE_GPIO_MOCK=true USE_RFID_MOCK=true USE_CAMERA_MOCK=true GATE_ID=gate-test COMMUNITY_ID=test-community DEVICE_TOKEN=test-token MQTT_BROKER=localhost OFFLINE_DB_PATH=/tmp/test_whitelist.db OFFLINE_QUEUE_PATH=/tmp/test_queue.db` (see `.github/workflows/ci.yml` for the full list, including `DATABASE_URL` and `ANPR_SERVICE_URL`).

### Frontend apps
```
pnpm --filter admin-portal dev        # Next.js 14, port 3100
pnpm --filter admin-portal lint
pnpm --filter guard-app start         # Expo (React Native, Android tablet)
pnpm --filter resident-app start      # Expo (React Native, iOS + Android)
pnpm --filter resident-app test       # jest
pnpm --filter resident-app exec jest src/screens/DuesScreen.test.tsx   # single test file
pnpm --filter resident-app typecheck  # tsc --noEmit
pnpm --filter guard-app test          # jest (jest.config.js, jest-expo preset)
pnpm --filter valet-app start         # Expo (DwaarAI Valet app, iOS + Android)
pnpm --filter valet-app test          # jest
pnpm --filter valet-app typecheck     # tsc --noEmit
pnpm --filter valet-guest dev         # Next.js 14 guest valet page, port 3110
pnpm --filter valet-guest test        # vitest + @testing-library/react (jsdom)
pnpm --filter admin-portal test       # vitest (lib/ only; the pages are not unit-tested)
```
`guard-app` and `resident-app` both run jest; `admin-portal` and `valet-guest` run vitest. The two vitest configs set `globals: false` to match the services, so `valet-guest` registers Testing Library's `cleanup` explicitly in `vitest.setup.ts` — without it renders stack up across tests.

### Infra (AWS CDK)
```
pnpm --filter communitygate-infra build   # tsc
pnpm --filter communitygate-infra synth
pnpm --filter communitygate-infra diff
pnpm --filter communitygate-infra deploy  # cdk deploy --all — never run without explicit user request
```

### CI (`.github/workflows/ci.yml`)
Four jobs: `test-python` (pytest against real postgres/redis/mosquitto containers), `test-node` (`pnpm -r run test`), `migrations` (applies all migrations to a fresh DB, then asserts a second run is a no-op), `arm-build` (cross-builds the edge Docker image for linux/arm64, since it ships on Raspberry Pi).

## Architecture

### Services (`services/*`, each an independent Express app + own Postgres migrations/tables)
- **api-gateway** (port 3000, `PORT_API_GATEWAY`) — the primary backend. Owns almost all domain routes (auth, vehicles, passes, dues, notices, facilities, community feed, guard/resident/admin views, face recognition, SOS, incidents, deliveries, handovers, etc.), the Postgres migration runner (`src/db/migrate.js`, 42+ sequential `migrations/*.sql` files), Socket.IO (`websocket.js`) for live dashboard/guard updates, and MQTT publish for gate commands (`mqtt.js`).
- **vehicle-service** (3020), **visitor-service** (3030, OTP-based pre-approvals), **gate-command-service** (3050, mirrors the event-sync schema and publishes MQTT commands), **notification-service** (3004, FCM + SMS via `msg91`), **audit-service** (3005, PDF report generation) — smaller domain services split out of api-gateway, each with its own `src/routes.js` + `src/db.js`.
- **valet-service** (3060, `PORT_VALET_SERVICE`) — the DwaarAI Valet flow: guard ticket handling, the public guest-page API, and operator plate-history reporting. Its tables ship in `043_valet.sql` like every other service's (api-gateway owns all migrations). Media goes through `src/lib/storage.js`, which selects S3 or a local directory from `VALET_STORAGE`. Routes mount on an `asyncRouter()` (`src/lib/async-router.js`) rather than a bare `express.Router()`: Express 4 does not forward an async handler's rejection to the error middleware, so without it a database blip hangs the request with no response instead of returning 500.
- **anpr-service** (Python, FastAPI-style, port 8001) — plate detection/OCR (`detector.py`, `ocr_engine.py`, `normalizer.py`), called by both the edge node and the cloud.

There is no shared Node package for cross-service code — each service duplicates its own `db/pool.js`-equivalent and route conventions rather than importing from a common library.

### Edge node (`edge/`, Python, runs on the Raspberry Pi at each gate)
`gate_controller.py` is the main entrypoint and decision loop. Key architectural points:
- **C3 access controller integration is pluggable** via `USE_C3_MOCK` / `USE_C3_PUSH` env flags, selecting one of three interchangeable implementations: `emulators/c3_mock.py` (dev/CI), `c3_push_controller.py` (PUSH/ADMS — the panel dials into a server the edge hosts; required for card writes), or `c3_controller.py` (legacy PULL/TCP:4370 polling, read-only). See `edge/config.py` for the full flag set and `edge/C3_PUSH_SETUP.md` for the hardware setup.
- **Entry vs exit gates behave differently**: entry gates resolve known cards locally via C3 and fall back to ANPR correlation for unknown cards; exit gates are camera-audit-only (no C3). Every event is stamped with `direction` (`entry`/`exit`) since occupancy/overstay logic on the cloud side depends on it.
- **Offline-first**: `whitelist_sync.py` periodically pulls the resident/vehicle whitelist and blacklist into a local SQLite cache (`OFFLINE_DB_PATH`) so gate decisions work without connectivity; `offline_queue.py` buffers outgoing events in SQLite (`OFFLINE_QUEUE_PATH`) and syncs them to the cloud when back online, with a 3-attempt quarantine for permanently-rejected (400/422) events.
- **UHF USB reader** (`uhf_usb_reader.py`) is a fallback for FASTag-style readers that emit the full 96-bit EPC over a USB-HID keyboard interface, since the C3's card field can only hold 32 bits. It hooks the OS-wide keyboard stream, so it filters strictly on EPC length + inter-keystroke timing to avoid mistaking human typing for a tag read.
- Everything hardware-facing has a `emulators/*_mock.py` counterpart (camera, GPIO, RFID, UHF, C3 push device) so the edge runs fully mocked in Docker/CI (`edge/Dockerfile.dev`, the `edge-emulator` service in `docker-compose.dev.yml`).
- `edge/tools/` holds interactive scripts for bring-up/debugging real hardware (`c3_console.py`, `c3_live_test.py`, `rfid_tap_test.py`, `provision_gate.py`, etc.) — not part of the runtime path.

### The edge ↔ cloud contract
`POST /events/sync` is the single channel edge nodes use to report gate activity to the cloud, and it's intentionally pinned in three places that must be changed together: the zod schema in `services/api-gateway/src/schemas/event-sync.js`, the mirrored schema in `services/gate-command-service/src/routes.js`, and the `gate_events` table (currently through migration 031). `tests/fixtures/edge-event-sync.json` is the golden payload both `tests/unit/test_event_sync_contract.py` (Python/edge side) and `services/api-gateway/src/__tests__/event-sync-contract.test.js` (Node/cloud side) validate against — when the edge starts emitting a new field, widen all three plus the fixture.

### Frontend apps (`apps/*`)
- **admin-portal** — Next.js 14 App Router (`app/<section>/page.tsx` per feature: gates, communities, units, vehicles, guards, incidents, sos, reports, etc.), talks to api-gateway via `lib/api.ts` and live updates via `lib/socket.ts`. The `app/valet/*` pages are the exception: they talk to valet-service via `lib/valet.ts`, a second client on a different base URL that reuses the same api-gateway JWT from localStorage.
- **guard-app** — Expo/React Native, Android tablet at the gate. Zustand stores per domain in `src/store/` (queue, approvals, SOS, handover, staff, deliveries), i18n via `src/i18n/translations.ts` (guards may not read English).
- **valet-app** — Expo/React Native, the DwaarAI Valet product. A **separate app from guard-app on purpose**: a hotel valet is not a society gate guard, and folding valet in would have meant them signing into "Nazar — Guard Station" and seeing a tab bar of Gate / Visitors / Parcels / Incidents they will never use. It has no tab bar at all — the whole app is the three-screen valet flow (queue → new ticket → handover) behind its own DwaarAI Valet sign-in. Auth is *not* separate: it posts to the same `/auth/guard-login` and `residents.type='guard'` records, because valet-service verifies those tokens and a property's staff exist once.
- **valet-guest** — Next.js 14, `basePath: /valet`, the one public surface: a guest opens `/valet/v/<session token>` by scanning a physical valet card. No login and no account — the token in the URL is the only credential, so reopening the link reconstructs the state exactly. The one thing in localStorage is a random device id (`dwaarai.valet.deviceId`) that the card page sends as `X-Valet-Device`; see card binding below.
- **resident-app** — Expo/React Native, iOS + Android. Same store-per-domain + screen-per-feature pattern as guard-app, but with much heavier Jest test coverage (most screens/components have a co-located `.test.tsx`).

### Infra (`infra/cdk`)
Six CDK stacks wired together in `bin/app.ts`: `NetworkStack` (VPC/cluster) → `DataStack` (RDS + Redis + S3, depends on VPC) → `AuthStack` (Cognito) → `IotStack` (AWS IoT Core, replaces Mosquitto in prod) → `ServicesStack` (ECS services, depends on all of the above) → `FrontendStack`. Region is hardcoded to `ap-south-1`.

### Database migrations
Sequential, numbered SQL files in `services/api-gateway/migrations/` (`001_core.sql` ... `046_valet_claim_codes.sql`), applied in order by `src/db/migrate.js` and tracked so re-application is a no-op (CI enforces this in the `migrations` job). This is the only migration path in the repo — other Node services read/write the same Postgres database but don't own migrations themselves.

### Valet (DwaarAI Valet)
Ported from a standalone Express + SQLite prototype into this monorepo. Three
things changed structurally in the port, and each is load-bearing:

- **Timestamps are `TIMESTAMPTZ`, never ISO strings in TEXT.** The prototype
  compared `toISOString()` output against SQLite's `datetime('now')`, which
  formats differently (`2026-08-10 14:11:15` vs `2026-08-10T14:11:15.294Z`);
  since SQLite compares TEXT lexicographically and `' '` sorts before `'T'`,
  the retention sweep silently matched nothing and never deleted a photo.
- **Guards are `residents` rows with `type = 'guard'`,** not a name-keyed side
  table. Staff-badge fields (`employee_code`, `badge_photo_key`,
  `badge_consent_at`) hang off that row, and every guard reference in the valet
  tables is a real FK.
- **Three DPDP consent timestamps stay separate** — photo capture, discount
  opt-in, and the guard's own badge are distinct collection purposes and must
  never be merged into one blanket consent.

Two invariants are enforced server-side, not just in the UI, and have tests
saying so: a pickup cannot be confirmed without a successful QR scan *since the
current arrival*, and not without return-stage condition media captured since
that same arrival. A ticket flagged `disputed` is exempt from the media
retention sweep, checked at deletion time so flagging after the fact still
protects the media.

**Physical cards (044, 045).** A venue prints a box of cards once; each QR
encodes `/valet/c/<code>`. A guard scans one at intake to bind it to a ticket,
and it frees itself when the ticket closes — reusable per venue. **The card is
mandatory**: `POST /guard/tickets` and `/tickets/start` refuse a ticket with no
`cardCode` (400 `card_required`), so a venue must register stock before its
first car. The app's card hint says so; it used to offer "No card — show the QR
on screen", a path the server refuses.

- Stock is registered by an **operator** (`POST /admin/cards`, admin portal at
  `/admin/valet/cards`), never invented by the intake path — otherwise a
  mis-scan silently creates a card matching nothing that was printed. Until a
  venue registers stock, every scan at the stand fails.
- A card is on at most one open ticket, enforced by a partial unique index.
  `resolveCard()` only exists to turn that into a readable error; two guards
  scanning at once (or two service instances) reach the index, so a `23505` on
  `idx_valet_card_one_open_ticket` is translated to the same 409. The match is
  on the **constraint name**, because the same INSERT can violate
  `UNIQUE (community_id, display_id)` — a genuine fault that must not be
  reported as "card is taken".
- The card carries only the short code. `GET /guest/cards/:community/:code`
  exchanges it for a session token and returns nothing else about the car. An
  unknown code 404s; a registered card answers 200 even with no ticket on it
  (`sessionToken: null`) -- a deliberate trade, documented in `guest.js`, since a
  guest who scans promptly arrives before intake finishes. The card page says
  "Your car is with us" only when a ticket is on the card, and otherwise polls
  until one is.
- Retiring a card deactivates rather than deletes: every ticket it has been on
  references it, and that history is the audit trail.

**A card's QR must carry the venue** — `/valet/c/<community uuid>/<code>`.
Card codes are unique per *venue*, deliberately, because every box of printed
cards starts at A001 and two properties will own the same codes without
coordinating. The first version resolved a bare code globally with `LIMIT 1`,
so once two venues each had A001 on an open ticket a guest could scan their own
card and be shown a stranger's vehicle at a property they had never visited.
`scripts/e2e-claim.mjs` reproduces the two-venue collision and pins the scoped
resolution.

**Claim codes (046)** are what a guest walks away with when there is no card.
Scanning the screen QR only works while they are standing at the desk, and
photographing it barely helps — reading that picture back needs a second
device. Every ticket issues a six-character code the guard can say out loud;
the guest enters it at `/valet`. Unlike a card code it is globally unique
among open tickets, because the guest types it with no venue context. The
alphabet omits O/I/S/0/1 and the lookup folds those onto their survivors, since
a guest typing one has misread a character that IS in the alphabet.

**Plate search** matches anywhere in the plate, not just the start — guests
quote the last four digits far more often than the state code. The trigram
index in 045 replaces 044's prefix index, which a leading wildcard cannot use
at all. Three places must agree: valet-app's client-side `visibleTickets()`,
`GET /guard/tickets/search`, and `GET /admin/tickets/search`.

**Display ids are allocated under an advisory lock**, not a row lock. The row
lock it replaced never serialised anything: both transactions lock the same
existing last row, and the loser resumes with a result set computed before the
winner's row existed, picks the same number and 500s mid-intake — and with no
tickets yet there was no row to lock at all.

**Identity at handover is recorded, not assumed.** The QR scan proves the
person holds the live ticket; it says nothing about who they are. The intake
photo is the second factor and is *optional* — a guest may decline it under
DPDP, and a denied camera must not strand a parked car — so a release can
legitimately happen with no photo on file. `confirm-pickup` therefore takes a
`verification` of `photo` or `vehicle_confirmed` and stamps it on the
`closed_pickup` / `final_closed` event, and the admin timeline shows which.
Two rules hold it together:

- The server **refuses** a `photo` claim on a ticket carrying no photo. The
  client is the thing being audited; an app that could claim a match it never
  performed would write exactly the record a dispute relies on being true.
- A request with no `verification` falls back to the truth, never to `photo` —
  an APK built before this change must not have its releases recorded as photo
  matches.

The handover screen reads `hasPhoto` from the ticket to decide which UI to
show, and never offers "Person matches" until the `<Image>` has reported
`onLoad`. **The image carries no credential.** The photo endpoint needs a guard
token and `<Image source={{uri}}>` sends none; putting `headers` on the source
did not fix it on a device -- the native loader dropped the header (seen in
Expo Go / New Architecture), the request 401'd, and the guard was asked to
match a face against an empty frame while a Jest test asserting the header
passed. The app now asks `POST /guard/tickets/:token/photo-link` for a link
signed for that one photo (`lib/photo-link.js`, two minutes, its own purpose
claim) and loads `GET /guard/photo-links/:sig` with no header. A load failure
shows "the photo did not load", a retry, and the vehicle check -- recorded as
`vehicle_confirmed`, never `photo`.

**Condition photos are the same four views everywhere** -- front, right, back,
left, in that order (`valet-app/src/lib/conditionAngles.ts`, mirrored in
`guard.js`). Return used to accept one photo in a different order, so a dispute
compared four "before" views with as few as one "after". The server still
accepts one return capture (an older APK must not strand a car at handover);
the app requires all four.

**A non-final handover sets `with_guest` (070), not `parked_again`.** The car is
out with a multi-day guest: open (URL, card and claim code keep working),
holding no slot, not requestable, listed under the valet app's "Taken out"
tab. It used to go straight to `parked_again`, so the lot, the slot count,
"parked right now" and the guest's own page ("Parked for 29 min") all said it
was parked while the guest drove it. A valet ends it with **Car is back**:
four fresh intake-stage photos, then `POST /guard/tickets/:token/returned`,
which refuses without them (409 `condition_required`) and moves the status and
writes `returned_by_guest` (071) in one transaction. `with_guest` expires with
the stay like any other open ticket.

**A card opens its car on one phone only (072).** Card codes are sequential
(A001…), and the card QR carries the venue id, so anyone holding one card could
walk the rest and get every open car's guest link. The printed QR cannot change,
so `GET /guest/cards/:community/:code` binds an open ticket to the first device
that asks (`X-Valet-Device`, stored as sha256 in `valet_tickets.card_device_hash`
via a conditional `UPDATE … WHERE card_device_hash IS NULL`). Any other device —
or no header — gets `{ sessionToken: null, locked: true }` and no `waRef`; the
card page then asks for the claim code (which opens the ticket without
requesting the car). Card lookups are rate-limited per IP in the service
(`VALET_GUEST_CARD_RATE_PER_MIN`, default 30; the rest of `/guest` 240), which
needs `trust proxy` — set in both valet-service and api-gateway, one hop.
The card's `wa_ref` is replaced at every intake (`rotateCardRef`), because the
card page hands it out while the card is idle, and a number held on a card
(`pending_wa_phone`) is only claimed if it arrived in the last 15 minutes.

**No intake can lock a card for good (073).** Scanning a card creates a
`parking_in_progress` ticket at once. `POST /guard/tickets/:token/cancel-intake`
expires one from `requested`/`accepted`/`parking_in_progress`
(`intake_cancelled`), the app's Arriving tab offers Resume and Cancel, and the
sweep expires intakes idle longer than `VALET_STALE_INTAKE_HOURS` (6;
`intake_abandoned`). 073 also lets `created_by_guard_id` be NULL (a car logged
at the desk by an admin, who is not a `residents` row — that insert used to 500
on every call) and lets an intake with no plate be `expired`.

**Status transitions are conditional updates.** Accept, accept-intake, arrived,
complete, returned, confirm-pickup and expire all `UPDATE … WHERE status = <expected>
RETURNING`, and answer 409 `status_changed` when another valet got there first.
One open ticket per slot is a partial unique index (074, matching
`HOLDING_A_SLOT`); `/complete` locks the slot row and answers 409 `slot_taken`.

**The sweep never strands a car mid-handover.** `en_route` and `arrived` never
expire; parked/requested/`with_guest` expire only at `stay_end_at` +
`VALET_EXPIRY_GRACE_HOURS` (12). A guest who leaves late can still get their car.

**Admin condition photos use signed links**, like the handover photo: `POST
/admin/tickets/:token/media-links` → `{ links: { [id]: "/admin/media-links/<sig>" } }`,
120s, purpose `admin_media`, scoped to the admin's community. A plain `<img>` on
an auth route never sends the token, so every tile used to be broken.

**Staff access is checked per request.** valet-service rejects a guard token
whose `residents.is_active` is false or whose `valet_until` has passed (401
`staff_inactive`, cached 30s); api-gateway refuses both at login and refresh.

**api-gateway auth:** login limits are per identity + IP (5/min) plus 30/min
per IP — the old limiter keyed on `req.ip` behind nginx, so the whole platform
shared one bucket of 5. The dev master OTP needs `ALLOW_DEV_MASTER_OTP=true`
*and* `NODE_ENV !== 'production'`; `setup-server.sh` writes
`NODE_ENV=development` into the production api-gateway unit, so the explicit
flag is the real guard. OTPs are never logged.

**TLS.** The dwaarai.com certificate once also covered `dwaarai.in`; when that
domain stopped resolving, every renewal failed and the cert expired, taking the
whole site, the guest pages and the valet app down for two days. It now covers
dwaarai.com and www only, and `sync-and-deploy.sh` prints the days left on
every deploy (warning under 21).

`services/valet-service/scripts/e2e-cards.mjs` and `e2e-verification.mjs` cover
all of this against a real service and database.

The retention/expiry sweep runs as a scheduled job
(`pnpm --filter valet-service sweep`), not on a `setInterval` inside the web
process — set `VALET_RUN_SWEEP_IN_PROCESS=true` only on a single-instance dev box.

`services/valet-service/scripts/e2e-smoke.mjs` drives the whole flow against a
running service and a real database over HTTP — ticket creation, the rotating
QR being superseded and replayed, both server-side pickup guards, and the audit
trail. It seeds a throwaway community and deletes it again, so it is the thing
to run against a freshly deployed box:

```
VALET_BASE_URL=https://dwaarai.com/valet-api \
VALET_E2E_DATABASE_URL=$DATABASE_URL JWT_SECRET=$JWT_SECRET \
  pnpm --filter valet-service e2e
```

**The CORS preflight must list every verb the routes answer.** It said
`GET, POST, DELETE, OPTIONS` while six routes answered PATCH, so a browser
refused the preflight and every PATCH in the admin portal failed before a
request was sent -- pausing a valet point, saving property details, running a
promotion, editing a staff member. No 500, no access-log line, no server-side
trace: the whole failure lives in the browser, which is why curl and 530
service tests all said those endpoints were fine. Only clicking Save in a real
browser found it. `src/__tests__/cors.test.js` now checks the header against
the route table.

**Renaming a valet point moves its shifts with it.** `valet_shifts` records the
point by NAME, so a rename that stopped at `valet_points` split one door's
history in two -- last month's log said "Main porch", the screen said "Porte
cochere", and the live "on shift now" count against the point dropped to zero
the moment it was renamed. The name is a label on a door that did not change,
so the UPDATE carries the label over, scoped to the community because two
properties each have a "Main porch".

**Plate history was folded into Find a vehicle.** They were one question asked
twice: `/valet/plate-history` needed a whole plate typed from memory and
reported on one car, while `/valet/search` already finds the car from four
digits. A manager had to pick between two lookups before knowing what they
were looking for. The history now expands under a search result, where the
plate is already correct and already spelled the way the ticket spells it. The
old route stays as a redirect -- it is in bookmarks, and a 404 on a page that
worked yesterday reads as the portal being broken.

**Find a vehicle was then folded into the Vehicle log.** The log had its own
search box, which only filtered the up-to-200 rows of the selected period --
so it answered "no cars match" for a car that came 31 days ago, beside a page
that would have found it. Three or more characters in the log's box now swap
the table for `components/VehicleLookup.tsx` (all dates, with "All visits"
history). `GET /admin/tickets/search` matches the plate *and* the ticket
number (hyphen-insensitive), card code, claim code and guest name, because
that is what the box says it searches. `/valet/search` and
`/valet/plate-history` redirect to `/valet/visits`.

Not merged, and deliberately: **Inventory** (`valet_slots`, where a car is
parked) and **Properties** (`valet_points`, where a guest stands). They sound
alike and are not the same object; see the 063-066 section above.

**Qualify every column in a correlated subquery.** The vehicle log's status
filter is one predicate shared by the rows query (aliased `t.`) and the totals
query. Built with an empty qualifier for the totals, `NOT EXISTS (... WHERE
e.ticket_id = id)` bound `id` to **valet_ticket_events' own** `id` column, so
it compared an event to itself, matched nothing, and the filter silently did
not apply -- to the totals only. The rows were right, so the page read
"showing 14 of 16" and the 16 looked like a total rather than a bug. The unit
test could not see it either: it stripped the alias from both queries before
comparing them, which made the broken form byte-identical to the correct one.
`visitStatusSql` now throws on an empty qualifier.

**`deploy-valet.sh` REWRITES the systemd unit on every deploy**, so any value
not supplied on the command line is replaced with nothing. This has now broken
production three separate ways -- the CORS origin added for a laptop, the
webhook secret (every inbound message 401ing behind six green health checks),
and `WHATSAPP_PROVIDER`, which is the worst of them: `isConfigured()` returns
false without it, so every guest message is reported `skipped`, which a ticket
treats as a success. Nothing logs and nothing 500s.

Every one of those values is therefore **inherited from the live unit** before
the file is rewritten, and a deploy refuses to proceed if a provider key is set
with no provider. The live unit is the record of what the box is configured
with; a laptop that has forgotten a value must not be able to overwrite it with
an empty one. `sync-and-deploy.sh` still forwards anything set in the calling
shell, which wins -- that is how a value is changed, once.

`deploy/deploy-valet.sh` is the deployment: idempotent, additive, and it health-checks
the existing api-gateway and landing site afterwards so a valet deploy that broke
something else fails loudly rather than silently.

Two things about valet-app worth knowing before changing it:

- It duplicates `src/theme`, the Expo/Jest plumbing, and part of `src/i18n` from
  guard-app rather than importing them. That matches the repo's existing
  convention — there is no shared package, and every service already duplicates
  its own `db.js` and route scaffolding.
- `src/screens/ValetFlow.test.tsx` asserts the screens are *reachable*, not just
  that they render. They were once written, unit-tested and left wired to
  nothing: every screen test passed while the flow could not be opened at all.
  Keep a reachability assertion whenever a screen gains a new entry point.

**Never call the image picker outside a try/catch.** `src/lib/camera.ts` wraps
it and returns a result rather than throwing, because the screens used to await
`ImagePicker.launchCameraAsync` outside theirs: anything it threw became an
unhandled rejection, so tapping capture did nothing at all — no camera, no
error, nothing for a valet at a stand to report. It also separates a permanent
refusal (`canAskAgain === false`, Android stops prompting after two denials)
from a one-off one, since only the first needs the OS settings screen, and
carries the underlying reason into the on-screen message.

### Shifts, valet points, ideas and promotions (063-066)

Four concepts the admin portal gained from the staff-screen redesign. Each
replaced something that was being written and never read, which is the pattern
worth remembering here.

**A shift is a row, not a column.** `residents.shift_started_at` was overwritten
on every sign-in and read by nothing, so "who is on duty" and "who was on duty
at 7pm yesterday" were both unanswerable — and the verified/confidence/reason
`/shift/start` computes so carefully was returned to the app and dropped.
`valet_shifts` holds one row per shift, opened at start and closed at
`/shift/end`. A unique partial index allows one open shift per person, so a
double tap cannot put somebody on duty twice.

The redesign assumes Face ID gates sign-in ("they need it to sign in to the
valet app"). **It does not** — `/shift/start` never blocks, because stranding a
real attendant in bad light is the worse failure. Building the spec's version
literally put "Can't start shift" against somebody who was on shift at that
moment. The screen says "No Face ID / shifts start unverified" instead, and
on-duty always wins the precedence.

**Valet points are doors, not bays.** A hotel has a main porch and a banquet
entrance; `valet_slots` is where a car is parked, `valet_points` is where a
guest stands. Paused rather than deleted, because shifts reference the name and
last month's log has to keep making sense.

**Ideas are prose, guest feedback is a tally.** Deliberately separate tables:
one is counted chips designed for a rollup, the other is a named person's
sentence designed to be read once and answered. Status defaults to `received`,
which means somebody has it, not that anybody has read it — claiming otherwise
is the fastest way to stop a venue writing again.

**Promotions count one view per valet ticket.** The guest page polls and
reopens from WhatsApp, so raw impressions would turn one guest on a slow
connection into forty. A unique index on (promotion, ticket, kind) enforces it,
and the guest's offer code is the promotion's stem plus their claim code — which
is what makes a redemption traceable to one car on one night.

### The commercial layer (069)

Ad pricing, the ad balance, top-ups, GST, the review queue and the shared car
quota were held back for several rounds on the grounds that a rate card does
not belong in a migration. Built on an explicit instruction to complete the
design, and the way round that objection is the part worth keeping: **no rate
is hardcoded anywhere.** Every figure -- cars per property, overage, price per
view, monthly minimum, GST percent, prepaid vs invoiced -- is a column on
`accounts` with a default, so a group on negotiated terms is representable and
a price change is a settings edit rather than a release.

- **`valet_ad_ledger` is append-only, and the balance is its sum.** A running
  balance column is a number somebody has to keep correct under concurrency,
  and the first time it drifts nobody can say when or why. It is also the only
  shape that answers "why am I being charged this".
- **Free credit and paid balance stay distinguishable for the life of the
  ledger.** Credit is spent first and cannot be refunded; merging them makes
  "how much free credit is left" unanswerable the moment a top-up lands.
- **A top-up credits the NET, never the gross.** GST is tax collected, not ad
  credit — crediting the gross hands every venue 18% of free spend. There is a
  test, and it was mutation-checked.
- **Crediting happens inside the request only because placeholder orders
  cannot fail.** In live mode the route returns the order and credits nothing:
  crediting on intent rather than on settlement would hand a venue a balance
  for a payment they abandoned. Moving the credit to the payment webhook is
  the first thing to do when OQ-01 is decided.
- **There is no "stop the valet desk" over-quota option**, in the schema or the
  dropdown. A billing arrangement must never be able to refuse a guest standing
  at a porch with their keys out. The choices are bill or notify.
- **Cars per property and the overage rate are not editable by a customer.**
  They are contract terms, shown and not offered; a screen that let somebody
  set their own allowance would be a billing hole.
- **Only live properties contribute to the pool.** A group that signs four
  hotels and opens one is not paying for three empty porches.
- A promotion's **"show during"** window may cross midnight, because a late bar
  wants 22:00–02:00. The guest-side predicate is an OR rather than a BETWEEN
  for exactly that case, checked against real Postgres time arithmetic.

### WhatsApp (the default way into a ticket)

The intake QR opens `/valet/w/<claimCode>`, a page offering WhatsApp first and
the browser second. It is deliberately not a raw `wa.me` QR: a guest without
WhatsApp would scan that and land on a download page holding nothing, having
been handed no card either.

Three layers, and the boundaries matter:

- `lib/whatsapp.js` — transport only. Sends, and verifies a signature. Swapping
  MSG91 for Meta's Cloud API should touch this file and no other.
- `lib/whatsapp-guest.js` — every message the guest ever sees, and the single
  decision about how to send it. **Nothing else composes or sends a message.**
- `routes/webhooks.js` — inbound: signature, de-duplication, binding, commands.

**The 24-hour window is the whole reason this is affordable.** A guest who
messages us first opens a window in which free-form replies need no template
approval at all, and every reply from them extends it. Outside it, only an
approved template is delivered — and a free-form send outside the window is
*accepted by the API and silently dropped*, which would mean a multi-day guest
never hearing their car was ready. Hence one template, and hence
`notifyGuest()` being the only way out.

**Not every stage sends.** Five points in a ticket's life can notify a guest;
by default only two do. `WHATSAPP_NOTIFY_STAGES` names exactly the ones that
send, defaulting to `bound,accepted` -- the welcome, and the acknowledgement
that a typed CAR landed. `en_route`, `arrived` and `closed` are muted, because
every send is billed and those three restate what the tracking link shows live.

The gate lives in `notifyGuest()` and nowhere else, so a new call site is muted
by the same rule without knowing the rule exists. A blank value reads as unset,
not as silence: an empty env var is a deploy accident far more often than a
decision, and reading it literally would take every guest notification down
with nothing logged.

`arrived` is the one to reconsider first. A guest waiting in a lobby is not
watching the page, and that message is what sends them outside; muting it trades
a billed message for a car blocking the porch. `WHATSAPP_NOTIFY_STAGES=bound,accepted,arrived`
restores it without a release.

**The rotating pickup QR cannot be sent over WhatsApp.** It rotates every 18
seconds and only the newest validates, so any image is stale before it is read.
Messages carry the link; the web page keeps the QR.

Messages carry the **claim code, never the session token**: the code stops
resolving when the ticket closes, the token would keep working for whoever the
message was forwarded to.

Webhook inbound is recorded in `valet_whatsapp_messages` *before* it is acted
on. Providers retry, and without that row a redelivered "bring my car" sends a
second valet.

With `WHATSAPP_NUMBER` unset the QR still opens the door page, only the browser
button shows, and every send reports `skipped`.

### Shipping the DwaarAI Valet APK
`apps/valet-app/eas.json` mirrors guard-app's profiles. Both build URLs are
pinned explicitly in **both** profiles, because `EXPO_PUBLIC_*` values are baked
in at build time — the same trap that shipped a guard APK pointing at the dead
`dwaarai.in` host, where every install failed login with no server-side trace.

```
npx eas-cli login                                    # interactive; account skprabakaran122
npx eas-cli build -p android --profile preview       # from apps/valet-app
deploy/publish-valet-apk.sh <downloaded.apk>         # upload + add the /install card
```

`publish-valet-apk.sh` uploads the APK *before* touching `install.html`, so the
download card can never appear on the page ahead of the file it links to, and it
refuses anything that is not a real APK or is under 10MB — a truncated download
or an HTML error page would otherwise be published as a working link.

### Payments (Events module)
`services/api-gateway/src/lib/razorpay.js` runs in one of two modes, and which
one is never left to chance:

- **live** — `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` set. Real orders, webhook
  signatures verified.
- **placeholder** — no keys. Orders are minted locally (`order_placeholder_*`)
  so the booking and donation flows work end to end, but no money moves.

Placeholder mode is scaffolding while BRD open question **OQ-01** (Razorpay
Route split payment vs manual payout) is undecided. In production, missing keys
throw at startup unless `PAYMENTS_PLACEHOLDER=true` is set explicitly — the
failure that guards against is a deploy that looks healthy while collecting
nothing, with stalls reading as booked and donations as received.

Routes return `paymentPlaceholder` on every order they open, and both the
Basera stall-booking screen and the donation card change their wording on it:
a stall is "reserved", not "booked", and a donation is "recorded", not thanked
for. Never tell a resident money moved when it did not.

`lib/money.js` fixes the platform fee at 3% of the stall fee, rounded to whole
rupees, and never charges it on a donation. The apps never recompute it — they
render `pricePaise` / `platformFeePaise` / `totalPaise` exactly as the server
sends them, and a test feeds a deliberately inconsistent payload to prove it.

### Before any Expo build
Run a local bundle first — it catches in ~20s what EAS reports as a generic
"Unknown error. See logs of the Bundle JavaScript build phase" ten minutes and
one cloud build later:

```
pnpm --filter valet-app exec expo export --platform android --output-dir /tmp/x
```

Two things this has already caught:

- **Never put a test file inside `app/`.** expo-router treats every file there
  as a route and bundles it, so a `.test.tsx` calling `require('fs')` fails
  Metro resolution. Tests live in `src/__tests__/`, importing `../../app/index`.
- **Fonts are load-bearing, not cosmetic.** Every screen styles text through
  `font()`, which returns a `DMSans_*` fontFamily. On Android, naming a family
  that was never loaded is FATAL — the first DwaarAI Valet APK crashed on launch for
  exactly this. `useAppFonts()` must gate rendering in the entry, and
  `src/__tests__/app-entry.test.tsx` asserts both the gate and that every family
  the theme names is one the loader loads. Expo web silently substitutes a
  system font, so **web testing cannot validate an Android build**.
