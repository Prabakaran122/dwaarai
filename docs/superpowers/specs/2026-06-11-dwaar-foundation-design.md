# Dwaar AI Resident App — Design-System Foundation & Nav Shell

**Date:** 2026-06-11
**Branch:** `redesign/dwaar-light`
**Status:** Approved design — ready for implementation plan
**Sub-project:** 0 of 6 (Foundation) in the Dwaar AI resident-app redesign

---

## 1. Background

The resident app (`apps/resident-app`, Expo / React Native, expo-router) is being
rebranded and restructured from its current **dark** theme (navy→purple gradients,
6 tabs) to the **Dwaar AI** brand defined in `Design_Brief_v1.0_Dwaar_AI.docx`, with
screen-level designs captured across four Claude design conversations (Home, My Unit,
Community, Events).

### Sources of truth
- **Design Brief v1.0** — brand colours, typography, spacing, component rules (the
  brief is the canonical reference; where the approved mockups conflict with it, the
  brief wins — see decision D1).
- **Product requirement design Feedback.docx** — Home-screen feedback (de-emphasise
  Visitor Pass, "Gate at a Glance" with Visitor/Parcel/Helpers, "My Dues" + History).
- **Three Claude `/share/` chats** (captured to `docs/design-sources/share-home.txt`,
  `share-myunit.txt`, `share-community.txt`) — detailed written design rationale per screen.
- **Events chat** — private `/chat/` link, not retrievable; Events will be designed
  from the Design Brief screen inventory (§8) in its own sub-project.

### Decisions taken during brainstorming
- **D1 — Theme: LIGHT mode**, per the Brief (Mist `#E8F4F8` background, Deep Ocean
  surfaces/headers). Resident app = light; Guard app stays dark. This overrides the
  dark navy backgrounds shown in the approved mockups.
- **D2 — Scope: Foundation + all 5 tabs**, rebuilt over sequenced sub-projects.
- **D3 — Missing features: full-stack** — every designed feature (parcels, helpers,
  pets, facility booking, polls/issues, events, document vault) gets real backend +
  UI in its tab's sub-project. (No backend work in this Foundation sub-project.)
- **D4 — Home "Gate at a Glance" / activity shows the resident's own unit only.**

### Decomposition (each its own spec → plan → build cycle)
0. **Foundation + Nav Shell** ← *this spec*
1. Home
2. My Unit (+ pets, parcels, helpers, facility-booking, documents services)
3. Community (+ posts/polls/issues service)
4. Events (+ events service)
5. Profile

All work lands on the `redesign/dwaar-light` branch.

---

## 2. Goal of this sub-project

Deliver the **client-side design system and navigation shell** that every subsequent
tab is built on. No backend changes, no per-tab feature screens. When complete, the
app launches into the new light Dwaar shell with branded placeholder tabs, custom
fonts loaded, and a full set of reusable base components verified in a gallery.

**Explicitly NOT in scope:** per-tab feature screens, any backend/API work, app-icon
& splash artwork (design-asset deliverable, swapped in later), Hindi/Kannada string
translation (fonts are wired now; i18n content is later).

---

## 3. Theme tokens — `src/theme/`

### 3.1 `colors.ts` (rewrite)
Light Dwaar palette per Brief §3. Exact values:

```
Brand
  brandPrimary  #1B3A4B   (Deep Ocean — app bars, headers, primary text)
  oceanDark     #0D2535   (reserved; not used in light resident screens)
  teal          #00BFA6   (Gate Teal — verified/active/selected, success highlights)
  mist          #E8F4F8   (app background tint, input/card surfaces)

Action
  actionPrimary #F59E0B   (Amber Gate — ALL primary CTAs, FABs)
  actionHover   #D97706   (pressed/hover of primary)

Status (signal + tint-bg + on-tint text)
  success #2ECC71  tintSuccess #EAFAF1  textSuccess #1A7A44
  error   #E84C3D  tintError   #FDEDEC  textError   #922B21
  warning #F6C90E  tintWarning #FEFDE7  textWarning #7D6608
  info    #3498DB  tintInfo    #EBF5FB  textInfo    #1B5276

Typography colours
  textPrimary   #1B3A4B
  textSecondary #557A8F
  textTertiary  #8DAFC0
  textInverse   #FFFFFF

Surfaces
  surface       #FFFFFF
  surfaceBorder rgba(27,58,75,0.15)
  inputBorder   rgba(27,58,75,0.20)
  notifBadge    #E84C3D
```

**Back-compat aliases** (so existing dark-era screens still compile until rebuilt):
`bgPrimary→mist`, `bgAlt→mist`, `surfaceHover→mist`, `textMuted→textTertiary`,
`danger→error`, `dangerBg→tintError`, `successBg→tintSuccess`, `warningBg→tintWarning`,
`infoBg→tintInfo`, `white→#FFFFFF`, `transparent`, and gradient arrays collapsed to
flat equivalents (`gradientBg→[mist,mist]`, `gradientPrimary→[brandPrimary,brandPrimary]`,
`gradientAccent→[actionPrimary,actionPrimary]`). Aliases are temporary and removed as
each screen is rebuilt.

### 3.2 `typography.ts` (new)
DM Sans scale per Brief §5, exposed as reusable `TextStyle` objects and a `font(weight)`
helper that maps to the loaded font family names:

| Token        | Size | Weight | Colour token   |
|--------------|------|--------|----------------|
| `display`    | 28   | 500    | textPrimary    |
| `h1`         | 22   | 500    | textPrimary    |
| `h2`         | 18   | 500    | textPrimary    |
| `h3`         | 15   | 500    | textPrimary    |
| `body`       | 14   | 400    | textPrimary    |
| `bodySecondary` | 13 | 400    | textSecondary  |
| `caption`    | 11   | 500    | textSecondary  |
| `micro`      | 11   | 400    | textTertiary   |
| `button`     | 14   | 500    | inverse/amber  |

