# WebSocket Live Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Socket.io to the API gateway to push real-time gate status, commands, and vehicle events to the Admin Portal and Guard App, replacing 10s polling.

**Architecture:** Socket.io server attaches to the existing Express HTTP server on port 3000. JWT auth on handshake, community-scoped rooms. When gate routes process commands, heartbeats, or event syncs, they call a `broadcast()` function that emits to the community room. Admin Portal and Guard App connect via `socket.io-client` and update UI state from received events.

**Tech Stack:** Socket.io 4.x (server + client), Express, JWT, Zustand, Next.js 14, Expo/React Native

---

## File Structure

### API Gateway (`services/api-gateway/`)
- **Create:** `src/websocket.js` — Socket.io server init, JWT auth middleware, broadcast function
- **Modify:** `src/index.js` — create HTTP server, pass to websocket init
- **Modify:** `src/routes/gates.js` — call broadcast after commands, heartbeats, event syncs
- **Modify:** `src/mqtt.js` — call broadcast on MQTT ack received
- **Modify:** `package.json` — add `socket.io` dependency

### Admin Portal (`apps/admin-portal/`)
- **Create:** `lib/socket.ts` — Socket.io client with admin JWT auth
- **Modify:** `app/gates/page.tsx` — replace polling with socket listeners
- **Modify:** `app/events/page.tsx` — prepend new events from socket
- **Modify:** `package.json` — add `socket.io-client` dependency

### Guard App (`apps/guard-app/`)
- **Create:** `src/api/socket.ts` — Socket.io client with guard JWT auth
- **Modify:** `app/index.tsx` — connect socket after login, listen for events in queue view
- **Modify:** `package.json` — add `socket.io-client` dependency

---

### Task 1: Install Socket.io dependencies

**Files:**
- Modify: `services/api-gateway/package.json`
- Modify: `apps/admin-portal/package.json`
- Modify: `apps/guard-app/package.json`

- [ ] **Step 1: Install socket.io in API gateway**

```bash
cd services/api-gateway && pnpm add socket.io
```

- [ ] **Step 2: Install socket.io-client in admin portal**

```bash
cd apps/admin-portal && pnpm add socket.io-client
```

- [ ] **Step 3: Install socket.io-client in guard app**

```bash
cd apps/guard-app && pnpm add socket.io-client
```

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/package.json apps/admin-portal/package.json apps/guard-app/package.json pnpm-lock.yaml
git commit -m "chore: add socket.io dependencies"
```

---

### Task 2: Create WebSocket server module

**Files:**
- Create: `services/api-gateway/src/websocket.js`

- [ ] **Step 1: Create `src/websocket.js`**

```javascript
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || '';

let io = null;

export function initWebSocket(httpServer, corsOrigins) {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
    path: '/socket.io',
  });

  // JWT auth middleware — verify token on connection handshake
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Missing auth token'));
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    const room = `community:${user.community_id}`;
    socket.join(room);
    console.log(`Socket connected: ${user.name} (${user.role}) joined ${room}`);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${user.name} (${user.role})`);
    });
  });

  console.log('WebSocket server initialized');
  return io;
}

export function broadcast(communityId, eventType, payload) {
  if (!io) return;
  io.to(`community:${communityId}`).emit(eventType, payload);
}

export function getIO() {
  return io;
}
```

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/websocket.js
git commit -m "feat: add Socket.io server module with JWT auth and community rooms"
```

---

### Task 3: Attach Socket.io to Express HTTP server

**Files:**
- Modify: `services/api-gateway/src/index.js`

- [ ] **Step 1: Update `src/index.js` to create HTTP server and init WebSocket**

Add import at top:

```javascript
import { createServer } from 'http';
import { initWebSocket } from './websocket.js';
```

Replace the `app.listen` block (lines 41-43) with:

```javascript
if (process.env.NODE_ENV !== 'test') {
  const server = createServer(app);
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:3001', 'http://localhost:3100', 'http://localhost:19006'];
  initWebSocket(server, corsOrigins);
  server.listen(PORT, () => console.log(`API Gateway listening on port ${PORT}`));
}
```

Note: The CORS origins array is already defined on lines 19-21 for Express middleware. Extract it to a constant to avoid duplication:

Before the middleware section, add:

```javascript
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:3001', 'http://localhost:3100', 'http://localhost:19006'];
```

Update the existing `cors()` middleware (line 18-23) to use `CORS_ORIGINS`:

```javascript
app.use(cors({
  origin: CORS_ORIGINS,
  credentials: true,
}));
```

And update the server block to:

```javascript
if (process.env.NODE_ENV !== 'test') {
  const server = createServer(app);
  initWebSocket(server, CORS_ORIGINS);
  server.listen(PORT, () => console.log(`API Gateway listening on port ${PORT}`));
}
```

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/index.js
git commit -m "feat: attach Socket.io to Express HTTP server"
```

