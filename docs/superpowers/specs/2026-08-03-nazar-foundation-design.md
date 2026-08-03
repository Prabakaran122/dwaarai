# Nazar Foundation + Gate Home — Design Spec

**Source:** `Dwaar_AI_Nazar_Guard_App_BRD_v1.docx` (Nazar Guard App BRD v1.0, July 2026, Entriva Technologies / Dwaar AI).
**Scope:** BRD §3 (brand/design system) + §5.1 (Gate home screen, NAZ-001…010) + the portrait/bottom-nav shell needed to host it. Later BRD sections (triple-layer verification, intake flows, deliveries, entitlements, incidents, SOS, handover) are out of scope for this sub-project — see the roadmap at the end of the paired plan doc.

## 1. Why

The guard app currently ships as `apps/guard-app` under the CommunityGate brand: a landscape-tablet, single-screen "workstation" UI (three panels — ActionZone / LiveFeed / ToolsPanel — all visible at once, no navigation). The Nazar BRD specifies a different product entirely for this surface: a portrait Android **phone** app with a home screen, a persistent bottom nav (Gate/Visitors/Parcels/Incident), and dedicated screens per flow. The BRD also mandates an exact, dark-mode-only color and type system ("Night Mode is the ONLY mode for Nazar") distinct from both the current guard-app palette and the light palette already built for the resident app under the same Dwaar rebrand (see `docs/superpowers/specs/2026-06-11-dwaar-foundation-design.md`).

This sub-project lays the foundation (tokens, fonts, nav shell) and ships the first real screen (Gate Home) end to end, so guards have a working, on-brand entry point before the deeper feature work (verification, intake flows, etc.) lands in later sub-projects.

## 2. Color tokens (BRD §3, verbatim)

| Token | Hex | Usage |
|---|---|---|
| `bgPrimary` | `#0D2535` | Deep Ocean Dark — main screen background |
| `surface` (header/nav) | `#1B3A4B` | Deep Ocean — navigation headers, bottom nav |
| `card` | `#1E3A4F` | Card background |
| `elevated` | `#243F55` | Input fields, elevated cards |
| `actionPrimary` | `#F59E0B` | Amber Gate — CTA buttons, primary actions |
| `teal` (success/verified) | `#00BFA6` | Gate Teal — verified states, AI confirmations, FASTag layer |
| `amber` (ANPR/warning) | `#F59E0B` | Layer 2 (ANPR), caution states — same value as `actionPrimary` by design |
| `purple` (face/biometric) | `#A78BFA` | Facial recognition layer |
| `green` (AI/intelligent) | `#34D399` | AI anomaly / smart features |
| `danger` | `#F87171` | Denied entry, emergency, alerts |
| `border` | `#2A4A5E` | All card/field borders |
| `textPrimary` | `#F0F4F8` | On dark backgrounds |
| `textSecondary` | `#8BAABB` | Subtitles, labels |
| `textTertiary` | `#5A7A8A` | Section labels, placeholders |

No light mode. No new hex values beyond this table (component-specific tints derive from these via opacity, matching the pattern already used in the current `colors.ts` for e.g. `dangerBg`).

## 3. Typography

