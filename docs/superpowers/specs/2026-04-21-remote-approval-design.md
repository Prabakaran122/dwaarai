# Remote Approval from Push Notification — Design Spec

**Date:** 2026-04-21
**Feature:** Resident remotely approves/denies visitor entry from push notification
**Status:** Approved

---

## Overview

When a delivery person or visitor arrives at the gate without a pre-created visitor pass, the guard initiates an approval request. All residents in the target unit receive an actionable push notification with Approve/Deny buttons. The first resident to respond controls the gate. The guard sees the result in real-time via WebSocket.

## Flow

1. Guard enters visitor name + unit number in guard app, taps "Request Approval"
2. Server creates `approval_request` (status: pending, expires in 60s)
3. Server sends actionable push notification to ALL residents in the unit
4. Resident taps Approve/Deny from notification banner or opens app to approval screen
5. Server processes first response: opens gate (if approved) or denies
6. Guard app receives result via WebSocket in real-time
7. Other residents who haven't responded see "Already handled"
8. If no response in 60s, guard sees "No Response" and can resend or deny

## Data Model

### New Table: `approval_requests`

```sql
CREATE TABLE approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL REFERENCES communities(id),
  unit_id         UUID NOT NULL REFERENCES units(id),
  gate_id         UUID NOT NULL REFERENCES gates(id),
  guard_id        UUID NOT NULL,
  visitor_name    VARCHAR(200) NOT NULL,
  vehicle_plate   VARCHAR(20),
  status          VARCHAR(20) DEFAULT 'pending',
  responded_by    UUID REFERENCES residents(id),
  responded_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_approval_pending ON approval_requests(community_id, unit_id)
  WHERE status = 'pending';
```

**Status values:** pending | approved | denied | expired

No changes to existing tables.

## API Endpoints

### POST `/api/v1/approvals`

**Auth:** Guard JWT

**Request:**
```json
{
  "unit_number": "402",
  "visitor_name": "Swiggy Delivery",
  "vehicle_plate": "KA05MF1234",
  "gate_id": "gate-01"
}
```

**Server-side:**
1. Look up unit by unit_number + community_id
2. Create approval_request (expires_at = NOW() + 60s)
3. Query all residents in unit with FCM tokens
4. Send actionable push notification to each (category: `approval_request`)
5. Start 60s expiry timer (setTimeout or scheduled check)
6. Broadcast WebSocket event to guard: `{ type: "approval_waiting", id, expires_at }`

**Response:**
```json
{
  "id": "uuid",
  "status": "pending",
  "expires_at": "2026-04-21T10:01:00Z",
  "residents_notified": 3
}
```

### POST `/api/v1/approvals/:id/respond`

**Auth:** Resident JWT

**Request:**
```json
{
  "action": "approve"
}
```

**Server-side:**
1. Check approval_request exists and status = 'pending' and not expired
2. Update: status = action (approved/denied), responded_by, responded_at
3. If approved: send gate open command via MQTT
4. Broadcast WebSocket to guard: `{ type: "approval_response", id, status, responded_by_name }`
5. Send silent push to other residents: "Already handled by {name}"
6. Log gate event to audit trail

**Response:**
```json
{
  "status": "approved",
  "gate_opened": true
}
```

**Error cases:**
- Request expired: `409 { error: "Request expired" }`
- Already responded: `409 { error: "Already handled", responded_by: "Priya" }`

### GET `/api/v1/approvals/:id`

**Auth:** Guard or Resident JWT

**Response:** Full approval_request object. Used as polling fallback when WebSocket disconnects.

## Guard App Changes

### ActionZone Component

**Rename** "Notify Resident" to "Request Approval" — same form (visitor name + unit number), but now enters a waiting state after submission.

**Waiting state UI:**
- Countdown timer (60 → 0)
- Visitor name + unit number displayed
- Resend button (creates new request)
- Deny Entry button (guard manually denies)

**Result states:**
- Approved: green banner "Approved by Priya (402)" — gate already opened
- Denied: red banner "Denied by Resident"
- Expired: yellow banner "No Response" — Resend / Deny / Call options

### Multiple Simultaneous Requests

Guard app shows a queue/list of pending approval requests. Current request is expanded with countdown, others shown collapsed. Each is independent — guard can process next while waiting for responses.

### WebSocket Listener

Listen for `approval_response` events on existing WebSocket connection:
```json
{
  "type": "approval_response",
  "approval_id": "uuid",
  "status": "approved",
  "responded_by_name": "Priya"
}
```

**Fallback:** If WebSocket disconnects, poll `GET /approvals/:id` every 3s while in waiting state.

## Resident App Changes

### Actionable Push Notification

```
Dwaar AI
Swiggy Delivery at Main Gate
Requesting entry to Flat 402
[Approve]  [Deny]
```

**Expo notification category:** `approval_request`
- Action: `approve` — calls POST /approvals/:id/respond in background
- Action: `deny` — calls POST /approvals/:id/respond in background
- Tap body — deep links to ApprovalScreen

**Background handling:** Use Expo `Notifications.addNotificationResponseReceivedListener` to handle button taps even when app is in background.

### ApprovalScreen (new screen)

Modal screen opened via deep link from notification.

**Content:**
- Visitor name
- Gate name
- Vehicle plate (if available)
- Countdown timer (time remaining)
- Approve button (green)
- Deny button (red)

**After responding:**
- Approve: "Gate opened for Swiggy Delivery" confirmation
- Deny: "Entry denied" confirmation
- Already handled: "Already handled by Priya"
- Expired: "This request has expired"

**Navigation:** Added to resident app navigation stack as a modal. Deep link: `dwaarai://approval/:id`

## Edge Cases

| Scenario | Handling |
|----------|---------|
| All residents offline | 60s expires → guard sees "No Response" → resend or deny |
| Approve after expiry | Server rejects 409. Resident sees "Request expired" |
| Two residents approve simultaneously | First POST wins (DB: WHERE status='pending'). Second sees "Already handled" |
| Duplicate request for same unit | Allowed. UI warns: "Pending request exists for Flat 402. Send another?" |
| App killed/background | OS-level notification buttons still work |
| WebSocket disconnects | Guard app polls GET /approvals/:id every 3s |
| Network failure after approve | Gate command already sent server-side before HTTP response |
| Guard denies while resident deciding | Server sets status=denied → resident sees "Cancelled by guard" |
| Wrong unit entered | Wrong resident ignores/denies → guard corrects and resends |

## Expiry Mechanism

Two mechanisms to ensure expiry is reliable:

**Primary:** `setTimeout(60000)` in Node.js after creating the request. On fire:
1. Check if status is still 'pending'
2. Update status = 'expired'
3. Broadcast WebSocket to guard: `{ type: "approval_response", id, status: "expired" }`

**Safety net (survives server restart):** Every API call that reads an approval_request checks `expires_at`. If past due and status is still 'pending', update to 'expired' on the spot. This covers the case where the server restarts and in-memory timers are lost.

## What's NOT Changing

- Existing visitor pass / OTP flow — untouched
- Guard app gate commands — untouched
- Resident app visitor screen — untouched
- Edge node / C3 controller — untouched (gate open command is the same MQTT message)
