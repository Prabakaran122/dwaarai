# Nazar Foundation + Gate Home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand `apps/guard-app` to Nazar (BRD §3 dark palette + DM Sans/Noto typography), flip it from a landscape 3-panel workstation to a portrait phone app with a 4-tab bottom nav (Gate/Visitors/Parcels/Incident), and ship the Gate Home screen (BRD §5.1, NAZ-001…010) end to end.

**Architecture:** Additive-first — new tokens/components/screen are built alongside the existing workstation code (kept compiling via back-compat color aliases), then `app/index.tsx` is repointed at the new tab shell as the final step. No new nav dependency (state-based `TabBar`, matching `apps/resident-app`'s pattern). One small backend change (`guard-login` gains `gateName`/`communityName`).

**Tech stack:** Expo SDK 52 / React Native 0.76, expo-router, TypeScript, zustand, `jest-expo` + `@testing-library/react-native` (new — guard-app has no test harness today), `@expo-google-fonts/*`.

**Spec:** `docs/superpowers/specs/2026-08-03-nazar-foundation-design.md`
**Branch:** `redesign/nazar`

### Conventions for every task
- Frontend tests: `pnpm --filter guard-app test <pattern>`. Backend tests: `pnpm --filter api-gateway test <pattern>`.
- Type gate: `pnpm --filter guard-app exec tsc --noEmit`.
- All colours/spacing/type from tokens — no hardcoded hex in new components.
- Write the failing test first, confirm the failure reason, implement, confirm pass, commit.

---

## Task 1: Jest harness for guard-app

**Files:** `apps/guard-app/package.json`, `apps/guard-app/jest.config.js` (new), `apps/guard-app/src/__tests__/smoke.test.ts` (new)

- [ ] Add devDeps: `jest@^29 jest-expo@~52.0.0 @testing-library/react-native@^12.7.2 react-test-renderer@18.3.1 @types/jest@^29` and a `"test": "jest"` script (mirrors `apps/resident-app`'s Task 1 in `2026-06-11-dwaar-foundation.md`).
- [ ] `jest.config.js` — same `preset: 'jest-expo'` + `transformIgnorePatterns` as resident-app's.
- [ ] `smoke.test.ts` — `expect(1+1).toBe(2)`.
- [ ] Run `pnpm --filter guard-app test` → PASS.
- [ ] Commit: `test(guard): add jest-expo harness`

## Task 2: Color tokens (BRD §3) + back-compat aliases

**Files:** `src/theme/colors.ts` (rewrite), `src/theme/colors.test.ts` (new)

- [ ] Failing test pinning every hex in the spec's §2 table (`bgPrimary #0D2535`, `surface #1B3A4B`, `card #1E3A4F`, `elevated #243F55`, `actionPrimary #F59E0B`, `teal #00BFA6`, `amber #F59E0B`, `purple #A78BFA`, `green #34D399`, `danger #F87171`, `border #2A4A5E`, `textPrimary #F0F4F8`, `textSecondary #8BAABB`, `textTertiary #5A7A8A`), plus a second test that every legacy key referenced by existing components (`bgAlt`, `surfaceBorder`, `surfaceHover`, `successBg`, `dangerBg`, `warningBg`, `warningBorder`, `infoBg`, `textMuted`, `white`, `transparent`, and the `gradient*` arrays) is still defined.
- [ ] Run → FAIL.
- [ ] Implement: new `palette` object with the BRD hexes, then `export const colors = { ...palette, /* back-compat aliases mapped onto the new palette, same shape as resident-app's Task 3 */ }`. Map `bgAlt`→`bgPrimary`, `surfaceBorder`→`border` (as rgba), `dangerBg`/`successBg`/`warningBg`/`infoBg`→ tint versions of `danger`/`teal`/`amber`/`purple` respectively, `textMuted`→`textTertiary`, gradients→`[actionPrimary, actionPrimary]`-style flat pairs (this app has no gradients in the BRD's flat dark cards; keep the *shape* — array of 2 — so `LinearGradient` call sites don't break, but both stops equal so it renders flat).
- [ ] Run → PASS.
- [ ] `pnpm --filter guard-app exec tsc --noEmit` → confirm the untouched workstation files (`ActionZone.tsx` etc.) still compile against the new `colors` export.
- [ ] Commit: `feat(guard): Nazar dark colour tokens (BRD §3) + back-compat aliases`

## Task 3: Typography tokens + `font()`

**Files:** `src/theme/typography.ts` (new), `src/theme/typography.test.ts` (new)

- [ ] Failing test: `font(400).fontFamily === 'DMSans_400Regular'`, `font(700).fontFamily === 'DMSans_700Bold'`, and a `type` scale object exposing `h1/h2/h3/body/bodySecondary/caption/micro` with sane `fontSize`s (reuse guard-app's current ad hoc sizes — e.g. `h1: 20`, `body: 14`, `caption: 11` — as the frozen baseline).
- [ ] Implement, mirroring `apps/resident-app/src/theme/typography.ts` shape exactly (`FAMILY` map, `font()`, `type` object using `colors.textPrimary`/`textSecondary`).
- [ ] Run → PASS. Commit: `feat(guard): DM Sans typography tokens + font() helper`

## Task 4: Fonts loader + app.json + root gate

**Files:** `src/lib/fonts.ts` (new), `app.json`, `app/index.tsx`, `package.json`

- [ ] `pnpm --filter guard-app exec npx expo install expo-font` and `pnpm --filter guard-app add @expo-google-fonts/dm-sans @expo-google-fonts/noto-sans-devanagari @expo-google-fonts/noto-sans-kannada`.
- [ ] `src/lib/fonts.ts` — `useAppFonts()` hook loading `DMSans_400Regular/500Medium/700Bold`, `NotoSansDevanagari_400Regular`, `NotoSansKannada_400Regular` (identical shape to resident-app's `src/lib/fonts.ts`).
- [ ] `app.json`: `"orientation": "portrait"`, `"name": "Nazar"` (keep `"slug"` and `android.package` unchanged — package id must not change, see spec/plan context).
- [ ] `app/index.tsx`: gate the authenticated app render on `useAppFonts()` the same way resident-app's `Page()` does — show a spinner on `colors.bgPrimary` with `colors.teal` tint until fonts load.
- [ ] `pnpm --filter guard-app exec tsc --noEmit` → no errors.
- [ ] Commit: `feat(guard): load DM Sans/Noto fonts, portrait orientation, Nazar app name`

## Task 5: i18n additions

**Files:** `src/i18n/translations.ts`, `src/i18n/translations.test.ts` (new)

- [ ] Failing test: a fixed list of new keys (`navGate`, `navVisitors`, `navParcels`, `navIncident`, `quickNewVisitor`, `quickVehicleEntry`, `quickDelivery`, `quickIncident`, `vehicleApproaching`, `comingInThisRedesign`) each have non-empty `en`/`hi`/`kn` values.
- [ ] Add the keys to `translations.ts` (proper Hindi/Kannada strings, not transliteration placeholders — follow the existing file's quality bar).
- [ ] Run → PASS. Commit: `feat(guard): i18n keys for nav + home screen (en/hi/kn)`

## Task 6: `TabBar` component

**Files:** `src/components/TabBar.tsx` (new), `src/components/TabBar.test.tsx` (new)

- [ ] Failing test: renders 4 labels (Gate/Visitors/Parcels/Incident via `useT()`), active tab gets a distinct style, tapping an inactive tab calls `onSelect` with its key.
- [ ] Implement: `TabKey = 'gate' | 'visitors' | 'parcels' | 'incident'`, icons via `MaterialCommunityIcons` (`gate`, `account-group`, `package-variant`, `alert-circle`), active = `colors.actionPrimary` icon/label + small dot indicator (mirrors resident-app `TabBar`'s amber-dot pattern), bar background `colors.surface`, top hairline border `colors.border`, respects `useSafeAreaInsets().bottom`.
- [ ] Commit: `feat(guard): TabBar (Gate/Visitors/Parcels/Incident)`

## Task 7: `TabPlaceholder` component

**Files:** `src/components/TabPlaceholder.tsx` (new), test optional (trivial render)

- [ ] Implement: centered icon + name + "Coming in this redesign" (`t('comingInThisRedesign')`) on `colors.bgPrimary`, matching resident-app's `TabPlaceholder` shape.
- [ ] Commit: `feat(guard): branded TabPlaceholder for unbuilt tabs`

## Task 8: `AlertBanner` component (NAZ-004)

**Files:** `src/components/AlertBanner.tsx` (new), `src/components/AlertBanner.test.tsx` (new)

- [ ] Failing test: renders `null`/nothing when passed no entry; when passed a `QueueEntry`-shaped prop with `plate`, `unitNumber`, `residentName`, renders all three.
- [ ] Implement: takes the current `queueStore` pending entry (same `selectPendingEntries` selector `ActionZone` already uses) as a prop, amber-accented card (`colors.actionPrimary` left border), plate via existing `PlateText`.
- [ ] Commit: `feat(guard): AlertBanner for approaching-vehicle alert (NAZ-004)`

## Task 9: `QuickActionGrid` component (NAZ-006)

**Files:** `src/components/QuickActionGrid.tsx` (new), `src/components/QuickActionGrid.test.tsx` (new)

- [ ] Failing test: renders exactly 4 actions passed as props and fires the right `onPress` per tile (same test shape as resident-app's `QuickActionGrid.test.tsx`).
- [ ] Implement: 2×2 `flexWrap` grid, `colors.card` tiles, icon + label, generic `{key,label,icon,onPress}[]` prop (not hardcoded to specific actions) so `GateHomeScreen` wires the 4 BRD actions.
- [ ] Commit: `feat(guard): QuickActionGrid (NAZ-006)`

## Task 10: `GateHomeScreen` (NAZ-001…010)

**Files:** `src/screens/GateHomeScreen.tsx` (new), `src/screens/GateHomeScreen.test.tsx` (new)

- [ ] Failing tests: (a) renders guard name + gate name + society name from `authStore.user`; (b) renders `AlertBanner` content when `queueStore` has a `guard_review`/`deny` entry, renders nothing from it otherwise; (c) each quick action calls the `onNavigate` prop with the expected tab key.
- [ ] Implement: header row (gate name / society name text stack, `LanguageSwitcher`, `SosButton`), `AlertBanner`, existing `LiveFeed` (restyled only — its data logic is untouched), `QuickActionGrid` wired to `onNavigate('visitors' | 'gate' | 'parcels' | 'incident')` (Vehicle-entry quick action stays on the Gate tab for now since its dedicated intake flow is a later sub-project), existing `ShiftStats`.
- [ ] `pnpm --filter guard-app test` + `tsc --noEmit` → PASS / no errors.
- [ ] Commit: `feat(guard): GateHomeScreen (NAZ-001..010)`

## Task 11: Backend — `guard-login` returns `gateName`/`communityName`

**Files:** `services/api-gateway/src/routes/auth.js`, `services/api-gateway/src/__tests__/auth.test.js`

- [ ] Failing test in the guard-login describe block: mock the DB row to include `gate_name`/`community_name`, assert the response `data.user.gateName`/`communityName` match.
- [ ] Add `g.name AS gate_name, c.name AS community_name` to the existing SELECT; add `gateName: guard.gate_name || null, communityName: guard.community_name || null` to the response `user` object.
- [ ] Run `pnpm --filter api-gateway test auth` → PASS.
- [ ] Commit: `feat(api): guard-login returns gate + society name for Nazar header (NAZ-002)`

## Task 12: Wire the new shell + cleanup

**Files:** `app/index.tsx`, `App.tsx` (leave as-is — already a thin re-export)

- [ ] Add a `NazarShell` (inline in `app/index.tsx` or a small `src/screens/NazarShell.tsx` — decide based on size) holding `const [tab, setTab] = useState<TabKey>('gate')`, rendering `GateHomeScreen` for `'gate'` and `TabPlaceholder` for the other three, plus the `TabBar` fixed at the bottom.
- [ ] Keep the existing `AuthenticatedApp` socket-event wiring (`gate:event`, `fastag:paired`, `fastag:mismatch` → `queueStore.addEntry`) exactly as-is; only its rendered child changes from `WorkstationScreen` to `NazarShell`.
- [ ] `pnpm --filter guard-app exec tsc --noEmit` → no errors (old workstation files still compile, just unrouted).
- [ ] Commit: `feat(guard): route Nazar tab shell (Gate Home + placeholders) from app/index.tsx`

## Task 13: Final verification

- [ ] `pnpm --filter guard-app test` — all suites PASS.
- [ ] `pnpm --filter guard-app exec tsc --noEmit` — no errors.
- [ ] `pnpm --filter api-gateway test auth` — PASS.
- [ ] Manual (`pnpm --filter guard-app start` → web): portrait layout; Nazar dark palette throughout; header shows real gate/society name after login; language switcher still works; SOS button present; bottom nav shows 4 tabs, Gate active by default; Visitors/Parcels/Incident show the branded placeholder; quick actions switch tabs; live feed + shift stats still populate from the existing socket wiring.
- [ ] Commit (if any cleanup): `chore(guard): Nazar foundation verification pass`

---

## Roadmap (separate future plan docs, not this sub-project)

2. Triple-layer vehicle verification screen (§5.2) + client-side entitlement fetch/cache (§5.6) — needs a new backend entitlement endpoint (doesn't exist anywhere in the codebase today).
3. New vehicle entry intake flow (§5.3).
4. Walk-in visitor flow + ID OCR + one-time SMS QR (§5.4) — OCR/SMS vendors still open BRD items (§10).
5. Delivery overstay flag + source dropdown (§5.5).
6. Entitlement admin UI in `apps/admin-portal` (§5.6, ops-only).
7. Incident voice-to-text (§5.7) + SOS 5-second cancel countdown (§5.8) — voice vendor still an open BRD item.
8. Shift handover polish (§5.9).
