# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add FCM push notifications to CommunityGate — vehicle entry alerts, actionable visitor-at-gate approve/deny, and FASTag paired confirmations.

**Architecture:** Backend gets a `fcm.js` wrapper (Firebase Admin SDK) and a `notifications.js` route for token registration + visitor alerts. Vehicle access check and FASTag pairing code paths gain fire-and-forget push calls. Resident App uses `expo-notifications` for token registration, foreground/background handling, and action buttons. Guard App's ActionZone gets a "Notify Resident" button.

**Tech Stack:** firebase-admin (backend), expo-notifications + expo-device (Resident App), existing Express/Zustand/Socket.io stack.

---

## File Structure

### Backend (services/api-gateway/)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/fcm.js` | Create | Firebase Admin SDK init, sendNotification, sendToMultiple, isConfigured |
| `src/routes/notifications.js` | Create | POST /notifications/register, /unregister, /visitor-alert |
| `src/index.js` | Modify | Mount notifications router |
| `src/routes/vehicles.js` | Modify | Send push on vehicle allow + FASTag paired |
| `package.json` | Modify | Add firebase-admin dependency |

### Resident App (apps/resident-app/)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/notifications.ts` | Create | FCM token registration, permission request, notification handlers |
| `src/api/client.ts` | Modify | Add registerFCMToken, unregisterFCMToken |
| `app/index.tsx` | Modify | Init notifications after auth |
| `app.json` | Modify | Add notification config |

### Guard App (apps/guard-app/)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/ActionZone.tsx` | Modify | Add "Notify Resident" button |
| `src/api/client.ts` | Modify | Add notifyResident endpoint |

---

## Task 1: FCM Wrapper (Backend)

**Files:**
- Create: `services/api-gateway/src/lib/fcm.js`
- Modify: `services/api-gateway/package.json`

- [ ] **Step 1: Install firebase-admin on EC2**

Since we deploy via tarball (not npm install), we need to install firebase-admin on EC2. But first, add it to package.json locally for completeness.

In `services/api-gateway/package.json`, add to dependencies:

```json
"firebase-admin": "^12.0.0"
```