`font(weight)` returns `'DMSans_400Regular' | 'DMSans_500Medium' | 'DMSans_700Bold'`.

### 3.3 `spacing.ts` (update)
Brief §6: `xs:4, sm:8, md:12, lg:16, xl:24, '2xl':32` plus existing extra keys retained
as aliases. Radius: `sm:8, md:12, lg:16, full:9999` (legacy `pill`, `xl` kept as
aliases). Base grid = 8dp; screen horizontal padding = 24 (`xl`); card padding = 16 (`lg`).

---

## 4. Fonts — `src/lib/fonts.ts` + root loader

- Add deps: `expo-font`, `@expo-google-fonts/dm-sans`,
  `@expo-google-fonts/noto-sans-devanagari`, `@expo-google-fonts/noto-sans-kannada`.
- Load `DMSans_400Regular / 500Medium / 700Bold` (+ Noto Devanagari/Kannada regular)
  via `useFonts` at the expo-router root (`app/index.tsx`). Keep the splash visible
  until fonts resolve; render nothing (or the existing loader) meanwhile.
- DM Sans is the default Latin face; Noto faces are loaded for future Hindi/Kannada
  content. No automatic per-glyph fallback is wired in this sub-project.

---

## 5. Base components — `src/components/ui/`

Flat, light rebuilds per Brief §7. Each is self-contained, themed only via tokens
(no hardcoded hex), and rendered in the dev gallery (§7).

1. **`Button`** — variants `primary` (Amber fill, white label), `ghost` (transparent,
   1px Teal border, Teal label), `destructive` (Error fill, white label). Min height
   48, min width 120, radius `md`. Press → scale 0.97 + `actionHover` fill (primary).
   Disabled → 40% opacity, interaction off. `loading` spinner state.
2. **`Card`** — `default` (surface/Mist bg, 0.5px `surfaceBorder`, radius `md`, padding
   `lg`), `hero` (Deep Ocean bg, white text), optional `accent` left-border colour for
   status cards. Optional `onPress`.
3. **`StatusBadge`** (a.k.a. Chip) — presets `granted`, `denied`, `pending`, `verified`,
   `info` mapping to the tint-bg + on-tint-text pairs from §3.1; `verified` = solid Teal
   bg, white text. Optional left-border accent (granted). Sizes `sm` / `md`.
4. **`Input`** — surface/Mist bg, 0.5px `inputBorder`, focus → 1.5px Teal border,
   placeholder `textTertiary`, value `textPrimary`; `error` → 1.5px Error border +
   message in `textError` below.
5. **`SectionHeader`** — H2 title + optional right-aligned action link (Teal label).
6. **`Avatar`** — circular, image or initials, sizes `sm/md/lg`, Mist bg + Deep Ocean
   initials fallback.
7. **`AppBar`** — Deep Ocean top bar, white H1 title, optional back chevron and a bell
   icon with a red `notifBadge` count dot (top-right). Respects safe-area top inset.
8. **`PlateText`** (restyle existing) — IND number-plate look: monospace, yellow plate
   background, dark text; used by Vehicles later.

All components export from `src/components/ui/index.ts` for clean imports.

---

## 6. Navigation shell — `app/index.tsx`

- Bottom nav, 5 tabs in order: **Home · My Unit · Community · Events · Profile**.
  Icons (MaterialCommunityIcons): `home-variant`, `home-city`, `forum`, `calendar-star`,
  `account`.
- Active tab: Deep Ocean icon + label, **4dp Amber dot** centered below the label.
  Inactive: `textTertiary` icon + label. Tab bar bg white, hairline top border
  `surfaceBorder`.
- Screen area background = Mist; safe-area aware.
- Each tab renders a branded **placeholder** (`<TabPlaceholder name=… />`: Deep Ocean
  icon, screen title, "Coming in this redesign" caption) in this sub-project. Auth flow
  (Login/Register), the approval overlay, and push-notification wiring are preserved.
- The existing dark tab screens remain in the repo (compiling via aliases) but are not
  routed from the new shell; they are replaced one-by-one in sub-projects 1–5.

---

## 7. Testing / acceptance criteria

- `pnpm --filter resident-app start` (Expo) launches without errors on web + Android.
- Fonts load; all text renders in DM Sans (no system-font flash after load).
- Bottom nav shows 5 tabs; switching tabs works; active tab shows Deep Ocean styling +
  Amber dot; inactive tabs are tertiary.
- A dev-only **component gallery** (reachable in dev, e.g. a hidden route or the Profile
  placeholder in `__DEV__`) renders every base component in all variants/states against
  the Mist background, visually matching the Brief (amber CTAs, teal focus/verified,
  tinted status badges, Deep Ocean AppBar/hero).
- Existing screens still compile (TypeScript passes) via back-compat aliases.
- No hardcoded hex in components — all colours come from tokens.

---

## 8. Risks / notes

- **Spacing/radius value shifts** (e.g. old `xl:20`→`24`, `radius.lg:14`→`16`) slightly
  change existing screens; acceptable since each is rebuilt, and aliases prevent breaks.
- **App icon & splash** still show the old CommunityGate art until the Deep-Ocean/Teal
  assets are produced (Brief §10) — tracked as a design-asset dependency, not a blocker.
- The captured chat transcripts live in `docs/design-sources/` for reference during the
  per-tab sub-projects.
