# Remote Approval from Push Notification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Residents can approve/deny visitor entry from a push notification when a guard requests approval, with real-time feedback to the guard app via WebSocket.

**Architecture:** New `approval_requests` DB table tracks ephemeral requests (60s TTL). Three new API endpoints handle create/respond/get. Guard app shows waiting state with countdown. Resident app receives actionable push notification and has a new ApprovalScreen. WebSocket carries real-time responses, with polling fallback.

**Tech Stack:** Node.js/Express (ESM), PostgreSQL, Socket.io, Expo Push API, Expo Notifications (React Native), Zustand stores.

**Spec:** `docs/superpowers/specs/2026-04-21-remote-approval-design.md`

---

## File Structure

### Backend (API Gateway)
| Action | File | Responsibility |
|--------|------|----------------|
| Create | `services/api-gateway/migrations/011_approval_requests.sql` | DB table + index |
| Create | `services/api-gateway/src/routes/approvals.js` | 3 endpoints: create, respond, get |
| Modify | `services/api-gateway/src/index.js:14,44` | Import + mount approval routes |
| Modify | `services/api-gateway/src/lib/fcm.js` | New `sendApprovalRequest()` push function |
| Modify | `services/api-gateway/src/websocket.js` | No structural change — uses existing `broadcast()` |

### Guard App
| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/guard-app/src/components/ApprovalWaiting.tsx` | Countdown timer + result display |
| Create | `apps/guard-app/src/store/approvalStore.ts` | Zustand store for pending approvals |
| Modify | `apps/guard-app/src/api/client.ts:63-68` | Add `createApproval()` + `getApproval()` |
| Modify | `apps/guard-app/src/components/ActionZone.tsx:85-103,168-201` | Replace notify with approval flow |
| Modify | `apps/guard-app/app/index.tsx:49` | Listen for `approval:response` WebSocket event |

### Resident App
| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/resident-app/src/screens/ApprovalScreen.tsx` | Full-screen approval modal |
| Modify | `apps/resident-app/src/api/client.ts:87-89` | Add `respondToApproval()` |
| Modify | `apps/resident-app/src/lib/notifications.ts:60-83` | Handle `approval_request` category + actions |
| Modify | `apps/resident-app/app/index.tsx:57-86` | Show ApprovalScreen overlay on notification |

---

## Task 1: Database Migration

**Files:**
- Create: `services/api-gateway/migrations/011_approval_requests.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 011_approval_requests.sql
-- Remote approval requests from guard → resident

CREATE TABLE IF NOT EXISTS approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL REFERENCES communities(id),
  unit_id         UUID NOT NULL REFERENCES units(id),
  gate_id         UUID NOT NULL REFERENCES gates(id),
  guard_id        UUID NOT NULL,
  visitor_name    VARCHAR(200) NOT NULL,
  vehicle_plate   VARCHAR(20),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  responded_by    UUID REFERENCES residents(id),
  responded_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approval_pending ON approval_requests(community_id, unit_id)
  WHERE status = 'pending';
```

- [ ] **Step 2: Run migration against local DB**

Run: `docker compose -f docker-compose.dev.yml exec postgres psql -U cguser -d communitygate -f /dev/stdin < services/api-gateway/migrations/011_approval_requests.sql`

If Docker not running: `psql -U cguser -d communitygate -f services/api-gateway/migrations/011_approval_requests.sql`

Expected: `CREATE TABLE` and `CREATE INDEX` output, no errors.

- [ ] **Step 3: Verify table exists**

Run: `docker compose -f docker-compose.dev.yml exec postgres psql -U cguser -d communitygate -c "\d approval_requests"`