---

### Task 4: Broadcast from gate routes

**Files:**
- Modify: `services/api-gateway/src/routes/gates.js`

- [ ] **Step 1: Add broadcast import**

Add at the top of `src/routes/gates.js`:

```javascript
import { broadcast } from '../websocket.js';
```

- [ ] **Step 2: Broadcast after gate command (POST /gates/:id/command)**

After the MQTT publish try/catch block (after line 143), before the `return success(...)`, add:

```javascript
    // Broadcast gate command to connected clients
    broadcast(communityId, 'gate:command', {
      gateId,
      gateName: gate.name || null,
      action: parsed.data.action,
      initiatedBy: user.name,
      role: user.role,
      plate: parsed.data.plate || null,
      residentName: parsed.data.resident_name || null,
      ts: new Date().toISOString(),
    });
```

Note: The gate query on line 110-113 currently only selects `id` and `community_id`. Update it to also select `name`:

```javascript
    const gate = await queryOne(
      'SELECT id, community_id, name FROM gates WHERE id = $1 AND community_id = $2',
      [gateId, communityId]
    );
```

- [ ] **Step 3: Broadcast after heartbeat (POST /heartbeat)**

After the `UPDATE gates` query (after line 175), before the `return success(...)`, add:

```javascript
    // Broadcast gate status to connected clients
    const gate = await queryOne(
      'SELECT name FROM gates WHERE id = $1 AND community_id = $2',
      [gate_id, community_id]
    );
    broadcast(community_id, 'gate:status', {
      gateId: gate_id,
      gateName: gate?.name || null,
      status,
      lastSeen: new Date().toISOString(),
      ts: new Date().toISOString(),
    });
```

- [ ] **Step 4: Broadcast after event sync (POST /events/sync)**

After the event insert loop (after line 226, after `inserted++`), inside the for loop, add:

```javascript
      // Broadcast each event to connected clients
      broadcast(evt.community_id, 'gate:event', {
        id: uuidv4(),
        gateId: evt.gate_id,
        detectionMethod: evt.detection_method,
        rawValue: evt.raw_value || null,
        accessDecision: evt.access_decision,
        denyReason: evt.deny_reason || null,
        matchedUnitNumber: evt.matched_unit_number || null,
        residentName: evt.resident_name || null,
        anprConfidence: evt.anpr_confidence ?? null,
        eventTs: evt.event_ts,
      });
```

- [ ] **Step 5: Commit**

```bash
git add services/api-gateway/src/routes/gates.js
git commit -m "feat: broadcast gate commands, status, and events via Socket.io"
```

---

### Task 5: Broadcast from MQTT ack handler

**Files:**
- Modify: `services/api-gateway/src/mqtt.js`

- [ ] **Step 1: Add broadcast import and MQTT ack subscription**

Add import at top:

```javascript
import { broadcast } from './websocket.js';
```

In the `getMqttClient()` function, after the `client.on('reconnect', ...)` handler (after line 17), add MQTT ack subscription:

```javascript
  client.on('connect', () => {
    // Subscribe to ack topics for all communities (wildcard)
    client.subscribe('cg/+/gates/+/ack', { qos: 1 }, (err) => {
      if (err) console.error('MQTT subscribe to ack topics failed:', err);
      else console.log('MQTT subscribed to gate ack topics');
    });
  });

  client.on('message', (topic, message) => {
    // Parse ack topic: cg/{communityId}/gates/{gateId}/ack
    const parts = topic.split('/');
    if (parts.length === 5 && parts[4] === 'ack') {
      const communityId = parts[1];
      const gateId = parts[3];
      try {
        const ack = JSON.parse(message.toString());
        broadcast(communityId, 'gate:status', {
          gateId,
          gateName: ack.gate_name || null,
          status: ack.status || 'online',
          lastSeen: new Date().toISOString(),
          ts: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Failed to parse MQTT ack:', err);
      }
    }
  });
```

Note: The existing `client.on('connect', ...)` on line 15 should be replaced/merged. Combine the console.log with the subscribe:

Replace line 15:

```javascript
  client.on('connect', () => console.log(`MQTT connected to ${BROKER_URL}`));
```

with:

```javascript
  client.on('connect', () => {
    console.log(`MQTT connected to ${BROKER_URL}`);
    client.subscribe('cg/+/gates/+/ack', { qos: 1 }, (err) => {
      if (err) console.error('MQTT subscribe to ack topics failed:', err);
      else console.log('MQTT subscribed to gate ack topics');
    });
  });
```

And add the `message` handler after:

```javascript
  client.on('message', (topic, message) => {
    const parts = topic.split('/');
    if (parts.length === 5 && parts[4] === 'ack') {
      const communityId = parts[1];
      const gateId = parts[3];
      try {
        const ack = JSON.parse(message.toString());
        broadcast(communityId, 'gate:status', {
          gateId,
          gateName: ack.gate_name || null,
          status: ack.status || 'online',
          lastSeen: new Date().toISOString(),
          ts: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Failed to parse MQTT ack:', err);
      }
    }
  });
```

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/mqtt.js
git commit -m "feat: broadcast MQTT ack events to Socket.io clients"
```

---

### Task 6: Admin Portal — Socket.io client module

**Files:**
- Create: `apps/admin-portal/lib/socket.ts`

- [ ] **Step 1: Create `lib/socket.ts`**

```typescript
import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
// Strip /api/v1 suffix if present — Socket.io connects to the root
const SOCKET_URL = API_BASE.replace(/\/api\/v1\/?$/, '');
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || process.env.ADMIN_JWT_TOKEN || '';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    auth: { token: ADMIN_TOKEN },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    console.log('Socket.io connected');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket.io connection error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/lib/socket.ts
git commit -m "feat(admin): add Socket.io client module"
```

---

### Task 7: Admin Portal — Live gate status updates

**Files:**
- Modify: `apps/admin-portal/app/gates/page.tsx`

- [ ] **Step 1: Replace polling with Socket.io listeners**

Replace the full contents of `apps/admin-portal/app/gates/page.tsx` with:

```typescript
'use client';

import { useState, useEffect } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch, apiPost } from '@/lib/api';
import { getSocket } from '@/lib/socket';

interface Gate {
  id: string;
  name: string;
  status: string;
  last_seen: string;
  direction: string;
}

interface GateStatusEvent {
  gateId: string;
  gateName: string;
  status: string;
  lastSeen: string;
  ts: string;
}

interface GateCommandEvent {
  gateId: string;
  gateName: string;
  action: string;
  initiatedBy: string;
  role: string;
  plate: string | null;
  residentName: string | null;
  ts: string;
}

