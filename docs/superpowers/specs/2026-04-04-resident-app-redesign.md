# Resident App Redesign — Production-Ready

## Target User

Tech-savvy flat owners (30-50 age), expect Swiggy/Zomato level UX. The app should feel polished, fast, and require minimal interaction for daily use.

## Core Principle

The app's killer feature is **push notifications, not the app itself**. Residents rarely open the app proactively — the app comes to them via notifications. When they do open it, the top actions are: check activity feed, share visitor pass.

## Navigation (5 tabs)

| Tab | Icon | Purpose |
|---|---|---|
| Home | `home` | Activity feed + quick actions |
| Visitors | `account-group` | Create/manage visitor passes + WhatsApp sharing |
| Vehicles | `car` | Vehicle list + FASTag status |
| Activity | `history` | Full entry/exit history with filters |
| Profile | `account` | Unit details, family, settings, logout |

## Self-Registration Flow

Residents self-register using a community invite code shared by the admin.

**First time:**
1. Download app
2. Enter community code (e.g., "PALM2026")
3. Enter phone number + unit number
4. OTP verification
5. Server validates: code matches community, unit exists, phone not already registered
6. Account created → "Welcome to Palm Meadows, Unit 301"

**Returning:**
1. Open app → enter phone → OTP → straight to home

**Admin side:**
- Admin creates community → system generates invite code
- Admin shares code in society WhatsApp group
- No per-resident manual registration needed

**API changes:**
- New endpoint: `POST /auth/resident-register` — accepts `{community_code, phone, unit_number}`, sends OTP
- New endpoint: `POST /auth/resident-register-verify` — verifies OTP, creates resident record, returns JWT
- New column on `communities` table: `invite_code VARCHAR(20) UNIQUE`

## Home Screen

**Header:**
- Greeting: "Good morning, Priya" (time-based: morning/afternoon/evening)
- Unit badge: "Unit 301, Tower A"
- Notification bell (top right) with unread count

**Live Activity Card (main focus):**
- Last 3-5 entry/exit events at this unit
- Each row: icon (car/bike/person) + plate or name + "Entered 8:42 AM" / "Exited 5:15 PM"
- Real-time via WebSocket — updates live
- Tap → opens Activity tab

**Quick Actions (2x2 grid):**
- "Share Visitor Pass" (primary gradient, largest)
- "My Vehicles" → Vehicles tab
- "Expected Today" → count of active passes
- "Gate History" → Activity tab

**Today's Summary Card:**
- 3 stats: "Entries: 4" | "Visitors: 1" | "Deliveries: 2"

## Visitors Screen

**Top: Quick Share Bar**
- Full-width "Share Visitor Pass" button (primary gradient)
- One tap → modal with name + time picker

**Active Passes (list):**
- Each card: visitor name, OTP code, QR icon, valid from/until, uses remaining
- Status pill: Active (green), Expired (gray), Used (blue)
- Swipe left → Revoke
- Tap → full details + share-again

**Create Pass Flow (3 steps):**
1. Enter visitor name (required) + vehicle number (optional) + "Coming by cab" checkbox + time window (today/tomorrow/custom)
2. Pass created → screen shows QR code + 6-digit OTP
3. "Share via WhatsApp" button → opens WhatsApp with pre-filled message

**WhatsApp Message:**
```
Hi! I've shared a visitor pass for you at Palm Meadows.

Gate Code: 847291
Valid: Today 6:00 PM - 10:00 PM

If driving, add your vehicle number for automatic entry:
https://communitygate.app/pass/847291

- Priya, Unit 301
```

**Visitor link page (web, no app needed):**
- Shows QR code + OTP text
- Optional: "Enter your vehicle number" field for ANPR auto-entry
- Guard can scan QR or enter OTP at gate

**Vehicle number on pass:**
- Optional field during pass creation
- Visitor can also add via the link
- If provided: ANPR matches at gate → auto-entry (no guard needed)
- If not provided: visitor shows OTP to guard

## Vehicles Screen

**Vehicle Cards (list):**
- Vehicle icon (car/bike/truck) with gradient badge
- Plate number (large, monospace)
- Make + Model subtitle
- FASTag status:
  - Cyan "FASTag Linked" with car-wireless icon
  - Gray "No FASTag" — will pair on first drive-through
  - Amber "Pending" — first visit not completed yet