Expected: Table with columns id, community_id, unit_id, gate_id, guard_id, visitor_name, vehicle_plate, status, responded_by, responded_at, expires_at, created_at.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/migrations/011_approval_requests.sql
git commit -m "feat: add approval_requests table for remote gate approval"
```

---

## Task 2: Push Notification Function

**Files:**
- Modify: `services/api-gateway/src/lib/fcm.js`

- [ ] **Step 1: Add `sendApprovalRequest` function**

Add after the existing `sendVisitorAlert` function (after line 61) in `services/api-gateway/src/lib/fcm.js`:

```javascript
export async function sendApprovalRequest(token, approvalId, visitorName, gateName, unitNumber) {
  if (!token || !token.startsWith('ExponentPushToken[')) {
    console.log(`[Push-DEV] Approval request: "${visitorName}" → token:${token?.slice(0, 30)}...`);
    return null;
  }

  const result = await sendExpoPush([{
    to: token,
    title: 'Visitor at Gate',
    body: `${visitorName} at ${gateName} — requesting entry to Unit ${unitNumber}`,
    data: {
      type: 'approval_request',
      approval_id: approvalId,
      visitor_name: visitorName,
      gate_name: gateName,
      unit_number: unitNumber,
    },
    sound: 'default',
    priority: 'high',
    channelId: 'communitygate',
    categoryId: 'approval_request',
  }]);
  return result;
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node -e "import('./services/api-gateway/src/lib/fcm.js').then(m => console.log(Object.keys(m)))"`

Expected: `['sendNotification', 'sendVisitorAlert', 'sendApprovalRequest', 'sendToMultiple']`

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/src/lib/fcm.js
git commit -m "feat: add sendApprovalRequest push notification function"
```

---

## Task 3: Approval API Routes

**Files:**
- Create: `services/api-gateway/src/routes/approvals.js`
- Modify: `services/api-gateway/src/index.js`

- [ ] **Step 1: Create approvals route file**

Create `services/api-gateway/src/routes/approvals.js`:

```javascript
import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { sendApprovalRequest } from '../lib/fcm.js';
import { publishGateCommand } from '../mqtt.js';
import { broadcast } from '../websocket.js';

const router = Router();

const APPROVAL_TTL_MS = 60_000; // 60 seconds

// In-memory expiry timers (cleared on response, lost on restart — safety net in GET endpoint)
const expiryTimers = new Map();

const createSchema = z.object({
  unit_number: z.string().min(1).max(30),
  visitor_name: z.string().min(1).max(200),
  vehicle_plate: z.string().max(20).optional(),
  gate_id: z.string().uuid(),
});

const respondSchema = z.object({
  action: z.enum(['approve', 'deny']),
});

// Helper: check and expire stale requests
async function expireIfStale(row) {
  if (row.status === 'pending' && new Date(row.expires_at) < new Date()) {
    await query(
      "UPDATE approval_requests SET status = 'expired' WHERE id = $1 AND status = 'pending'",
      [row.id]
    );
    row.status = 'expired';
  }
  return row;
}

// -- POST /approvals (JWT guard) — create approval request -------------------

router.post('/approvals', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { unit_number, visitor_name, vehicle_plate, gate_id } = parsed.data;
    const community_id = req.user.community_id;
    const guard_id = req.user.sub;

    // Look up unit
    const unit = await queryOne(
      'SELECT id FROM units WHERE community_id = $1 AND unit_number = $2',
      [community_id, unit_number]
    );
    if (!unit) {
      return error(res, 'Unit not found', 404);
    }

    // Look up gate name
    const gate = await queryOne(
      'SELECT name FROM gates WHERE id = $1 AND community_id = $2',
      [gate_id, community_id]
    );
    const gateName = gate?.name || 'Gate';

    // Create approval request
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);

    await query(
      `INSERT INTO approval_requests
         (id, community_id, unit_id, gate_id, guard_id, visitor_name, vehicle_plate, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
      [id, community_id, unit.id, gate_id, guard_id, visitor_name, vehicle_plate || null, expiresAt]
    );

    // Send push to all residents in unit
    const residents = await queryRows(
      'SELECT id, fcm_token FROM residents WHERE unit_id = $1 AND is_active = true AND fcm_token IS NOT NULL',
      [unit.id]
    );

    let notified = 0;
    for (const r of residents) {
      const result = await sendApprovalRequest(r.fcm_token, id, visitor_name, gateName, unit_number);
      if (result) notified++;
    }

    // Broadcast to guard app via WebSocket
    broadcast(community_id, 'approval:waiting', {
      approval_id: id,
      visitor_name,
      unit_number,
      gate_name: gateName,
      vehicle_plate: vehicle_plate || null,
      expires_at: expiresAt.toISOString(),
      residents_notified: notified,
    });

    // Set expiry timer
    const timer = setTimeout(async () => {
      try {
        const row = await queryOne(
          "SELECT status FROM approval_requests WHERE id = $1",
          [id]
        );
        if (row && row.status === 'pending') {
          await query(
            "UPDATE approval_requests SET status = 'expired' WHERE id = $1 AND status = 'pending'",
            [id]
          );
          broadcast(community_id, 'approval:response', {
            approval_id: id,
            status: 'expired',
            responded_by_name: null,
          });
        }
      } catch (err) {
        console.error('Approval expiry timer error:', err);
      }
      expiryTimers.delete(id);
    }, APPROVAL_TTL_MS);
    expiryTimers.set(id, timer);

    return success(res, {
      id,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      residents_notified: notified,
    }, 201);
  } catch (err) {
    console.error('POST /approvals error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /approvals/:id/respond (JWT resident) — approve or deny -----------

router.post('/approvals/:id/respond', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = respondSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { action } = parsed.data;
    const approvalId = req.params.id;
    const residentId = req.user.sub;
    const residentName = req.user.name || 'Resident';

    // Fetch request
    const approval = await queryOne(
      'SELECT id, community_id, gate_id, status, expires_at, visitor_name FROM approval_requests WHERE id = $1',
      [approvalId]
    );

    if (!approval) {
      return error(res, 'Approval request not found', 404);
    }

    // Safety-net expiry check
    if (approval.status === 'pending' && new Date(approval.expires_at) < new Date()) {
      await query(
        "UPDATE approval_requests SET status = 'expired' WHERE id = $1 AND status = 'pending'",
        [approvalId]
      );
      return error(res, 'Request expired', 409);
    }

    if (approval.status !== 'pending') {
      // Already handled
      if (approval.status === 'approved' || approval.status === 'denied') {
        return error(res, 'Already handled', 409);
      }
      return error(res, `Request ${approval.status}`, 409);
    }

    // Update status
    const newStatus = action === 'approve' ? 'approved' : 'denied';
    const updated = await queryOne(
      `UPDATE approval_requests
       SET status = $1, responded_by = $2, responded_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING id`,
      [newStatus, residentId, approvalId]
    );

    if (!updated) {
      // Race condition — someone else responded first
      return error(res, 'Already handled', 409);
    }

    // Clear expiry timer
    const timer = expiryTimers.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      expiryTimers.delete(approvalId);
    }

    let gateOpened = false;

    // If approved, open the gate
    if (action === 'approve') {
      try {
        const eventId = uuidv4();
        const ttl = Math.floor(Date.now() / 1000) + 30;

        await query(
          `INSERT INTO gate_events
             (id, community_id, gate_id, detection_method, raw_value, access_decision, event_ts)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [eventId, approval.community_id, approval.gate_id, 'approval', approval.visitor_name, 'allow']
        );

        await publishGateCommand(approval.community_id, approval.gate_id, {
          event_id: eventId,
          action: 'open',
          resident_name: residentName,
          ttl,
          ts: Date.now() / 1000,
        });

        gateOpened = true;
      } catch (mqttErr) {
        console.error('Gate open after approval failed:', mqttErr);
      }
    }

    // Broadcast to guard app
    broadcast(approval.community_id, 'approval:response', {
      approval_id: approvalId,
      status: newStatus,
      responded_by_name: residentName,
      gate_opened: gateOpened,
    });

    return success(res, {
      status: newStatus,
      gate_opened: gateOpened,
    });
  } catch (err) {
    console.error('POST /approvals/:id/respond error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /approvals/:id (JWT guard or resident) — polling fallback ----------

router.get('/approvals/:id', authenticateJWT(['guard', 'resident']), async (req, res) => {
  try {
    const approval = await queryOne(
      `SELECT id, community_id, unit_id, gate_id, visitor_name, vehicle_plate,
              status, responded_by, responded_at, expires_at, created_at
       FROM approval_requests WHERE id = $1`,
      [req.params.id]
    );

    if (!approval) {
      return error(res, 'Approval request not found', 404);
    }

    // Safety-net expiry
    await expireIfStale(approval);

    // Get responder name if responded
    let respondedByName = null;
    if (approval.responded_by) {
      const resident = await queryOne(
        'SELECT name FROM residents WHERE id = $1',
        [approval.responded_by]
      );
      respondedByName = resident?.name || null;
    }

    return success(res, {
      ...approval,
      responded_by_name: respondedByName,
    });
  } catch (err) {
    console.error('GET /approvals/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
```

- [ ] **Step 2: Mount routes in index.js**

In `services/api-gateway/src/index.js`, add import at line 14 (after notificationRoutes):

```javascript
import approvalRoutes from './routes/approvals.js';
```

Add route mount at line 44 (after notificationRoutes):

```javascript
app.use('/api/v1', approvalRoutes);
```

- [ ] **Step 3: Verify server starts without errors**

Run:
```bash
cd services/api-gateway
DATABASE_URL=postgresql://cguser:devpass@localhost:5432/communitygate \
JWT_SECRET=dev-secret-do-not-use-in-prod \
REDIS_URL=redis://localhost:6379 \
PORT_API_GATEWAY=3000 \
node src/index.js
```

Expected: `API Gateway listening on port 3000` with no import errors.

- [ ] **Step 4: Test create endpoint with curl**

```bash
# First get a guard JWT token from scripts/dev-tokens.txt or generate one
curl -s -X POST http://localhost:3000/api/v1/approvals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <guard-token>" \
  -d '{"unit_number":"101","visitor_name":"Swiggy Delivery","gate_id":"<gate-uuid>"}' | jq .
```

Expected: `201` response with `{ id, status: "pending", expires_at, residents_notified }`.

- [ ] **Step 5: Test respond endpoint with curl**

```bash
curl -s -X POST http://localhost:3000/api/v1/approvals/<approval-id>/respond \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <resident-token>" \
  -d '{"action":"approve"}' | jq .
```

Expected: `200` response with `{ status: "approved", gate_opened: true }`.

- [ ] **Step 6: Test get endpoint and expiry**

```bash
curl -s http://localhost:3000/api/v1/approvals/<approval-id> \
  -H "Authorization: Bearer <guard-token>" | jq .
```

Expected: Shows approval with status (approved/expired depending on timing).

- [ ] **Step 7: Commit**

```bash
git add services/api-gateway/src/routes/approvals.js services/api-gateway/src/index.js
git commit -m "feat: add approval request API endpoints (create, respond, get)"
```

---

## Task 4: Guard App — API Client + Store

**Files:**
- Modify: `apps/guard-app/src/api/client.ts`
- Create: `apps/guard-app/src/store/approvalStore.ts`

- [ ] **Step 1: Add API functions to guard client**

In `apps/guard-app/src/api/client.ts`, replace the existing `notifyResident` function (lines 64-68) and add new functions:

```typescript
// Approvals (replaces old notifyResident)
export const createApproval = (data: {
  unit_number: string;
  visitor_name: string;
  vehicle_plate?: string;
  gate_id: string;
}) => api.post('/approvals', data);

export const getApproval = (id: string) => api.get(`/approvals/${id}`);
```

Also keep `notifyResident` as a fallback export (rename to avoid breaking anything):

```typescript
// Legacy — kept for backwards compatibility
export const notifyResident = (data: {
  visitor_name: string;
  unit_number: string;
  gate_id: string;
}) => api.post('/notifications/visitor-alert', data);
```

- [ ] **Step 2: Create approval Zustand store**

Create `apps/guard-app/src/store/approvalStore.ts`:

```typescript
import { create } from 'zustand';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  visitor_name: string;
  unit_number: string;
  gate_name: string;
  vehicle_plate: string | null;
  expires_at: string;
  status: ApprovalStatus;
  responded_by_name: string | null;
  residents_notified: number;
}

interface ApprovalStore {
  approvals: ApprovalRequest[];
  addApproval: (approval: ApprovalRequest) => void;
  updateApproval: (id: string, update: Partial<ApprovalRequest>) => void;
  removeApproval: (id: string) => void;
  clearAll: () => void;
}

export const useApprovalStore = create<ApprovalStore>((set) => ({
  approvals: [],

  addApproval: (approval) =>
    set((s) => ({ approvals: [approval, ...s.approvals] })),

  updateApproval: (id, update) =>
    set((s) => ({
      approvals: s.approvals.map((a) =>
        a.id === id ? { ...a, ...update } : a
      ),
    })),

  removeApproval: (id) =>
    set((s) => ({
      approvals: s.approvals.filter((a) => a.id !== id),
    })),

  clearAll: () => set({ approvals: [] }),
}));
```

- [ ] **Step 3: Commit**

```bash
git add apps/guard-app/src/api/client.ts apps/guard-app/src/store/approvalStore.ts
git commit -m "feat: guard app approval API client + Zustand store"
```

---

## Task 5: Guard App — ApprovalWaiting Component

**Files:**
- Create: `apps/guard-app/src/components/ApprovalWaiting.tsx`

- [ ] **Step 1: Create the ApprovalWaiting component**

Create `apps/guard-app/src/components/ApprovalWaiting.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import AnimatedEntry from './AnimatedEntry';
import { useApprovalStore, type ApprovalRequest } from '../store/approvalStore';
import { createApproval, getApproval } from '../api/client';

interface Props {
  onDismiss: () => void;
  gateId: string;
}

export default function ApprovalWaiting({ onDismiss, gateId }: Props) {
  const approvals = useApprovalStore((s) => s.approvals);
  const updateApproval = useApprovalStore((s) => s.updateApproval);
  const removeApproval = useApprovalStore((s) => s.removeApproval);

  const current = approvals[0];

  // Countdown timer
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!current || current.status !== 'pending') return;

    const update = () => {
      const remaining = Math.max(0, Math.floor((new Date(current.expires_at).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [current?.id, current?.status, current?.expires_at]);

  // Polling fallback (every 3s when pending)
  useEffect(() => {
    if (!current || current.status !== 'pending') return;

    const poll = setInterval(async () => {
      try {
        const res = await getApproval(current.id);
        const data = res.data.data;
        if (data.status !== 'pending') {
          updateApproval(current.id, {
            status: data.status,
            responded_by_name: data.responded_by_name,
          });
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [current?.id, current?.status]);

  if (!current) return null;

  const isPending = current.status === 'pending';
  const isApproved = current.status === 'approved';
  const isDenied = current.status === 'denied';
  const isExpired = current.status === 'expired';

  const statusConfig = {
    pending: { icon: 'clock-outline' as const, color: colors.info, text: `Waiting... ${secondsLeft}s` },
    approved: { icon: 'check-circle' as const, color: colors.success, text: `Approved by ${current.responded_by_name || 'Resident'}` },
    denied: { icon: 'close-circle' as const, color: colors.danger, text: 'Denied by Resident' },
    expired: { icon: 'clock-alert' as const, color: colors.warning, text: 'No Response' },
  };

  const cfg = statusConfig[current.status] || statusConfig.pending;

  return (
    <AnimatedEntry direction="fade" duration={200}>
      <GlowCard variant={isApproved ? 'success' : isDenied ? 'danger' : undefined} style={styles.card}>
        <Text style={styles.label}>APPROVAL REQUEST</Text>

        <View style={styles.infoRow}>
          <Text style={styles.visitorName}>{current.visitor_name}</Text>
          <Text style={styles.detail}>Unit {current.unit_number} · {current.gate_name}</Text>
          {current.vehicle_plate && (
            <Text style={styles.detail}>Vehicle: {current.vehicle_plate}</Text>
          )}
        </View>

        <View style={styles.statusRow}>
          <MaterialCommunityIcons name={cfg.icon} size={28} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.text}</Text>
        </View>

        {/* Show notified count while pending */}
        {isPending && (
          <Text style={styles.notifiedText}>
            {current.residents_notified} resident(s) notified
          </Text>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {(isExpired || isDenied) && (
            <GradientButton title="Dismiss" variant="danger" onPress={() => {
              removeApproval(current.id);
              if (approvals.length <= 1) onDismiss();
            }} />
          )}
          {isApproved && (
            <GradientButton title="Done" variant="success" onPress={() => {
              removeApproval(current.id);
              if (approvals.length <= 1) onDismiss();
            }} />
          )}
        </View>

        {/* Queue indicator */}
        {approvals.length > 1 && (
          <Text style={styles.queueText}>+{approvals.length - 1} more pending</Text>
        )}
      </GlowCard>
    </AnimatedEntry>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  infoRow: { gap: spacing.xs },
  visitorName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  detail: { fontSize: 13, color: colors.textSecondary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  statusText: { fontSize: 16, fontWeight: '700' },
  notifiedText: { fontSize: 12, color: colors.textMuted },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  queueText: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/components/ApprovalWaiting.tsx
git commit -m "feat: guard app ApprovalWaiting component with countdown + polling"
```

---

## Task 6: Guard App — Wire Up ActionZone + WebSocket

**Files:**
- Modify: `apps/guard-app/src/components/ActionZone.tsx`
- Modify: `apps/guard-app/app/index.tsx`

- [ ] **Step 1: Update ActionZone to use approval flow**

In `apps/guard-app/src/components/ActionZone.tsx`:

Replace the import line (line 13):
```typescript
import { sendGateCommand, registerVehicleAtGate, notifyResident } from '../api/client';
```
with:
```typescript
import { sendGateCommand, registerVehicleAtGate, createApproval } from '../api/client';
```

Add import for approval store and component:
```typescript
import { useApprovalStore } from '../store/approvalStore';
import ApprovalWaiting from './ApprovalWaiting';
```

Add inside the `ActionZone` component (after line 33):
```typescript
  const addApproval = useApprovalStore((s) => s.addApproval);
  const approvals = useApprovalStore((s) => s.approvals);
  const [showApproval, setShowApproval] = useState(false);
```

Replace `handleNotifyResident` function (lines 85-103) with:
```typescript
  const handleRequestApproval = async () => {
    if (!notifyName.trim() || !notifyUnit.trim() || !gateId) return;
    setNotifyLoading(true);
    try {
      const res = await createApproval({
        visitor_name: notifyName.trim(),
        unit_number: notifyUnit.trim(),
        vehicle_plate: current?.plate !== 'Unknown' ? current?.plate : undefined,
        gate_id: gateId,
      });
      const data = res.data.data;
      addApproval({
        id: data.id,
        visitor_name: notifyName.trim(),
        unit_number: notifyUnit.trim(),
        gate_name: 'Gate',
        vehicle_plate: current?.plate !== 'Unknown' ? current?.plate || null : null,
        expires_at: data.expires_at,
        status: 'pending',
        responded_by_name: null,
        residents_notified: data.residents_notified,
      });
      setShowApproval(true);
      setShowNotify(false);
      setNotifyName('');
      setNotifyUnit('');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error?.message || 'Failed to request approval');
    } finally {
      setNotifyLoading(false);
    }
  };
```

Replace the "Notify Resident" button text (line 170) — change `title="Notify Resident"` to `title="Request Approval"` and change `onPress={() => setShowNotify(true)}` stays the same.

Replace the "NOTIFY RESIDENT" label (line 178) with `"REQUEST APPROVAL"`.

Replace the Send button's `onPress={handleNotifyResident}` (line 196) with `onPress={handleRequestApproval}`.

Add the ApprovalWaiting component rendering. After the notify form closing tag (after line 201), before the register form (before line 203), add:

```tsx
          {showApproval && approvals.length > 0 && (
            <ApprovalWaiting onDismiss={() => setShowApproval(false)} gateId={gateId} />
          )}
```

- [ ] **Step 2: Add WebSocket listener for approval responses**

In `apps/guard-app/app/index.tsx`, add import at top:

```typescript
import { useApprovalStore } from '../src/store/approvalStore';
```

Inside `AuthenticatedApp`, add:
```typescript
  const updateApproval = useApprovalStore((s) => s.updateApproval);
```

After the existing `socket.on('fastag:mismatch', ...)` handler (after line 71), add:

```typescript
    socket.on('approval:response', (data: {
      approval_id: string;
      status: string;
      responded_by_name: string | null;
      gate_opened?: boolean;
    }) => {
      updateApproval(data.approval_id, {
        status: data.status as any,
        responded_by_name: data.responded_by_name,
      });
    });
```

In the cleanup return (line 72-76 area), add:
```typescript
      socket.off('approval:response');
```

- [ ] **Step 3: Commit**

```bash
git add apps/guard-app/src/components/ActionZone.tsx apps/guard-app/app/index.tsx
git commit -m "feat: guard app approval flow — request, wait, receive response"
```

---

## Task 7: Resident App — API Client + Notification Handler

**Files:**
- Modify: `apps/resident-app/src/api/client.ts`
- Modify: `apps/resident-app/src/lib/notifications.ts`

- [ ] **Step 1: Add respondToApproval API function**

In `apps/resident-app/src/api/client.ts`, after the `sendGateCommand` function (line 89), add:

```typescript
// Approvals
export const respondToApproval = (id: string, action: 'approve' | 'deny') =>
  api.post(`/approvals/${id}/respond`, { action });
```

- [ ] **Step 2: Update notification handler for approval_request category**

In `apps/resident-app/src/lib/notifications.ts`, update the import (line 4):

```typescript
import { registerFCMToken, sendGateCommand, respondToApproval } from '../api/client';
```

Replace the notification listener body (lines 60-88) with:

```typescript
export function setupNotificationListeners(onApprovalReceived?: (approvalId: string, data: any) => void) {
  // Handle notification actions (approve/deny buttons from banner)
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    async (response) => {
      const data = response.notification.request.content.data;
      const actionId = response.actionIdentifier;

      if (data?.type === 'approval_request' && data?.approval_id) {
        if (actionId === 'approve' || actionId === 'deny') {
          // Quick action from notification banner
          try {
            await respondToApproval(data.approval_id as string, actionId);
          } catch (err) {
            console.error(`[Notifications] ${actionId} action failed:`, err);
          }
        } else {
          // Tapped notification body — navigate to approval screen
          onApprovalReceived?.(data.approval_id as string, data);
        }
        return;
      }

      // Legacy visitor_alert handling
      if (data?.type === 'visitor_alert' && data?.gate_id) {
        if (actionId === 'approve') {
          try {
            await sendGateCommand(data.gate_id as string, 'open');
          } catch (err) {
            console.error('[Notifications] Approve action failed:', err);
          }
        } else if (actionId === 'deny') {
          try {
            await sendGateCommand(data.gate_id as string, 'deny');
          } catch (err) {
            console.error('[Notifications] Deny action failed:', err);
          }
        }
      }
    }
  );

  // Handle foreground notifications — show approval screen
  const foregroundSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      const data = notification.request.content.data;
      if (data?.type === 'approval_request' && data?.approval_id) {
        onApprovalReceived?.(data.approval_id as string, data);
      }
    }
  );

  return () => {
    responseSubscription.remove();
    foregroundSubscription.remove();
  };
}
```

- [ ] **Step 3: Register notification category with approve/deny actions**

In `apps/resident-app/src/lib/notifications.ts`, add after the Android channel setup (after line 42):

```typescript
  // Register actionable notification categories
  await Notifications.setNotificationCategoryAsync('approval_request', [
    {
      identifier: 'approve',
      buttonTitle: 'Approve',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'deny',
      buttonTitle: 'Deny',
      isDestructive: true,
      options: { opensAppToForeground: false },
    },
  ]);
```

- [ ] **Step 4: Commit**

```bash
git add apps/resident-app/src/api/client.ts apps/resident-app/src/lib/notifications.ts
git commit -m "feat: resident app approval API + notification handler for approve/deny"
```

---

## Task 8: Resident App — ApprovalScreen + Navigation

**Files:**
- Create: `apps/resident-app/src/screens/ApprovalScreen.tsx`
- Modify: `apps/resident-app/app/index.tsx`

- [ ] **Step 1: Create ApprovalScreen**

Create `apps/resident-app/src/screens/ApprovalScreen.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { respondToApproval } from '../api/client';

interface Props {
  approvalId: string;
  data: {
    visitor_name?: string;
    gate_name?: string;
    unit_number?: string;
    vehicle_plate?: string;
  };
  onDismiss: () => void;
}

type ScreenState = 'loading' | 'pending' | 'approved' | 'denied' | 'expired' | 'error';

export default function ApprovalScreen({ approvalId, data, onDismiss }: Props) {
  const [state, setState] = useState<ScreenState>('pending');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleRespond = async (action: 'approve' | 'deny') => {
    setLoading(true);
    try {
      const res = await respondToApproval(approvalId, action);
      const result = res.data.data;
      setState(result.status);
      if (result.status === 'approved') {
        setMessage('Gate opened');
      } else {
        setMessage('Entry denied');
      }
      // Auto-dismiss after 3 seconds
      setTimeout(onDismiss, 3000);
    } catch (err: any) {
      const errMsg = err?.response?.data?.error?.message || 'Failed';
      if (errMsg.includes('expired')) {
        setState('expired');
        setMessage('This request has expired');
      } else if (errMsg.includes('Already')) {
        setState('approved');
        setMessage('Already handled');
      } else {
        setState('error');
        setMessage(errMsg);
      }
      setTimeout(onDismiss, 3000);
    } finally {
      setLoading(false);
    }
  };

  // Result screen
  if (state !== 'pending') {
    const isSuccess = state === 'approved';
    return (
      <View style={styles.overlay}>
        <View style={styles.resultCard}>
          <MaterialCommunityIcons
            name={isSuccess ? 'check-circle' : state === 'expired' ? 'clock-alert' : 'close-circle'}
            size={64}
            color={isSuccess ? colors.success : state === 'expired' ? colors.warning : colors.danger}
          />
          <Text style={[styles.resultText, { color: isSuccess ? colors.success : colors.danger }]}>
            {message}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>Visitor at Gate</Text>

        <View style={styles.info}>
          <Text style={styles.visitorName}>{data.visitor_name || 'Visitor'}</Text>
          <Text style={styles.detail}>{data.gate_name || 'Gate'}</Text>
          {data.unit_number && (
            <Text style={styles.detail}>Unit {data.unit_number}</Text>
          )}
          {data.vehicle_plate && (
            <Text style={styles.detail}>Vehicle: {data.vehicle_plate}</Text>
          )}
        </View>

        <View style={styles.buttons}>
          <LinearGradient
            colors={['#22c55e', '#16a34a']}
            style={styles.button}
          >
            <Text
              style={styles.buttonText}
              onPress={() => !loading && handleRespond('approve')}
            >
              {loading ? '...' : 'Approve'}
            </Text>
          </LinearGradient>

          <LinearGradient
            colors={['#ef4444', '#dc2626']}
            style={styles.button}
          >
            <Text
              style={styles.buttonText}
              onPress={() => !loading && handleRespond('deny')}
            >
              {loading ? '...' : 'Deny'}
            </Text>
          </LinearGradient>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    zIndex: 100,
  },
  card: {
    backgroundColor: colors.bgSecondary || '#1a1a2e',
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
    gap: spacing.lg,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  info: {
    gap: spacing.xs,
    alignItems: 'center',
  },
  visitorName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  detail: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  button: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  resultCard: {
    backgroundColor: colors.bgSecondary || '#1a1a2e',
    borderRadius: radius.lg,
    padding: spacing['3xl'],
    alignItems: 'center',
    gap: spacing.md,
  },
  resultText: {
    fontSize: 18,
    fontWeight: '700',
  },
});
```

- [ ] **Step 2: Wire ApprovalScreen into resident app index**

In `apps/resident-app/app/index.tsx`, add import:

```typescript
import ApprovalScreen from '../src/screens/ApprovalScreen';
```

Add state inside `ResidentApp` component (after line 58):

```typescript
  const [approvalOverlay, setApprovalOverlay] = useState<{ id: string; data: any } | null>(null);
```

Update the `setupNotificationListeners` call (lines 67-69) to pass the callback:

```typescript
  useEffect(() => {
    registerForPushNotifications();
    const cleanup = setupNotificationListeners((approvalId, data) => {
      setApprovalOverlay({ id: approvalId, data });
    });
    return cleanup;
  }, []);
```

Add the overlay rendering inside the `ResidentApp` return, after `<TabBar>` (after line 84):

```tsx
      {/* Approval overlay */}
      {approvalOverlay && (
        <ApprovalScreen
          approvalId={approvalOverlay.id}
          data={approvalOverlay.data}
          onDismiss={() => setApprovalOverlay(null)}
        />
      )}
```

- [ ] **Step 3: Commit**

```bash
git add apps/resident-app/src/screens/ApprovalScreen.tsx apps/resident-app/app/index.tsx
git commit -m "feat: resident app ApprovalScreen overlay + notification navigation"
```

---

## Task 9: End-to-End Verification

- [ ] **Step 1: Start all services**

```bash
# Terminal 1: Docker
docker compose -f docker-compose.dev.yml up -d postgres redis mosquitto

# Terminal 2: API Gateway
cd services/api-gateway
DATABASE_URL=postgresql://cguser:devpass@localhost:5432/communitygate \
JWT_SECRET=dev-secret-do-not-use-in-prod \
REDIS_URL=redis://localhost:6379 \
PORT_API_GATEWAY=3000 \
node src/index.js

# Terminal 3: Guard app
cd apps/guard-app && npx expo start --web --port 8081

# Terminal 4: Resident app
cd apps/resident-app && npx expo start --web --port 8082
```

- [ ] **Step 2: Test the full flow**

1. Log in to guard app
2. Tap "Request Approval" on a pending entry
3. Enter visitor name + unit number → tap Send
4. Verify guard app shows countdown timer
5. Check API logs for push notification attempt
6. Use curl to simulate resident response:
   ```bash
   curl -X POST http://localhost:3000/api/v1/approvals/<id>/respond \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <resident-token>" \
     -d '{"action":"approve"}'
   ```
7. Verify guard app updates to "Approved" via WebSocket

- [ ] **Step 3: Test expiry**

1. Create approval via guard app
2. Wait 60 seconds
3. Verify guard app shows "No Response" / expired state

- [ ] **Step 4: Test on real device (if available)**

1. Run resident app on phone via Expo Go
2. Create approval from guard app
3. Verify push notification appears with Approve/Deny buttons
4. Tap Approve → verify gate opens

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: remote approval — guard requests, resident approves from push notification"
```
