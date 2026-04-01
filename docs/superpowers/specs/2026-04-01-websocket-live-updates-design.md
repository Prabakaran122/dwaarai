# WebSocket Live Gate Status Updates

Real-time push updates for gate status, vehicle access events, and gate commands to the Admin Portal and Guard App using Socket.io.

## Context

The admin portal currently polls every 10 seconds for gate status and events. The guard app has no real-time updates. MQTT handles edge-to-API communication but is not exposed to frontend clients. This adds a Socket.io layer that bridges MQTT/REST events to connected browser and mobile clients.

## Clients

- **Admin Portal** (Next.js) — gate status, events, commands
- **Guard App** (Expo/React Native) — gate events (especially guard_review), commands

Resident App is excluded — pull-to-refresh is sufficient for now.

## Server-Side Architecture

### Socket.io Server

Attach Socket.io to the existing Express HTTP server on port 3000. No separate service.

**Authentication:** JWT verification on connection handshake. Client sends token in `auth.token` field. Server verifies with same `JWT_SECRET` used for REST endpoints. Reject connection if token is invalid or expired.

**Rooms:** On successful auth, join client to `community:{community_id}` room (community_id extracted from JWT payload). All broadcasts are scoped to this room.

### New File: `src/websocket.js`

Single module that:
- Initializes Socket.io server with CORS matching existing Express CORS config
- Handles `connection` event with JWT auth middleware
- Exports `broadcast(communityId, eventType, payload)` function that emits to the appropriate room

### Integration Points (existing code modifications)

**`src/routes/gates.js`:**
- After `POST /gates/:id/command` publishes to MQTT, call `broadcast(community_id, 'gate:command', payload)`
- After `POST /heartbeat` updates gate status, call `broadcast(community_id, 'gate:status', payload)`
- After `POST /events/sync` inserts events, call `broadcast(community_id, 'gate:event', payload)` for each event

**`src/mqtt.js`:**
- When MQTT ack received from edge device, call `broadcast(community_id, 'gate:status', payload)`

**`src/index.js`:**
- Create HTTP server from Express app (needed for Socket.io attachment)
- Initialize websocket module with the HTTP server

## Event Payloads

### `gate:status`
```json
{
  "gateId": "uuid",
  "gateName": "string",
  "status": "online|offline|degraded",
  "lastSeen": "ISO8601",
  "ts": "ISO8601"
}
```

### `gate:command`
```json
{
  "gateId": "uuid",
  "gateName": "string",
  "action": "open|close",
  "initiatedBy": "string",
  "role": "admin|guard",
  "plate": "string|null",
  "residentName": "string|null",
  "ts": "ISO8601"
}
```

### `gate:event`
```json
{
  "id": "uuid",
  "gateId": "uuid",
  "detectionMethod": "anpr|rfid|manual",
  "rawValue": "string",
  "accessDecision": "allow|deny|guard_review",
  "denyReason": "string|null",
  "matchedUnitNumber": "string|null",
  "residentName": "string|null",
  "anprConfidence": "number|null",
  "eventTs": "ISO8601"
}
```

## Client-Side Integration

### Admin Portal

**New file: `lib/socket.ts`** — Socket.io client module. Connects to API gateway with admin JWT token in `auth.token` handshake field.

**Gates page:**
- Replace 10s `setInterval` polling with Socket.io listeners
- Keep initial `GET /gates` fetch on mount for full gate list
- Listen for `gate:status` to update individual gate cards
- Listen for `gate:command` to show command activity

**Events page:**
- Listen for `gate:event` to prepend new events to the top of the list
- Existing filter/pagination unchanged

**Dashboard:**
- Listen for `gate:event` to increment today's event count live

### Guard App

**New file: `src/api/socket.ts`** — Socket.io client module. Connects with guard JWT token after login, disconnects on logout.

**Queue view:**
- Listen for `gate:event` where `accessDecision === 'guard_review'` to add entries to pending queue
- Listen for `gate:command` to show admin-initiated commands

### Connection Lifecycle

- Connect after successful login (token available in auth store)
- Disconnect on logout (cleanup in auth store's logout action)
- Socket.io handles auto-reconnection on network drops
- On reconnect, do a full data refresh (re-fetch latest state) since events may have been missed during disconnection

## Decisions

- Socket.io over raw `ws` — rooms, auto-reconnect, fallback to polling
- Attach to existing Express server — no separate service, no extra port
- JWT auth on handshake — reuse existing tokens, same verification logic
- Community-scoped rooms — natural multi-tenancy boundary
- Resident App excluded — low urgency, can add later

## Out of Scope

- Resident App WebSocket integration
- Message persistence/replay (missed events recovered via full refresh on reconnect)
- Horizontal scaling (sticky sessions / Redis adapter — needed when deploying multiple API instances, not for MVP)
- Rate limiting on WebSocket messages