- Last entry timestamp: "Last entered: Today 8:42 AM"

**Add Vehicle (FAB):**
- Plate number (required), Make, Model (optional), Type (car/bike/truck)
- No FASTag input — pairs automatically on first drive-through

**Info banner (first time only):**
```
Your FASTag links automatically!
Just drive through the gate — your FASTag will be detected
and linked to this vehicle. No setup needed.
```

**Remove:** Swipe left or long press → confirm → deletes + unlinks FASTag

## Activity Screen

**Full entry/exit history for the unit.**

**Filter bar (top):**
- Date pills: "Today" | "Yesterday" | "This Week" | Custom
- Filter chips: "All" | "Vehicles" | "Visitors" | "Deliveries"

**Timeline list:**
- Time (large): "8:42 AM"
- Direction: green arrow-in (entry) / red arrow-out (exit)
- Vehicle plate or visitor name
- Detection method: FASTag (cyan) / ANPR (blue) / OTP (purple)
- Gate name
- Grouped by date

## Profile Screen

- Unit info card (read-only): Unit 301, Tower A, Palm Meadows
- Resident details: Name, Phone (editable)
- Family members: list, can add
- Notification preferences: entry alerts on/off, visitor alerts on/off
- Logout

## Push Notifications

**Three types with actionable buttons:**

| Event | Notification | Actions |
|---|---|---|
| Vehicle entry/exit | "Your KA05MF1234 entered Main Gate at 8:42 AM" | None (info) |
| Visitor at gate | "Rahul is at the gate — approve entry?" | **Approve** / **Deny** |
| FASTag paired | "FASTag linked to KA05MF1234 — auto-entry active!" | None (info) |

**Actionable visitor notification:**
- Approve → API call → gate opens → guard sees confirmation
- Deny → guard sees rejection
- No app opening needed

## Design Direction

- Same Gradient Glow theme (dark background, gradient borders, cyan/purple/green accents)
- Production polish: loading skeletons, smooth animations, pull-to-refresh
- Empty states with illustrations for each screen
- Monospace plate text, status pills, icon badges (existing components)

## API Changes Required

### New endpoints:
- `POST /auth/resident-register` — register with community code + phone + unit
- `POST /auth/resident-register-verify` — verify OTP + create account
- `GET /events/my-unit` — events filtered to resident's unit (for activity feed)
- WebSocket: `unit:event` — real-time events for the resident's unit

### Modified endpoints:
- `GET /vehicles` — include `fastag_tid_hash` and `last_entry_at` in response
- `POST /passes` — add optional `visitor_vehicle` field
- `GET /passes` — include QR code data / pass URL in response

### New DB column:
- `communities.invite_code` — VARCHAR(20), UNIQUE, auto-generated

## Files Changed

### New screens:
- `src/screens/RegisterScreen.tsx` — community code + phone + unit + OTP
- `src/screens/ActivityScreen.tsx` — full history with filters
- `src/screens/ProfileScreen.tsx` — unit info, settings, logout

### Redesigned screens:
- `src/screens/HomeScreen.tsx` — activity feed + quick actions + summary
- `src/screens/VehiclesScreen.tsx` — FASTag status + last entry + info banner
- `src/screens/PassesScreen.tsx` → renamed to `VisitorsScreen.tsx` — WhatsApp sharing + QR

### Modified:
- `src/screens/LoginScreen.tsx` — add "First time? Register" link
- `src/store/authStore.ts` — add register flow
- `src/store/vehicleStore.ts` — fastagTidHash + lastEntryAt
- `src/api/client.ts` — new endpoints
- `App.tsx` / `app/index.tsx` — 5-tab navigation + register screen

### API Gateway:
- `services/api-gateway/src/routes/auth.js` — register endpoints
- `services/api-gateway/src/routes/vehicles.js` — last_entry_at in response
- `services/api-gateway/src/routes/passes.js` — visitor vehicle + pass URL
- `services/api-gateway/migrations/009_invite_code.sql` — invite_code column

### New:
- `apps/resident-app/src/components/ActivityItem.tsx` — timeline row component
- `apps/resident-app/src/components/VisitorPassCard.tsx` — pass card with QR + share
- Visitor pass web page (simple HTML/Next.js page for the link)