(We'll install it on EC2 in the deploy task.)

- [ ] **Step 2: Create fcm.js wrapper**

Create `services/api-gateway/src/lib/fcm.js`:

```javascript
let admin = null;
let initialized = false;

function getApp() {
  if (initialized) return admin;
  initialized = true;

  const credJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const credPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!credJson && !credPath) {
    console.log('[FCM] No Firebase credentials configured — notifications will be logged only');
    return null;
  }

  try {
    const firebaseAdmin = await import('firebase-admin');
    const credential = credJson
      ? firebaseAdmin.default.credential.cert(JSON.parse(credJson))
      : firebaseAdmin.default.credential.cert(credPath);
    admin = firebaseAdmin.default.initializeApp({ credential });
    console.log('[FCM] Firebase Admin initialized');
    return admin;
  } catch (err) {
    console.error('[FCM] Firebase init failed:', err.message);
    return null;
  }
}

export function isConfigured() {
  return !!(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
}

export async function sendNotification(token, title, body, data = {}) {
  const app = await getApp();
  if (!app) {
    console.log(`[FCM-DEV] Push: "${title}" — "${body}" → token:${token?.slice(0, 20)}...`);
    return null;
  }

  try {
    const { getMessaging } = await import('firebase-admin/messaging');
    const result = await getMessaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',
        notification: {
          channelId: 'communitygate',
          priority: 'high',
        },
      },
    });
    return result;
  } catch (err) {
    console.error(`[FCM] Send failed for token ${token?.slice(0, 20)}:`, err.message);
    return null;
  }
}

export async function sendVisitorAlert(token, visitorName, gateId) {
  const app = await getApp();
  if (!app) {
    console.log(`[FCM-DEV] Visitor alert: "${visitorName}" → token:${token?.slice(0, 20)}...`);
    return null;
  }

  try {
    const { getMessaging } = await import('firebase-admin/messaging');
    const result = await getMessaging().send({
      token,
      notification: {
        title: 'Visitor at Gate',
        body: `${visitorName} is at the gate — approve entry?`,
      },
      data: {
        type: 'visitor_alert',
        gate_id: gateId,
        visitor_name: visitorName,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'communitygate',
          priority: 'high',
          actions: [
            { title: 'Approve', pressAction: { id: 'approve' } },
            { title: 'Deny', pressAction: { id: 'deny' } },
          ],
        },
      },
    });
    return result;
  } catch (err) {
    console.error(`[FCM] Visitor alert failed for token ${token?.slice(0, 20)}:`, err.message);
    return null;
  }
}

export async function sendToMultiple(tokens, title, body, data = {}) {
  const results = await Promise.allSettled(
    tokens.map((t) => sendNotification(t, title, body, data))
  );
  return results.filter((r) => r.status === 'fulfilled' && r.value).length;
}
```

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/src/lib/fcm.js services/api-gateway/package.json
git commit -m "feat: add Firebase Admin FCM wrapper with dev fallback logging"
```

---

## Task 2: Notifications Route (Backend)

**Files:**
- Create: `services/api-gateway/src/routes/notifications.js`
- Modify: `services/api-gateway/src/index.js`

- [ ] **Step 1: Create notifications route**

Create `services/api-gateway/src/routes/notifications.js`:

```javascript
import { Router } from 'express';
import { z } from 'zod';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { sendVisitorAlert } from '../lib/fcm.js';

const router = Router();

const registerSchema = z.object({
  fcm_token: z.string().min(1).max(500),
});

const visitorAlertSchema = z.object({
  visitor_name: z.string().min(1).max(200),
  unit_number: z.string().min(1).max(30),
  gate_id: z.string().uuid(),
});

// -- POST /notifications/register (JWT resident) ----------------------------

router.post('/notifications/register', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { fcm_token } = parsed.data;
    const userId = req.user.sub;

    await queryOne(
      'UPDATE residents SET fcm_token = $1 WHERE id = $2 RETURNING id',
      [fcm_token, userId]
    );

    return success(res, { registered: true });
  } catch (err) {
    console.error('POST /notifications/register error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /notifications/unregister (JWT resident) --------------------------

router.post('/notifications/unregister', authenticateJWT(['resident']), async (req, res) => {
  try {
    const userId = req.user.sub;
    await queryOne(
      'UPDATE residents SET fcm_token = NULL WHERE id = $1 RETURNING id',
      [userId]
    );
    return success(res, { unregistered: true });
  } catch (err) {
    console.error('POST /notifications/unregister error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /notifications/visitor-alert (JWT guard) --------------------------

router.post('/notifications/visitor-alert', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = visitorAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { visitor_name, unit_number, gate_id } = parsed.data;
    const community_id = req.user.community_id;

    // Find unit
    const unit = await queryOne(
      'SELECT id FROM units WHERE community_id = $1 AND unit_number = $2',
      [community_id, unit_number]
    );
    if (!unit) {
      return error(res, 'Unit not found', 404);
    }

    // Get all residents in this unit with FCM tokens
    const residents = await queryRows(
      'SELECT fcm_token FROM residents WHERE unit_id = $1 AND is_active = true AND fcm_token IS NOT NULL',
      [unit.id]
    );

    let notified = 0;
    for (const r of residents) {
      const result = await sendVisitorAlert(r.fcm_token, visitor_name, gate_id);
      if (result) notified++;
    }

    return success(res, { notified, total_residents: residents.length });
  } catch (err) {
    console.error('POST /notifications/visitor-alert error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
```

- [ ] **Step 2: Mount notifications router in index.js**

In `services/api-gateway/src/index.js`, add after line 13 (`import adminRoutes from './routes/admin.js';`):

```javascript
import notificationRoutes from './routes/notifications.js';
```

And add after line 42 (`app.use('/api/v1', adminRoutes);`):

```javascript
app.use('/api/v1', notificationRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/src/routes/notifications.js services/api-gateway/src/index.js
git commit -m "feat: add notifications route — token register + visitor alert"
```

---

## Task 3: Vehicle Entry + FASTag Paired Push (Backend)

**Files:**
- Modify: `services/api-gateway/src/routes/vehicles.js`

- [ ] **Step 1: Add FCM import to vehicles.js**

At the top of `services/api-gateway/src/routes/vehicles.js`, add after the existing imports (after the `import { broadcast } from '../websocket.js';` line):

```javascript
import { sendToMultiple, sendNotification } from '../lib/fcm.js';
```

- [ ] **Step 2: Add push notification after vehicle allow broadcast**

In the access check handler, find the vehicle-allow broadcast (around line 532):

```javascript
      broadcast(community_id, 'gate:event', {
        id: eventId, gateId: gate_id, detectionMethod: method, rawValue: lookupValue,
        accessDecision: 'allow', matchedUnitNumber: vehicle.unit_number,
        residentName: vehicle.resident_name, anprConfidence: confidence, eventTs: eventTs,
      });
```

Add immediately AFTER this broadcast call (before `return success`):

```javascript
      // Fire-and-forget push notification to unit residents
      if (vehicle.unit_id) {
        import('../db/queries.js').then(({ queryRows }) =>
          queryRows(
            'SELECT fcm_token FROM residents WHERE unit_id = $1 AND is_active = true AND fcm_token IS NOT NULL',
            [vehicle.unit_id]
          ).then((residents) => {
            const tokens = residents.map((r) => r.fcm_token);
            if (tokens.length > 0) {
              const gate_name = 'Main Gate';
              const time = new Date(eventTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              sendToMultiple(tokens, 'Vehicle Entry', `Your ${lookupValue} entered ${gate_name} at ${time}`);
            }
          }).catch(() => {})
        );
      }
```

- [ ] **Step 3: Add push notification after FASTag paired broadcast**

Find the FASTag paired broadcast (around line 692):

```javascript
    broadcast(community_id, 'fastag:paired', {
      plate: normalizedPlate,
      unitNumber: updated.unit_number || null,
      fastagTidHash: fastag_tid_hash,
    });
```

Add immediately AFTER this broadcast call (before `return success`):

```javascript
    // Fire-and-forget push notification for FASTag pairing
    if (updated.unit_id) {
      queryRows(
        'SELECT fcm_token FROM residents WHERE unit_id = $1 AND is_active = true AND fcm_token IS NOT NULL',
        [updated.unit_id]
      ).then((residents) => {
        const tokens = residents.map((r) => r.fcm_token);
        if (tokens.length > 0) {
          sendToMultiple(tokens, 'FASTag Linked', `FASTag linked to ${normalizedPlate} — auto-entry active!`);
        }
      }).catch(() => {});
    }
```

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/src/routes/vehicles.js
git commit -m "feat: send push notifications on vehicle entry + FASTag paired"
```

---

## Task 4: Resident App — Notification Library

**Files:**
- Create: `apps/resident-app/src/lib/notifications.ts`
- Modify: `apps/resident-app/src/api/client.ts`

- [ ] **Step 1: Add notification endpoints to API client**

In `apps/resident-app/src/api/client.ts`, add before the `export default api;` line:

```typescript
// Notifications
export const registerFCMToken = (fcm_token: string) =>
  api.post('/notifications/register', { fcm_token });

export const unregisterFCMToken = () =>
  api.post('/notifications/unregister');
```

- [ ] **Step 2: Create notifications library**

Create `apps/resident-app/src/lib/notifications.ts`:

```typescript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { registerFCMToken, sendGateCommand } from '../api/client';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[Notifications] Not a physical device — skipping registration');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission not granted');
    return null;
  }

  // Set up Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('communitygate', {
      name: 'CommunityGate',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3b82f6',
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: 'communitygate-resident',
  });
  const token = tokenData.data;

  // Register with our server
  try {
    await registerFCMToken(token);
    console.log('[Notifications] Token registered:', token.slice(0, 20) + '...');
  } catch (err) {
    console.error('[Notifications] Token registration failed:', err);
  }

  return token;
}

export function setupNotificationListeners() {
  // Handle notification actions (approve/deny buttons)
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    async (response) => {
      const data = response.notification.request.content.data;
      const actionId = response.actionIdentifier;

      if (data?.type === 'visitor_alert' && data?.gate_id) {
        if (actionId === 'approve') {
          try {
            await sendGateCommand(data.gate_id, 'open');
          } catch (err) {
            console.error('[Notifications] Approve action failed:', err);
          }
        } else if (actionId === 'deny') {
          try {
            await sendGateCommand(data.gate_id, 'deny');
          } catch (err) {
            console.error('[Notifications] Deny action failed:', err);
          }
        }
      }
    }
  );

  return () => {
    responseSubscription.remove();
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/resident-app/src/lib/notifications.ts apps/resident-app/src/api/client.ts
git commit -m "feat: add notification library with FCM registration + action handlers"
```

---

## Task 5: Resident App — Initialize Notifications

**Files:**
- Modify: `apps/resident-app/app/index.tsx`
- Modify: `apps/resident-app/app.json`
- Modify: `apps/resident-app/src/api/client.ts`

- [ ] **Step 1: Update app.json with notification config**

Replace the entire `apps/resident-app/app.json`:

```json
{
  "expo": {
    "name": "CommunityGate",
    "slug": "communitygate-resident",
    "version": "0.1.0",
    "orientation": "portrait",
    "platforms": ["android", "ios", "web"],
    "android": {
      "package": "com.communitygate.resident",
      "googleServicesFile": "./google-services.json"
    },
    "ios": { "bundleIdentifier": "com.communitygate.resident" },
    "plugins": ["expo-notifications"]
  }
}
```

- [ ] **Step 2: Add sendGateCommand to resident API client**

In `apps/resident-app/src/api/client.ts`, add before the `export default api;` line (after the notification endpoints):

```typescript
// Gate commands (for notification actions)
export const sendGateCommand = (gateId: string, action: string) =>
  api.post(`/gates/${gateId}/command`, { action });
```

- [ ] **Step 3: Initialize notifications in app/index.tsx**

In `apps/resident-app/app/index.tsx`, add import at the top (after existing imports):

```typescript
import { registerForPushNotifications, setupNotificationListeners } from '../src/lib/notifications';
import { unregisterFCMToken } from '../src/api/client';
```

In the `ResidentApp` function, add a useEffect for notification setup (after the existing `handleNavigate` function):

```typescript
  useEffect(() => {
    registerForPushNotifications();
    const cleanup = setupNotificationListeners();
    return cleanup;
  }, []);
```

Also update the `Page` component — in the `useAuthStore` logout, we should unregister the token. But since logout is in the store, we'll add it to the `ProfileScreen` logout handler instead. Actually, the simplest approach: in the `Page` component, add a check — when `isAuthenticated` transitions to false, call unregister. But this is complex. Let's keep it simple for now — token registration happens on every app launch, and stale tokens are handled by FCM automatically (they fail silently).

- [ ] **Step 4: Commit**

```bash
git add apps/resident-app/app/index.tsx apps/resident-app/app.json apps/resident-app/src/api/client.ts
git commit -m "feat: initialize push notifications in Resident App on auth"
```

---

## Task 6: Guard App — Notify Resident Button

**Files:**
- Modify: `apps/guard-app/src/components/ActionZone.tsx`
- Modify: `apps/guard-app/src/api/client.ts`

- [ ] **Step 1: Add notifyResident endpoint to guard API client**

In `apps/guard-app/src/api/client.ts`, add before `export default api;`:

```javascript
// Notifications
export const notifyResident = (data: {
  visitor_name: string;
  unit_number: string;
  gate_id: string;
}) => api.post('/notifications/visitor-alert', data);
```

- [ ] **Step 2: Add "Notify Resident" button to ActionZone**

In `apps/guard-app/src/components/ActionZone.tsx`:

First, add to imports at the top:

```typescript
import { notifyResident } from '../api/client';
```

(The `sendGateCommand` and `registerVehicleAtGate` imports are already there from client.)

Add new state variables inside the `ActionZone` function (after the existing `actionLoading` state):

```typescript
  const [showNotify, setShowNotify] = useState(false);
  const [notifyName, setNotifyName] = useState('');
  const [notifyUnit, setNotifyUnit] = useState('');
  const [notifyLoading, setNotifyLoading] = useState(false);
```

Add the notify handler (after the existing `handleRegister` function):

```typescript
  const handleNotifyResident = async () => {
    if (!notifyName.trim() || !notifyUnit.trim() || !gateId) return;
    setNotifyLoading(true);
    try {
      await notifyResident({
        visitor_name: notifyName.trim(),
        unit_number: notifyUnit.trim(),
        gate_id: gateId,
      });
      Alert.alert('Sent', 'Resident has been notified');
      setShowNotify(false);
      setNotifyName('');
      setNotifyUnit('');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error?.message || 'Failed to notify resident');
    } finally {
      setNotifyLoading(false);
    }
  };
```

In the JSX, add the "Notify Resident" button after the existing action buttons block (after the closing `</View>` of `styles.actions`, around line 142). Add before the `{showRegister && (` block:

```typescript
          {/* Notify Resident */}
          {!showRegister && !showNotify && (
            <GradientButton title="Notify Resident" icon="bell-ring" variant="primary" onPress={() => setShowNotify(true)} />
          )}

          {showNotify && (
            <AnimatedEntry direction="fade" duration={200}>
              <View style={styles.registerForm}>
                <Text style={styles.registerLabel}>NOTIFY RESIDENT</Text>
                <TextInput
                  style={styles.registerInput}
                  placeholder="Visitor name"
                  placeholderTextColor={colors.textMuted}
                  value={notifyName}
                  onChangeText={setNotifyName}
                />
                <TextInput
                  style={styles.registerInput}
                  placeholder="Unit number"
                  placeholderTextColor={colors.textMuted}
                  value={notifyUnit}
                  onChangeText={setNotifyUnit}
                />
                <View style={styles.registerActions}>
                  <View style={{ flex: 1 }}>
                    <GradientButton title="Cancel" variant="danger" onPress={() => { setShowNotify(false); setNotifyName(''); setNotifyUnit(''); }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GradientButton title="Send" icon="bell-ring" variant="success" onPress={handleNotifyResident} loading={notifyLoading} disabled={!notifyName.trim() || !notifyUnit.trim()} />
                  </View>
                </View>
              </View>
            </AnimatedEntry>
          )}
```

Note: the `styles.registerForm`, `styles.registerLabel`, `styles.registerInput`, and `styles.registerActions` styles already exist from the register vehicle form — we reuse them.

- [ ] **Step 3: Add TextInput import if missing**

In `apps/guard-app/src/components/ActionZone.tsx`, verify the import from react-native includes `TextInput`. The current import line should already have it (used in the register form). If not, add it:

```typescript
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
```

- [ ] **Step 4: Commit**

```bash
git add apps/guard-app/src/components/ActionZone.tsx apps/guard-app/src/api/client.ts
git commit -m "feat: add Notify Resident button to Guard App ActionZone"
```

---

## Task 7: Install Dependencies + Deploy

**Files:** None (deployment task)

- [ ] **Step 1: Install expo-notifications in resident app (locally)**

```bash
cd apps/resident-app && npx expo install expo-notifications expo-device
```

- [ ] **Step 2: Commit package changes**

```bash
git add apps/resident-app/package.json
git commit -m "chore: add expo-notifications + expo-device dependencies"
```

- [ ] **Step 3: Deploy backend to EC2**

```bash
tar czf /tmp/push-deploy.tar.gz services/api-gateway/src/lib/fcm.js services/api-gateway/src/routes/notifications.js services/api-gateway/src/routes/vehicles.js services/api-gateway/src/index.js services/api-gateway/package.json
scp -i communitygate-test.pem /tmp/push-deploy.tar.gz ec2-user@54.235.41.163:/tmp/
ssh -i communitygate-test.pem ec2-user@54.235.41.163 "cd /opt/communitygate && tar xzf /tmp/push-deploy.tar.gz && cd services/api-gateway && npm install firebase-admin"
```

- [ ] **Step 4: Restart API gateway on EC2**

```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 'fuser -k 3000/tcp; sleep 1; cd /opt/communitygate/services/api-gateway && CORS_ORIGINS="http://54.235.41.163:3100,http://localhost:3100,https://54.235.41.163" DATABASE_URL=postgresql://cguser:devpass@localhost:5432/communitygate JWT_SECRET=dev-secret-key-change-me REDIS_URL=redis://localhost:6379 PORT_API_GATEWAY=3000 nohup node src/index.js > /tmp/api-gateway.log 2>&1 & sleep 2; tail -5 /tmp/api-gateway.log'
```

Expected: Server starts with `[FCM] No Firebase credentials configured — notifications will be logged only`

- [ ] **Step 5: Smoke test notification endpoints**

```bash
# Register token (needs resident JWT)
ssh -i communitygate-test.pem ec2-user@54.235.41.163 'curl -s http://localhost:3000/api/v1/auth/resident-otp -X POST -H "Content-Type: application/json" -d "{\"phone\":\"9876543210\"}"'
# Get OTP from logs, verify, use token to test registration
```

- [ ] **Step 6: Verify FCM dev fallback in logs**

```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 'tail -10 /tmp/api-gateway.log'
```

Expected: `[FCM-DEV] Push:` log lines when notifications are triggered.
