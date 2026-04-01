# Guard App UI Redesign — Gradient Glow

Modern, elegant UI overhaul for the Guard App using a "Gradient Glow" design language — rich gradients, glowing accents, purple-blue palette. Custom components built with expo-linear-gradient and react-native-reanimated. No external UI library.

## Scope

- Guard App only (Resident App follows later with same design system)
- Visual redesign of all screens — same functionality, new look
- New shared theme and reusable components
- Entry point stays as `app/index.tsx` with screens imported from `src/screens/`

## Dependencies

- `expo-linear-gradient` — gradient backgrounds and buttons
- `react-native-reanimated` — smooth entry animations, transitions
- `@expo/vector-icons` — already bundled with Expo, import MaterialCommunityIcons

## Design System

### Colors (`src/theme/colors.ts`)

```
Background:       #0c1222 (deep navy)
Background Alt:   #1a1145 (deep purple)
Surface:          rgba(255,255,255,0.04) with rgba(255,255,255,0.06) border
Surface Hover:    rgba(255,255,255,0.08)

Primary Gradient: #3b82f6 → #8b5cf6 (blue to purple)
Accent Gradient:  #a855f7 → #ec4899 (purple to pink)

Success:          #34d399 (text), rgba(34,197,94,0.2) (bg), rgba(34,197,94,0.15) (border)
Danger:           #f87171 (text), rgba(239,68,68,0.2) (bg), rgba(239,68,68,0.15) (border)
Warning:          #fbbf24 (text), rgba(251,191,36,0.2) (bg), rgba(251,191,36,0.15) (border)
Info:             #818cf8 (text), rgba(99,102,241,0.2) (bg)

Text Primary:     #e2e8f0
Text Secondary:   #6366f1 (indigo tint)
Text Muted:       #475569
```

### Typography

- Headings: System font, weight 700-800, sizes 20-28px
- Plate numbers: Monospace, weight 700, letter-spacing 1.5px, size 16-20px
- Labels: Uppercase, letter-spacing 1px, size 11px, text muted
- Body: 14-16px, weight 400-500

### Spacing (`src/theme/spacing.ts`)

Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48

### Border Radius

Cards: 14-16px, Buttons: 12px, Pills: 20px, Icons: 10-12px

## Reusable Components

### `src/components/GlowCard.tsx`
Card with gradient border effect. Props: `children`, `style`, `variant` (default | success | danger | warning). Surface background with colored border glow based on variant.

### `src/components/GradientButton.tsx`
Button with LinearGradient background. Props: `title`, `onPress`, `variant` (primary | success | danger), `icon` (optional icon name), `loading`, `disabled`. Primary = blue→purple, success = green gradient, danger = red gradient. Includes press animation (scale down slightly).

### `src/components/StatusPill.tsx`
Rounded pill showing status. Props: `status` (allow | deny | guard_review), `size` (sm | md). Colored background with matching text. Replaces the old StatusBadge.

### `src/components/PlateText.tsx`
License plate display. Props: `plate`, `size` (sm | md | lg). Monospace font, letter-spacing, optional subtle text shadow glow.

### `src/components/IconBadge.tsx`
Icon in a colored gradient circle. Props: `icon` (MaterialCommunityIcons name), `color`, `bgColor`, `size`.

### `src/components/AnimatedEntry.tsx`
Wrapper that animates children on mount. Props: `children`, `delay` (stagger), `direction` (left | right | up | fade). Uses react-native-reanimated FadeIn/SlideIn.

## Screen Designs

### Login Screen