export default function GatesPage() {
  const [gates, setGates] = useState<Gate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<Record<string, string>>({});

  const fetchGates = async () => {
    try {
      const res = await apiFetch<{ data: { gates: Gate[] } }>('/gates');
      setGates(res.data?.gates || []);
    } catch {
      setGates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGates();

    const socket = getSocket();

    const handleStatus = (data: GateStatusEvent) => {
      setGates((prev) =>
        prev.map((g) =>
          g.id === data.gateId
            ? { ...g, status: data.status, last_seen: data.lastSeen }
            : g
        )
      );
    };

    const handleCommand = (data: GateCommandEvent) => {
      setLastAction((prev) => ({
        ...prev,
        [data.gateId]: `${data.action} by ${data.initiatedBy}`,
      }));
    };

    socket.on('gate:status', handleStatus);
    socket.on('gate:command', handleCommand);

    // Full refresh on reconnect (may have missed events)
    socket.on('connect', fetchGates);

    return () => {
      socket.off('gate:status', handleStatus);
      socket.off('gate:command', handleCommand);
      socket.off('connect', fetchGates);
    };
  }, []);

  const handleGateAction = async (gateId: string, action: 'open' | 'close') => {
    setActionLoading(gateId);
    setLastAction((prev) => ({ ...prev, [gateId]: action }));
    try {
      await apiPost(`/gates/${gateId}/command`, { action });
    } catch (err) {
      console.error(`Failed to ${action} gate:`, err);
      setLastAction((prev) => {
        const n = { ...prev };
        delete n[gateId];
        return n;
      });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Gates</h1>
        <div className="text-center text-gray-400 py-12">Loading gates...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Gates</h1>
        <button
          onClick={fetchGates}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      {gates.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
          No gates configured
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gates.map((gate) => (
            <div key={gate.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{gate.name}</h3>
                  <p className="text-sm text-gray-500 capitalize">{gate.direction}</p>
                </div>
                <StatusBadge status={gate.status} variant="dot" />
              </div>

              <div className="text-xs text-gray-400 mb-4">
                Last seen: {gate.last_seen ? new Date(gate.last_seen).toLocaleString() : 'Never'}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleGateAction(gate.id, 'open')}
                  disabled={actionLoading === gate.id}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {actionLoading === gate.id ? 'Sending...' : 'Open'}
                </button>
                <button
                  onClick={() => handleGateAction(gate.id, 'close')}
                  disabled={actionLoading === gate.id}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {actionLoading === gate.id ? 'Sending...' : 'Close'}
                </button>
              </div>
              {lastAction[gate.id] && !actionLoading && (
                <p className="text-xs text-green-600 mt-2 text-center">
                  {lastAction[gate.id]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/app/gates/page.tsx
git commit -m "feat(admin): replace gate polling with Socket.io live updates"
```

---

### Task 8: Admin Portal — Live events on events page

**Files:**
- Modify: `apps/admin-portal/app/events/page.tsx`

- [ ] **Step 1: Add Socket.io listener to prepend new events**

Add import at top of `apps/admin-portal/app/events/page.tsx`:

```typescript
import { getSocket } from '@/lib/socket';
```

Add a `GateEventSocket` interface after the existing `Filters` interface:

```typescript
interface GateEventSocket {
  id: string;
  gateId: string;
  detectionMethod: string;
  rawValue: string;
  accessDecision: string;
  denyReason: string | null;
  matchedUnitNumber: string | null;
  residentName: string | null;
  anprConfidence: number | null;
  eventTs: string;
}
```

Add a new `useEffect` after the existing filter useEffect (after line 71):

```typescript
  // Live event updates via Socket.io
  useEffect(() => {
    const socket = getSocket();

    const handleEvent = (data: GateEventSocket) => {
      const newEvent: EventEntry = {
        id: data.id,
        timestamp: data.eventTs,
        gate_name: '',  // gate name not in socket payload, will show on next full fetch
        method: data.detectionMethod,
        plate: data.rawValue || '',
        decision: data.accessDecision,
        unit_number: data.matchedUnitNumber || '',
        resident_name: data.residentName || '',
      };
      setEvents((prev) => [newEvent, ...prev]);
    };

    socket.on('gate:event', handleEvent);
    return () => { socket.off('gate:event', handleEvent); };
  }, []);
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/app/events/page.tsx
git commit -m "feat(admin): prepend live events from Socket.io on events page"
```

---

### Task 9: Guard App — Socket.io client module

**Files:**
- Create: `apps/guard-app/src/api/socket.ts`

- [ ] **Step 1: Create `src/api/socket.ts`**

```typescript
import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v1';
const SOCKET_URL = API_BASE.replace(/\/api\/v1\/?$/, '');

let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket;

  // Disconnect existing before reconnecting
  if (socket) {
    socket.disconnect();
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    console.log('Guard socket connected');
  });

  socket.on('connect_error', (err: Error) => {
    console.error('Guard socket error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/api/socket.ts
git commit -m "feat(guard-app): add Socket.io client module"
```

---

### Task 10: Guard App — Connect socket on login, listen for events

**Files:**
- Modify: `apps/guard-app/src/store/authStore.ts`
- Modify: `apps/guard-app/app/index.tsx`

- [ ] **Step 1: Connect/disconnect socket in auth store**

In `apps/guard-app/src/store/authStore.ts`, add import:

```typescript
import { connectSocket, disconnectSocket } from '../api/socket';
```

In the `login` action, after `setAuthToken(token)`, add:

```typescript
    connectSocket(token);
```

In the `logout` action, after `clearAuthToken()`, add:

```typescript
    disconnectSocket();
```

In the `rehydrate` action, after the `setAuthToken(token)` call (inside the valid token branch), add:

```typescript
          connectSocket(token);
```

- [ ] **Step 2: Listen for gate:event in QueueView**

In `apps/guard-app/app/index.tsx`, add import at top:

```typescript
import { getSocket } from '../src/api/socket';
```

In the `QueueView` component, after the existing state declarations (after line 84 in the current file), add a `useEffect` for socket events:

```typescript
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleEvent = (data: {
      id: string;
      gateId: string;
      detectionMethod: string;
      rawValue: string;
      accessDecision: string;
      denyReason?: string;
      matchedUnitNumber?: string;
      residentName?: string;
      anprConfidence?: number;
      eventTs: string;
    }) => {
      const entry: QueueEntry = {
        id: data.id,
        plate: data.rawValue || 'Unknown',
        method: data.detectionMethod as QueueEntry['method'],
        decision: data.accessDecision as QueueEntry['decision'],
        reason: data.denyReason || undefined,
        timestamp: data.eventTs,
      };
      addEntry(entry);
    };

    socket.on('gate:event', handleEvent);
    return () => { socket.off('gate:event', handleEvent); };
  }, [addEntry]);
```

Also add `addEntry` from the queue store to the existing destructuring. The QueueView currently reads entries and logout. Add addEntry:

```typescript
  const addEntry = useQueueStore((s) => s.addEntry);
```

- [ ] **Step 3: Commit**

```bash
git add apps/guard-app/src/store/authStore.ts apps/guard-app/app/index.tsx
git commit -m "feat(guard-app): connect socket on login, live queue updates from events"
```

---

### Task 11: Manual smoke test

- [ ] **Step 1: Start Docker services and API gateway**

```bash
docker compose -f docker-compose.dev.yml up -d
cd services/api-gateway && pnpm dev
```

Verify in logs: `API Gateway listening on port 3000` and `WebSocket server initialized`.

- [ ] **Step 2: Test Socket.io connection from admin portal**

```bash
cd apps/admin-portal && pnpm dev
```

Open http://localhost:3100/gates. Check browser console for `Socket.io connected`. Check API gateway logs for `Socket connected: ... joined community:...`.

- [ ] **Step 3: Test live gate command broadcast**

On the gates page, click Open on a gate. Verify:
- Command is sent (existing behavior)
- `lastAction` updates immediately from Socket.io `gate:command` event (not just from local state)

- [ ] **Step 4: Test Guard App socket connection**

```bash
cd apps/guard-app && npx expo start --web --port 8081
```

Login with `guard1`/`guard123`. Check console for `Guard socket connected`. Check API gateway logs for the guard joining the community room.

- [ ] **Step 5: Test event sync broadcast**

Simulate an event sync by sending a POST to `/events/sync` with a device token:

```bash
curl -X POST http://localhost:3000/api/v1/events/sync \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: <device-jwt-token>" \
  -d '{"events": [{"community_id":"<id>","gate_id":"<id>","detection_method":"anpr","raw_value":"KA05MF1234","access_decision":"allow","event_ts":"2026-04-01T10:00:00Z"}]}'
```

Verify:
- Admin portal events page shows new event prepended
- Admin portal gates page updates if status changed
- Guard app queue shows the new event
