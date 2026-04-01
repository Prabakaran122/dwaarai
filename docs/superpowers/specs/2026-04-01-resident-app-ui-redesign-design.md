# Resident App UI Redesign — Gradient Glow

Apply the same Gradient Glow theme from the Guard App to the Resident App. Portrait phone layout. Copy theme tokens and reusable components, then redesign all 5 screens + tab bar + entry point.

## Scope

- Resident App only
- Copy theme + components from Guard App (no shared package yet)
- Visual redesign of all screens — same functionality, new look
- Custom gradient tab bar

## Dependencies to Add

- `expo-linear-gradient`
- `react-native-reanimated`
- `@expo/vector-icons` (already bundled with Expo)

## Files Copied from Guard App

Copy into `apps/resident-app/src/`:
- `theme/colors.ts` — identical color tokens
- `theme/spacing.ts` — identical spacing + radius
- `components/GlowCard.tsx` — card with gradient border
- `components/GradientButton.tsx` — gradient button with press animation
- `components/StatusPill.tsx` — status indicator pill
- `components/PlateText.tsx` — monospace plate display
- `components/IconBadge.tsx` — icon in gradient circle
- `components/AnimatedEntry.tsx` — mount animation wrapper

## Screen Designs

### Login Screen

- Full-screen LinearGradient background (#0c1222 → #1a1145)
- GlowCard centered, phone icon in gradient circle + "CommunityGate" + "RESIDENT LOGIN"
- Step 1 (phone): phone input with phone icon, glowing focus border, "Send OTP" GradientButton
- Step 2 (otp): "OTP sent to {phone}" label, 6 individual digit boxes with glow on fill, "Verify" GradientButton, "Change number" link
- Error messages in danger color
- AnimatedEntry on mount

### Home Screen

- Gradient background
- Greeting: "Hello, {name}" with wave icon (hand-wave from MaterialCommunityIcons)
- Two stat GlowCards side by side with gradient accent icons:
  - Vehicles: car icon in blue-purple gradient circle + count
  - Active Passes: ticket icon in purple-pink gradient circle + count
- "Recent Entries" section: list of GlowCards with visitor/gate/time, AnimatedEntry stagger
- Pull-to-refresh
- Empty state: clock icon + "No recent entries"

### Vehicles Screen

- Gradient background
- Header: "My Vehicles" + count
- FlatList of vehicle GlowCards:
  - PlateText (md), make/model text, type badge (car/bike/truck icon)
  - RFID StatusPill (active = success, inactive = default)
  - Edit/delete icons (pencil, trash) on right
  - AnimatedEntry stagger
- Gradient FAB (circle with plus icon) bottom-right to add vehicle
- Modal form (GlowCard overlay): plate, make, model, type selector chips, Save (GradientButton success) + Cancel
- Empty state: car icon + "No vehicles registered"

### Passes Screen

- Gradient background
- Header: "Visitor Passes" + count
- FlatList of pass GlowCards:
  - Visitor name + phone, validity dates
  - StatusPill (active/used/expired/revoked)
  - Collapsible OTP display (tap to reveal, monospace)
  - Revoke button for active passes (small danger GradientButton)
  - AnimatedEntry stagger
- Gradient FAB to create pass
- Modal form: visitor name, phone, duration selector (chip group: 4h, 12h, 24h, 48h), Create GradientButton
- Empty state: ticket icon + "No visitor passes"

### Notifications Screen

- Gradient background
- FlatList of event GlowCards:
  - IconBadge (gate icon or car icon based on event type)
  - Visitor/resident name, gate name
  - Timestamp (formatted date + time)
  - AnimatedEntry stagger
- Pull-to-refresh
- Empty state: bell icon + "No notifications yet"

### Tab Bar

- Custom tab bar replacing default React Navigation bottom tabs
- Background: bgPrimary with surfaceBorder top line
- 4 tabs: Home (home), Vehicles (car), Passes (ticket-account), Notifications (bell)
- Active: gradient underline indicator + textPrimary color
- Inactive: textMuted color
- Icons from MaterialCommunityIcons

### Entry Point (`app/index.tsx`)

- Gradient loading spinner while rehydrating auth
- Auth gate: LoginScreen if not authenticated, ResidentApp (tabs) if authenticated
- Socket.io connection maintained (from previous auth wiring)

## Icons Used (MaterialCommunityIcons)

- `cellphone` — login logo
- `phone` — phone input
- `hand-wave` — greeting
- `car` — vehicles tab/icon
- `ticket-account` — passes tab/icon
- `bell` — notifications tab/icon
- `home` — home tab
- `plus` — FAB add button
- `pencil` — edit
- `delete` — delete/remove
- `eye` / `eye-off` — show/hide OTP
- `clock-outline` — timestamp
- `gate` — gate events
- `check-circle` — active status
- `close-circle` — revoke

## Out of Scope

- Shared package extraction (copy for now)
- Dark/light toggle (dark only)
- Custom fonts
