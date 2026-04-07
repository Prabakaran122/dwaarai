# Guard App Redesign — Single-Screen Workstation

## Target User

Security guards at residential community gates, using Android tablets in landscape mode. Guards work 8-12 hour shifts, often in outdoor booths. They need to make approve/deny decisions in under 2 seconds per vehicle. The tablet may be in sun/rain and guards may wear gloves.

## Core Principle

**One screen, zero navigation.** The guard never leaves the workstation. Every action — approve, deny, register, verify OTP, log incident — happens inline. The current multi-screen stack navigation is replaced by a single three-panel landscape layout.

## Layout: Three-Panel Workstation

| Left (~35%) | Center (~35%) | Right (~30%) |
|---|---|---|
| **Action Zone** | **Live Feed** | **Tools Panel** |
| Current pending vehicle | Real-time event timeline | OTP, gate controls, stats, incidents |
| Big plate + action buttons | All entries/exits scrolling | Compact tools, always visible |

### Header Bar (full width)

- **Left:** Gate name with online/offline dot
- **Center:** Shift info — "On since 8:04 AM · 47 events"
- **Right:** Guard name + logout button (with confirmation)

## Action Zone (Left Panel)

The guard's primary workspace. Shows ONE pending vehicle at a time with all info needed to decide.

### When a vehicle is pending:

**Vehicle Card:**
- Pending count badge: "3 pending" (top of panel)
- Large plate number (monospace, ~32px)
- Method badge with icon:
  - `camera` ANPR (blue)
  - `car-wireless` FASTag (cyan)
  - `card-bulleted` RFID (purple)
  - `numeric` OTP (pink)
  - `account` Manual (amber)
- ANPR confidence percentage (if applicable)
- Resident info (if matched): "Unit 301 · Priya Sharma"
- Timestamp: "8:42 AM"

**Alert Banners (conditional, above action buttons):**
- Red banner: "BLACKLISTED — {reason}" for blacklisted vehicles
- Amber banner: "FASTag mismatch — different tag for known vehicle"
- Cyan info banner: "FASTag auto-paired to {plate}" (info only)

**Action Buttons (large, full-width, stacked):**
- **Approve** — green gradient, `check-circle` icon. Sends gate open command, removes from queue, loads next.
- **Deny** — red gradient, `close-circle` icon. Sends deny command, removes from queue, loads next.
- **Approve + Register** — blue gradient, `car-plus` icon. Only visible for unknown FASTag/ANPR vehicles (no matched resident). Expands inline to show unit number input + "Register & Open" confirm button. No modal, no navigation.

**Priority ordering of pending queue:**
1. Blacklisted vehicles (highest — red alert)
2. FASTag mismatches (amber alert)
3. Unknown vehicles (guard_review)
4. Everything else by timestamp (oldest first)

### When queue is empty:

- Large checkmark icon with subtle pulse animation
- "All Clear" heading
- "No vehicles pending review" subtext
- GlowCard with success variant border

## Live Feed (Center Panel)

Real-time scrolling timeline of ALL gate events — entries, exits, allows, denies. Gives the guard full situational awareness.

### Each feed item:

- Time (large): "8:42 AM"
- Direction icon: green `arrow-down-circle` (entry) / red `arrow-up-circle` (exit)
- Plate number (monospace)
- Method pill: FASTag (cyan) / ANPR (blue) / RFID (purple) / OTP (pink)
- Decision pill: ALLOWED (green) / DENIED (red) / REVIEW (amber)
- Resident name (if matched), or visitor name for OTP entries

### Visual priority:

- Denied entries: red-tinted left border on the card
- FASTag auto-paired: subtle cyan left border
- Normal allowed: default GlowCard border

### Behavior:

- New events slide in from top with animation
- Maximum 50 events in memory
- Live via WebSocket — no polling or pull-to-refresh
- Read-only — tapping does nothing (action zone handles decisions)

### Alert indicators (visual, sound hooks for future):