- Full-screen LinearGradient background (#0c1222 → #1a1145, diagonal)
- Centered card: surface background, gradient border glow
- Top: Shield icon (MaterialCommunityIcons `shield-check`) + "CommunityGate" title + "Guard Station" subtitle
- Username input: surface background, glowing purple-blue border on focus
- Password input: same style, secureTextEntry
- Error message: danger color text
- Sign In button: GradientButton (primary variant) full width
- Loading state: ActivityIndicator inside button

### Queue Screen (Main — Landscape)

**Header bar (height ~56px):**
- LinearGradient background (subtle, horizontal)
- Left: gate icon + gate name
- Center: "Vehicle Queue" title
- Right: guard name + logout icon button

**Body (flex row, landscape-optimized):**

**Left panel (flex 0.6) — Pending Review:**
- Section title: "Pending Review" with count badge (gradient pill)
- List of GlowCard items (variant: warning for guard_review):
  - IconBadge (car icon or camera icon based on detection method)
  - PlateText (large monospace)
  - Resident name, unit number (text secondary)
  - ANPR confidence: thin gradient progress bar (if anpr method)
  - Timestamp (text muted)
  - AnimatedEntry (slide from left, staggered)
- Tap card → navigate to Approve screen
- Empty state: gate icon + "All clear — no vehicles pending"

**Right panel (flex 0.4) — Recent Activity:**
- Section title: "Recent" with count
- Compact list items (no card, just rows):
  - StatusPill (sm) + plate + time
  - Color-coded left border (green/red/yellow)
  - New items animate in from right

**Bottom stats bar (height ~64px):**
- 3 stat counters in a row, each with gradient background:
  - Pending (blue-purple gradient bg) with count
  - Today's Entries (purple-pink gradient bg) with count
  - Denied (red gradient bg) with count

### Approve Screen

- Full overlay on top of queue (modal-style)
- AnimatedEntry: slide up from bottom
- Top: snapshot image placeholder with gradient overlay (dark bottom fade)
- Center card:
  - PlateText (lg)
  - Detection method + confidence
  - Resident name, unit, vehicle make/model
  - Timestamp
- Bottom: two large GradientButtons side by side:
  - "Approve" (success variant, checkmark icon)
  - "Deny" (danger variant, close icon)
- Tap outside or swipe down to dismiss

### OTP Verify Screen

- Gradient background
- Title: "Verify Visitor OTP"
- 6 individual digit boxes in a row, each a GlowCard (sm), with glowing focus on active box
- Auto-advance to next box on digit entry
- Submit button: GradientButton (primary)
- Result display:
  - Success: GlowCard (success variant) with visitor name, gate, checkmark IconBadge
  - Failure: GlowCard (danger variant) with "Invalid or expired OTP" message
  - AnimatedEntry for result

### Incident Screen

- Gradient background
- Title: "Report Incident"
- Incident type chips in a horizontal scroll:
  - Each chip: GlowCard (sm) with icon + label
  - Selected: filled gradient background, unselected: surface
  - Types: Unauthorized Entry, Tailgating, Suspicious Vehicle, Equipment Fault, Other
- Description: multiline TextInput with glowing border on focus, surface background
- Submit: GradientButton (danger variant, "Report" with warning icon)

## File Structure Summary

```
apps/guard-app/
  src/
    theme/
      colors.ts          — color tokens
      spacing.ts         — spacing scale
    components/
      GlowCard.tsx       — card with gradient border
      GradientButton.tsx — gradient background button
      StatusPill.tsx     — status indicator pill
      PlateText.tsx      — license plate display
      IconBadge.tsx      — icon in gradient circle
      AnimatedEntry.tsx  — mount animation wrapper
      VehicleCard.tsx    — REDESIGN (uses new components)
    screens/
      LoginScreen.tsx    — REDESIGN
      QueueScreen.tsx    — REDESIGN
      ApproveScreen.tsx  — REDESIGN
      OTPVerifyScreen.tsx — REDESIGN
      IncidentScreen.tsx — REDESIGN
  app/
    index.tsx            — UPDATE (import redesigned screens, keep auth gate)
```

## Icons Used (MaterialCommunityIcons)

- `shield-check` — login logo
- `car` — vehicle
- `camera` — ANPR detection
- `card-bulleted` — RFID detection
- `account` — manual/guard detection
- `gate` — gate status
- `check-circle` — approve/allow
- `close-circle` — deny
- `alert` — warning/incident
- `logout` — logout button
- `clock-outline` — timestamp
- `numeric` — OTP input

## Animations

- **Screen transitions:** FadeIn (300ms) for screen mounts
- **Card entry:** SlideInLeft (400ms, staggered 100ms per card) in queue
- **Recent events:** SlideInRight (300ms) for new items
- **Approve overlay:** SlideInUp (400ms) with spring config
- **Button press:** Scale to 0.96 on press (150ms), scale back on release
- **OTP result:** FadeIn + scale from 0.8 to 1.0 (400ms)

## Out of Scope

- Resident App redesign (follows with same design system later)
- Admin Portal redesign (already uses Tailwind, lower priority)
- Custom fonts (system fonts are sufficient)
- Dark/light theme toggle (dark only for guard app — outdoor use)
