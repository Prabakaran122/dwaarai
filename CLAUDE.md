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
pnpm --filter valet-app start         # Expo (Sarthi valet app, iOS + Android)
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
- **valet-service** (3060, `PORT_VALET_SERVICE`) — the Sarthi valet flow: guard ticket handling, the public guest-page API, and operator plate-history reporting. Its tables ship in `043_valet.sql` like every other service's (api-gateway owns all migrations). Media goes through `src/lib/storage.js`, which selects S3 or a local directory from `VALET_STORAGE`. Routes mount on an `asyncRouter()` (`src/lib/async-router.js`) rather than a bare `express.Router()`: Express 4 does not forward an async handler's rejection to the error middleware, so without it a database blip hangs the request with no response instead of returning 500.
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
- **valet-app** — Expo/React Native, the Sarthi valet product. A **separate app from guard-app on purpose**: a hotel valet is not a society gate guard, and folding valet in would have meant them signing into "Nazar — Guard Station" and seeing a tab bar of Gate / Visitors / Parcels / Incidents they will never use. It has no tab bar at all — the whole app is the three-screen valet flow (queue → new ticket → handover) behind its own Sarthi sign-in. Auth is *not* separate: it posts to the same `/auth/guard-login` and `residents.type='guard'` records, because valet-service verifies those tokens and a property's staff exist once.
- **valet-guest** — Next.js 14, `basePath: /valet`, the one public surface: a guest opens `/valet/v/<session token>` by scanning a physical valet card. No login, no account, and deliberately nothing in localStorage — the token in the URL is the only credential, so reopening the link reconstructs the state exactly.
- **resident-app** — Expo/React Native, iOS + Android. Same store-per-domain + screen-per-feature pattern as guard-app, but with much heavier Jest test coverage (most screens/components have a co-located `.test.tsx`).

### Infra (`infra/cdk`)
Six CDK stacks wired together in `bin/app.ts`: `NetworkStack` (VPC/cluster) → `DataStack` (RDS + Redis + S3, depends on VPC) → `AuthStack` (Cognito) → `IotStack` (AWS IoT Core, replaces Mosquitto in prod) → `ServicesStack` (ECS services, depends on all of the above) → `FrontendStack`. Region is hardcoded to `ap-south-1`.

### Database migrations
Sequential, numbered SQL files in `services/api-gateway/migrations/` (`001_core.sql` ... `046_valet_claim_codes.sql`), applied in order by `src/db/migrate.js` and tracked so re-application is a no-op (CI enforces this in the `migrations` job). This is the only migration path in the repo — other Node services read/write the same Postgres database but don't own migrations themselves.

### Valet (Sarthi)
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
and it frees itself when the ticket closes — reusable per venue. The screen QR
is not replaced: a venue with no card stock behaves exactly as before.

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
- The card carries only the short code. `GET /guest/cards/:code` exchanges it
  for a session token and returns nothing else, and a free card returns a
  byte-identical 404 to an unknown one, so probing cannot enumerate stock.
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
show. It must never decide by waiting for the image to fail: the photo endpoint
needs a guard token, `<Image source={{uri}}>` sends no Authorization header, and
that combination rendered an empty frame above a "Matches" button for *every*
ticket — training guards to tap through a check that never ran. The image
source now carries the header explicitly.

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

### Shipping the Sarthi APK
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
  that was never loaded is FATAL — the first Sarthi APK crashed on launch for
  exactly this. `useAppFonts()` must gate rendering in the entry, and
  `src/__tests__/app-entry.test.tsx` asserts both the gate and that every family
  the theme names is one the loader loads. Expo web silently substitutes a
  system font, so **web testing cannot validate an Android build**.