- English: **DM Sans** (already the resident app's choice — reuse the same `@expo-google-fonts/dm-sans` package and `font(weight)` helper shape: `font(400|500|700) -> { fontFamily }`).
- Hindi (Devanagari) / Kannada: **Noto Sans** — `@expo-google-fonts/noto-sans-devanagari`, `@expo-google-fonts/noto-sans-kannada`, matching the resident app's font packages.
- Type scale is not specified numerically in the BRD; reuse the resident app's scale shape (`display/h1/h2/h3/body/bodySecondary/caption/micro`) with guard-app's existing sizes as the starting point, since the BRD's only hard constraint is the typeface family, not sizes.

## 4. Navigation

Bottom nav, always visible (NAZ-009): **Gate, Visitors, Parcels, Incident** — four tabs, no more. No `@react-navigation/bottom-tabs` dependency; follow the same custom state-based `TabBar` pattern already established in `apps/resident-app/app/index.tsx` (a `TabKey` union + local `useState` + a `View`/`Pressable` tab bar), since that's this repo's convention for both Dwaar apps and avoids adding an unused dependency (guard-app already carries `@react-navigation/native` + `native-stack` unused).

Orientation flips from `landscape` to `portrait` in `app.json` (a hard requirement of the phone-first BRD layout — the current landscape 3-panel design does not fit a bottom-nav phone shell).

## 5. Gate Home screen (NAZ-001…010)

| Req | Element | Source |
|---|---|---|
| NAZ-001 | Status bar (time/wifi/battery) | OS-provided, no app work needed |
| NAZ-002 | Header: app name, gate name, society name from server config | New: `guard-login` must return `gateName`/`communityName` (currently missing — see plan Task 11) |
| NAZ-003 | Language switcher EN/हिं/ಕನ್ನ, persists per session | Already exists (`LanguageSwitcher.tsx` + `langStore.ts`) — reuse, restyle only |
| NAZ-004 | Smart alert banner for an approaching vehicle (plate, unit, resident) | New `AlertBanner` component, sourced from `queueStore`'s newest pending entry |
| NAZ-005 | Live gate activity feed | Existing `LiveFeed`/`FeedItem` — restyle via new tokens, logic unchanged |
| NAZ-006 | Quick actions grid 2×2: New visitor / Vehicle entry / Delivery / Incident | New `QuickActionGrid`; for this sub-project each action switches the bottom-nav tab (Visitors/Gate-intake-TBD/Parcels/Incident) since the destination flows aren't built yet |
| NAZ-007 | Shift summary card (vehicles/visitors/incidents this shift) | Existing `ShiftStats` — restyle only |
| NAZ-008 | SOS button in header | Existing `SosButton` — restyle only, cancel-countdown behavior (NAZ-064) deferred to the SOS sub-project |
| NAZ-009 | Bottom nav: Gate/Visitors/Parcels/Incident | New `TabBar` (§4) |
| NAZ-010 | Live data via WebSocket/polling | Already wired (`api/socket.ts` + `queueStore`/`sosStore`/`deliveryStore`) — reused as-is |

Visitors/Parcels/Incident tabs render a branded `TabPlaceholder` ("Coming in this redesign") for this sub-project — their real content is later sub-projects' scope, mirroring exactly how the resident app shipped `dwaar-foundation` (placeholders on 4 of 5 tabs) before `dwaar-home` filled in Home.

## 6. Backend change

`POST /auth/guard-login` (`services/api-gateway/src/routes/auth.js`) currently selects `g.id AS gate_id` but not the gate's name, and doesn't join anything for the community's name beyond `c.config`. Both `gates.name` and `communities.name` columns already exist (migrations 001, 002) — this is a same-query column addition, not a new endpoint or migration:

```sql
-- add to the existing SELECT in guard-login:
g.name AS gate_name,
c.name AS community_name
```

Response `user` object gains `gateName` and `communityName` alongside the existing `name`/`role`/`gateId`/`language`.

## 7. Out of scope (this sub-project)

Triple-layer verification, new-vehicle intake, walk-in visitor + OCR, delivery overstay, entitlement system (client or admin), incident voice transcription, SOS cancel countdown, shift-handover UI changes. All of `ActionZone`, `VehicleCard`, `ExpectedVisitors`, `ApprovalWaiting`, `DeliveryPanel`, `IncidentForm`, `StaffPanel`, `ToolsPanel`, `SosButton`, `SosBanner`, `WorkstationScreen` keep compiling (via color-token back-compat aliases) but become unrouted once `app/index.tsx` points at the new tab shell — they are replaced feature-by-feature in later sub-projects, not deleted here.