- New pending review: amber flash on action zone border
- Blacklisted vehicle: red pulse on header bar
- Mute toggle in tools panel controls future sound

## Tools Panel (Right Panel)

Stacked vertically, always visible. Everything expands/collapses inline — nothing navigates away.

### 1. Gate Status Card

- Gate name with colored status dot (green = online, red = offline)
- Last heartbeat: "Last seen: 2s ago"
- Manual override buttons: "Open Gate" / "Close Gate" (for situations without a vehicle trigger)

### 2. OTP Verify (compact)

- Label: "VERIFY VISITOR"
- 6-digit inline input with auto-advance between fields
- Same digit input pattern as existing OTP screen (backspace navigation, number-only keyboard)
- On success: card expands to show:
  - Visitor name
  - Host unit number
  - Green "Open Gate" button
  - Guard taps to open, card resets
- On failure: red shake animation + "Invalid OTP" text, resets after 3 seconds
- Auto-resets after 10 seconds of inactivity post-verify

### 3. Shift Stats Card

- "On since 8:04 AM" with live duration (e.g., "4h 23m")
- Three stat counters in a row:
  - Entries (total allowed)
  - Denied (total denied)
  - Visitors (OTP verified)
- All derived from the live feed events — no API call needed
- Resets on login (shift start = login time)

### 4. Quick Actions

- **Log Incident** button — tapping expands inline:
  - Incident type chips (6 types): Unauthorized Entry, Tailgating, Suspicious Person, Vehicle Damage, Equipment Fault, Other
  - Description text input (multiline, 3 lines)
  - "Submit" button + "Cancel" to collapse
  - Success toast on submit, form collapses and resets
- **Mute Toggle** — bell icon, toggles between `bell` and `bell-off`, persisted to AsyncStorage

## Login Screen

No redesign needed — the current LoginScreen already matches the Gradient Glow theme with username/password inputs, animated entry, and error handling. Keep as-is.

## Design Direction

- Same Gradient Glow theme as Resident App (dark background, gradient borders, cyan/purple/green accents)
- Landscape orientation (existing app.json setting)
- Production polish: loading skeletons, smooth animations, empty states
- Monospace plate text, status pills, icon badges (reuse existing components)
- Large touch targets for action buttons (guards may wear gloves)

## Files Changed

### New screens:
- `src/screens/WorkstationScreen.tsx` — three-panel layout, orchestrates all panels

### New components:
- `src/components/ActionZone.tsx` — left panel: pending vehicle card + action buttons + register form
- `src/components/LiveFeed.tsx` — center panel: scrolling event timeline
- `src/components/FeedItem.tsx` — single event row in the feed
- `src/components/ToolsPanel.tsx` — right panel: gate status, OTP, stats, incidents
- `src/components/OTPInput.tsx` — compact reusable 6-digit input with auto-advance
- `src/components/ShiftStats.tsx` — shift duration + event counters
- `src/components/IncidentForm.tsx` — inline expandable incident report form

### Modified:
- `app/index.tsx` — render WorkstationScreen instead of QueueScreen when authenticated
- `src/store/queueStore.ts` — add priority sorting, pending count selector, shift stats tracking
- `App.tsx` — simplify to re-export from expo-router entry

### Deleted:
- `src/screens/QueueScreen.tsx` — replaced by WorkstationScreen
- `src/screens/ApproveScreen.tsx` — inline in ActionZone
- `src/screens/OTPVerifyScreen.tsx` — inline in ToolsPanel
- `src/screens/IncidentScreen.tsx` — inline in ToolsPanel

### No backend changes required.
All APIs and WebSocket events already exist:
- `POST /gates/{id}/command` — open/close gate
- `POST /passes/verify` — verify OTP
- `POST /vehicles/register-at-gate` — register vehicle with FASTag
- `POST /incidents` — log incident
- WebSocket: `gate:event`, `fastag:paired`, `fastag:mismatch`
