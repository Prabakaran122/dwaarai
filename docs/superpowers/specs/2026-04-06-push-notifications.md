# Push Notifications — FCM

## Overview

Add push notifications to the Resident App via Firebase Cloud Messaging (FCM). Three notification types: vehicle entry/exit (informational), visitor at gate with approve/deny action buttons (actionable), and FASTag paired (informational). Guard App gets a "Notify Resident" button to trigger visitor alerts.

## Notification Types

| Trigger | Title | Body | Actions |
|---|---|---|---|
| Vehicle matched to unit during access check | "Vehicle Entry" | "Your KA05MF1234 entered Main Gate at 8:42 AM" | None (tap opens app) |
| Guard taps "Notify Resident" in ActionZone | "Visitor at Gate" | "Rahul is at the gate — approve entry?" | **Approve** / **Deny** buttons + tap opens app |
| FASTag auto-paired to vehicle | "FASTag Linked" | "FASTag linked to KA05MF1234 — auto-entry active!" | None (tap opens app) |

## FCM Token Registration

- Resident App requests notification permissions on first launch after login
- Calls `POST /notifications/register` with `{fcm_token}` on every app startup (tokens can rotate)
- Server upserts token into `residents.fcm_token` column (already exists in DB schema)
- On logout, app calls `POST /notifications/unregister` to clear the token

## Vehicle Entry/Exit Notifications

Triggered in the existing access check flow (`POST /access/check` in vehicles.js). After a successful access decision where `matched_unit_id` is set:

1. Access check resolves with `allow` decision and a `matched_unit_id`
2. Server queries all residents in that unit who have a non-null `fcm_token`
3. Sends FCM notification to each: title "Vehicle Entry", body with plate + gate name + time
4. Fire-and-forget — notification failure does not affect the access decision

## Visitor at Gate Notifications (Actionable)

### Guard Side

1. Guard sees unknown visitor in ActionZone (decision = `guard_review`, no matched resident)
2. Guard taps "Notify Resident" button
3. Inline input appears: visitor name (required) + unit number (required)
4. Guard submits → `POST /notifications/visitor-alert` with `{visitor_name, unit_number, gate_id}`
5. Guard's Approve/Deny buttons remain active — guard is not blocked
6. First response wins: if guard acts before resident, the notification becomes stale. If resident acts first, guard sees the gate event in live feed.

### Backend

1. `POST /notifications/visitor-alert` receives visitor_name, unit_number, gate_id
2. Looks up unit by unit_number + guard's community_id
3. Queries all residents in that unit with non-null fcm_token
4. Sends FCM notification with:
   - Title: "Visitor at Gate"
   - Body: "{visitor_name} is at the gate — approve entry?"
   - Data payload: `{type: 'visitor_alert', gate_id, visitor_name, unit_number}`
   - Android notification actions: "Approve" and "Deny"
5. Returns success to guard immediately (does not wait for resident response)

### Resident Side

- **Approve action button** → app calls `POST /gates/{gate_id}/command` with `{action: 'open'}` → gate opens → notification dismissed
- **Deny action button** → app calls `POST /gates/{gate_id}/command` with `{action: 'deny'}` → notification dismissed
- **Tap notification body** → opens app to Home screen
- Actions work when app is backgrounded or killed (FCM background message handler)

## FASTag Paired Notifications

Triggered when the existing `fastag:paired` WebSocket event fires in the access check flow:

1. FASTag auto-pairs during access check → WebSocket broadcasts `fastag:paired` with plate + unit
2. In the same code path, server queries residents in the matched unit
3. Sends FCM notification: title "FASTag Linked", body with plate number

## Firebase Admin SDK Setup

New file `services/api-gateway/src/lib/fcm.js`:

- Uses `firebase-admin` SDK (new dependency)
- Initializes with service account credentials from `FIREBASE_SERVICE_ACCOUNT` env var (JSON string) or `FIREBASE_SERVICE_ACCOUNT_PATH` env var (file path)
- Exports `sendNotification(token, title, body, data)` and `sendToMultiple(tokens, title, body, data)`
- When not configured (no credentials), logs notifications to console and returns silently — same dev fallback pattern as MSG91

## New API Endpoints

### POST /notifications/register (JWT resident)

Request: `{fcm_token: string}`

Updates `residents.fcm_token` for the authenticated resident. Returns success.

### POST /notifications/unregister (JWT resident)

Clears `residents.fcm_token` for the authenticated resident. Called on logout.

### POST /notifications/visitor-alert (JWT guard)

Request: `{visitor_name: string, unit_number: string, gate_id: string}`

Looks up residents in the unit, sends FCM push to each. Returns `{notified: number}` (count of tokens notified).

## Files Changed

### Backend (API Gateway)

| File | Action | Change |
|---|---|---|
| `src/lib/fcm.js` | Create | Firebase Admin SDK wrapper — init, sendNotification, sendToMultiple, isConfigured |
| `src/routes/notifications.js` | Create | Token register/unregister + visitor-alert endpoints |
| `src/index.js` | Modify | Import and mount notifications router |
| `src/routes/vehicles.js` | Modify | In access check handler, after allow decision with matched_unit_id, send vehicle entry push |
| `package.json` | Modify | Add `firebase-admin` dependency |

### Resident App

| File | Action | Change |
|---|---|---|
| `src/lib/notifications.ts` | Create | Request permissions, get FCM token, register with server, handle foreground/background notifications, handle action buttons |
| `src/api/client.ts` | Modify | Add registerFCMToken, unregisterFCMToken endpoints |
| `app/index.tsx` | Modify | Initialize notifications after auth, register token, set up notification listeners |
| `package.json` | Modify | Add `expo-notifications`, `expo-device` |
| `app.json` | Modify | Add notification config (icon, color, android channel) |

### Guard App

| File | Action | Change |
|---|---|---|
| `src/components/ActionZone.tsx` | Modify | Add "Notify Resident" button with visitor name + unit number input, calls POST /notifications/visitor-alert |
| `src/api/client.ts` | Modify | Add notifyResident endpoint |

## Prerequisites (manual, outside this spec)

1. Create Firebase project at console.firebase.google.com
2. Enable Cloud Messaging
3. Download `google-services.json` for the Resident App Android build
4. Generate a service account key (JSON) for the API Gateway
5. Set `FIREBASE_SERVICE_ACCOUNT` env var on EC2 with the service account JSON
6. Configure `app.json` in resident-app with the Firebase project ID
