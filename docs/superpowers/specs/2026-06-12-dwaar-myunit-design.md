# Dwaar AI Resident App — My Unit Tab

**Date:** 2026-06-12
**Branch:** `redesign/dwaar-light`
**Status:** Approved (autonomous — built under the "complete all resident features" goal)
**Sub-project:** 2 of 6 (My Unit)

---

## 1. Background & sources

Foundation (0) and Home (1) are done. This rebuilds the **My Unit** tab — the resident's
identity card in the society — per `docs/design-sources/share-myunit.txt` and Design Brief
v1.0 (light Dwaar). The brief's non-negotiable sections: Unit number, Members, Pets,
Vehicles, Gate at a Glance, Visitor, Parcel, Helpers, My Dues + History, Unit documents,
plus Facility booking ("Book a court").

Design honesty calls from the brief (kept): **no fabricated presence** ("In complex/Out")
— Members show app-access + face-enrolled status only; Helpers show last-seen, not live
count; Vehicles show verification method (FASTag vs ANPR) per gate event.

## 2. Backend inventory (from recon)

EXISTS (resident-accessible): Members (`/members`, `residents` table), Vehicles
(`/vehicles`, `vehicles` table w/ `fastag_tid_hash`), Dues + history (`/dues`,
`/dues/history`), Helpers (`/recurring-passes`), Parcels list+collect (`/deliveries`).
Face status lives in `face_enrollments` (not in the members response yet).

NET-NEW: Pets (table+CRUD), Documents vault (table+upload), Facility booking
(facilities/slots/bookings service), Parcel photo (`deliveries` image column + guard
upload UI), and `units` columns `wing` + `ownership_type` + a `GET /resident/unit` endpoint.

File-upload infra: disk-based multer pattern exists in `expected-visits.js`
(`/uploads/...` static serve, date-based subdirs). Reuse it for documents & parcel photos.

## 3. Decomposition into slices

Each slice is its own plan → TDD build → review cycle. Order:

- **2a — Core screen:** `GET /resident/unit` aggregate (unit hero + members w/ face status +
  vehicles w/ FASTag flag + dues summary); `units` migration (`wing`, `ownership_type`);
  the My Unit screen scaffold with Unit hero, Members, Vehicles, and a Dues row, each its
  own component, plus drill-in screens for Members and Vehicles management (reuse existing
  CRUD APIs). Helpers + Parcels link out to existing flows.
- **2b — Pets:** `pets` table + resident CRUD (`/pets`) + a Pets section/screen.
- **2c — Parcels with photo:** add `image_path` to `deliveries`; guard-app delivery logging
  gains optional photo capture (multipart); resident Parcels list shows the photo.
- **2d — Documents vault:** `unit_documents` table + multipart upload/list/delete +
  a 2×2 Documents grid + viewer.
- **2e — Facility booking:** `facilities`, `facility_slots` (derived), `facility_bookings`
  tables + booking service (list facilities, day availability, book, cancel with cutoff) +
  a Book-a-court screen. Policy defaults: 7-day window, 1 slot/sport/day/unit, cancel ≥1h
  before.

## 4. Slice 2a detail (this plan first)

### Backend
- **Migration** `0XX_unit_profile.sql`: `ALTER TABLE units ADD COLUMN wing VARCHAR(40)`,
  `ADD COLUMN ownership_type VARCHAR(10)` (values `owner`/`tenant`, nullable).
- **`GET /resident/unit`** (resident JWT) → one call:
  ```
  {
    unit: { unitNumber, floor, wing, ownershipType, communityName, verified },
    members: [{ id, name, relationship, isPrimary, faceEnrolled, appAccess }],
    vehicles: [{ id, plate, makeModel, type, fastagLinked }],
    dues: { outstanding, pendingCount }
  }
  ```
  - members from `residents` LEFT JOIN `face_enrollments` (status='active' → faceEnrolled);
    `appAccess` = resident `is_active` (per recon, registration ⇒ JWT access).
  - vehicles: `fastagLinked` = `fastag_tid_hash IS NOT NULL`; `makeModel` = `make + ' ' + model`.
  - `verified`: true (the unit is occupied by a registered, active primary). Static derive —
    no fake verification pipeline.

### Resident app
- `unitStore` (zustand): `profile`, `loading`, `error`, `fetch()`.
- `client.ts`: `getResidentUnit()`.
- Components (token-driven, tested): `UnitHero`, `MemberRow` (Avatar + name + relationship +
  face/app status chips), `VehicleRow` (PlateText + makeModel + FASTag StatusBadge).
- **MyUnitScreen**: AppBar "My Unit"; UnitHero; Members `SectionHeader` (+ "Manage" → opens
  existing members management as overlay) and rows; Vehicles `SectionHeader` (+ "Manage" →
  existing vehicles screen) and rows; a `DuesSnapshotCard` (reused from Home) opening the
  dues flow; placeholder rows linking to Pets/Documents/Facilities (filled by later slices).
- Wire into `app/index.tsx`: `myunit` tab → `<MyUnitScreen onNavigate={setTab} />`.

### Testing
- Backend (vitest): `/resident/unit` shape + scoping + auth; faceEnrolled/fastagLinked
  derivations; migration applies.
- Frontend (jest): `unitStore`; `UnitHero` renders unit fields; `MemberRow` face/app chips;
  `VehicleRow` FASTag badge + plate.

## 5. Out of scope (per slice boundaries / brief)
No member presence status (honesty). Pets/Documents/Facilities backends are slices 2b/2d/2e
(2a shows their section as a "coming up" entry row that the later slice replaces). Parcel
photo is 2c. No i18n content.

## 6. Cross-cutting conventions
Light Dwaar tokens only; reuse Foundation `ui/` + Home components where they fit;
each new backend route scoped to `req.user` community_id/unit_id; vitest (backend) /
jest-expo (frontend) TDD; the 2 known pre-existing resident-app tsc errors are tolerated
(gate on "no new errors").
