# CommunityGate Phase 2 — Backend Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all 6 Node.js backend microservices — vehicle CRUD + access check, visitor passes + OTP, gate MQTT commands, notifications, audit/reporting, and the API gateway that ties them together.

**Architecture:** Each service is a standalone Express app with its own package.json inside the pnpm monorepo. All services share a common Postgres connection via the api-gateway's db module. Services communicate internally via direct HTTP calls. The API gateway is the single public-facing entry point with JWT auth and rate limiting. All Node.js uses ESM (`type: "module"`).

**Tech Stack:** Node.js 20, Express, pg (node-postgres), ioredis, mqtt.js, zod (validation), jsonwebtoken, multer (CSV upload), pdfkit (reports), vitest (testing)

**Spec:** `spec_extracted.txt` — API contracts in Section 6, DB schema in Section 4, MQTT in Section 5.

**Response format:** All responses: `{ success, data, error, meta: { ts, requestId } }`
**Auth:** `Authorization: Bearer <jwt>` for users; `X-Device-Token: <token>` for edge nodes.
**Pagination:** Cursor-based `{ cursor, limit, hasMore }`.

---

### Task 1: Shared DB Module + API Response Helpers

**Files:**
- Create: `services/api-gateway/package.json`
- Create: `services/api-gateway/src/db/pool.js`
- Create: `services/api-gateway/src/db/queries.js`
- Create: `services/api-gateway/src/middleware/response.js`
- Create: `services/api-gateway/src/middleware/errorHandler.js`
- Test: `services/api-gateway/src/__tests__/db.test.js`

This task creates the foundation that ALL other services depend on.

- [ ] **Step 1: Create api-gateway package.json**

```json
{
  "name": "api-gateway",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.21.0",
    "pg": "^8.13.0",
    "ioredis": "^5.4.1",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.23.8",
    "uuid": "^10.0.0",
    "cors": "^2.8.5",
    "helmet": "^8.0.0",
    "express-rate-limit": "^7.4.1",
    "multer": "^1.4.5-lts.1",
    "pdfkit": "^0.15.0",
    "mqtt": "^5.10.1"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `src/db/pool.js`** — Postgres connection pool

```javascript
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DATABASE_POOL_MIN || '2'),
  max: parseInt(process.env.DATABASE_POOL_MAX || '10'),
});

pool.on('error', (err) => {
  console.error('Unexpected pool error', err);
});

export default pool;
```

- [ ] **Step 3: Create `src/db/queries.js`** — Query helper with consistent error handling

```javascript
import pool from './pool.js';

export async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

export async function queryOne(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

export async function queryRows(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}
```

- [ ] **Step 4: Create `src/middleware/response.js`** — Standard response wrapper

```javascript
import { v4 as uuidv4 } from 'uuid';

export function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    error: null,
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

export function error(res, message, statusCode = 400, details = null) {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error: { message, details },
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

export function requestIdMiddleware(req, res, next) {
  res.locals.requestId = req.headers['x-request-id'] || uuidv4();
  next();
}
```

- [ ] **Step 5: Create `src/middleware/errorHandler.js`** — Global error handler

```javascript
import { error as errorResponse } from './response.js';

export function errorHandler(err, req, res, _next) {
  console.error(`[${res.locals.requestId}] Error:`, err.message);
  const status = err.statusCode || err.status || 500;
  errorResponse(res, err.message || 'Internal server error', status);
}
```

- [ ] **Step 6: Run `pnpm install` from root**

```bash
cd /c/Users/calblr2734/Desktop/gateopener && npx pnpm install
```

- [ ] **Step 7: Write tests for response helpers**

```javascript
// services/api-gateway/src/__tests__/response.test.js
import { describe, it, expect } from 'vitest';
import { success, error } from '../middleware/response.js';

function mockRes() {
  const res = { locals: {}, status: function(s) { this.statusCode = s; return this; },
    json: function(d) { this.body = d; return this; } };
  return res;
}

describe('response helpers', () => {
  it('success wraps data correctly', () => {
    const res = mockRes();
    success(res, { id: '123' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('123');
    expect(res.body.meta.ts).toBeDefined();
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('error wraps message correctly', () => {
    const res = mockRes();
    error(res, 'Not found', 404);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Not found');
  });
});
```

- [ ] **Step 8: Run tests**

```bash
npx pnpm --filter api-gateway test
```

- [ ] **Step 9: Commit**

```bash
git add services/api-gateway/
git commit -m "feat: add api-gateway foundation — db pool, query helpers, response middleware"
```

---

### Task 2: Auth Middleware

**Files:**
- Create: `services/api-gateway/src/middleware/auth.js`
- Test: `services/api-gateway/src/__tests__/auth.test.js`

- [ ] **Step 1: Create `src/middleware/auth.js`**

Two auth strategies:
1. **JWT auth** — verifies `Authorization: Bearer <token>`, extracts user info (sub, community_id, role)
2. **Device token auth** — verifies `X-Device-Token: <token>`, extracts device info (gate_id, community_id)

For local dev, use a simple JWT verification with a shared secret. In production, this would validate against Cognito.

```javascript
import jwt from 'jsonwebtoken';
import { error } from './response.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod';

export function authenticateJWT(roles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return error(res, 'Missing or invalid Authorization header', 401);
    }
    try {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      if (roles.length && !roles.includes(decoded.role)) {
        return error(res, 'Insufficient permissions', 403);
      }
      next();
    } catch (err) {
      return error(res, 'Invalid or expired token', 401);
    }
  };
}

export function authenticateDevice(req, res, next) {
  const token = req.headers['x-device-token'];
  if (!token) {
    return error(res, 'Missing X-Device-Token header', 401);
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.device = decoded;
    next();
  } catch (err) {
    return error(res, 'Invalid device token', 401);
  }
}

// Helper to generate tokens for dev/testing
export function generateTestToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}
```

- [ ] **Step 2: Write auth tests**

Test: JWT auth succeeds with valid token, fails without, fails with wrong role. Device auth succeeds/fails.

- [ ] **Step 3: Run tests**

```bash
npx pnpm --filter api-gateway test
```

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/src/middleware/auth.js services/api-gateway/src/__tests__/auth.test.js
git commit -m "feat: add JWT and device token auth middleware"
```

---

### Task 3: Vehicle Service

**Files:**
- Create: `services/vehicle-service/package.json`
- Create: `services/vehicle-service/src/index.js`
- Create: `services/vehicle-service/src/routes.js`
- Create: `services/vehicle-service/src/access-check.js`
- Create: `services/vehicle-service/src/whitelist.js`
- Test: `services/vehicle-service/src/__tests__/routes.test.js`

This implements the core vehicle CRUD + the critical `/access/check` endpoint.

- [ ] **Step 1: Create vehicle-service package.json**

Same deps structure as api-gateway but only express, pg, ioredis, zod, uuid.

- [ ] **Step 2: Create `src/routes.js`** — Vehicle CRUD routes

Implements:
- `POST /vehicles` — register vehicle (plate normalized, UNIQUE check)
- `GET /vehicles` — list vehicles (resident sees own unit, admin sees community)
- `PUT /vehicles/:id` — update vehicle, assign/unassign RFID
- `DELETE /vehicles/:id` — soft-delete (admin only, set is_active=false)
- `POST /vehicles/bulk-import` — CSV multipart upload via multer
- `POST /blacklist` — add plate or rfid_uid_hash to blacklist
- `DELETE /blacklist/:id` — deactivate blacklist entry

All routes use zod for input validation and return standard response format.

- [ ] **Step 3: Create `src/whitelist.js`** — Whitelist sync endpoint

`GET /whitelist/sync` — returns full active vehicle list + blacklist for edge SQLite cache. Device token auth. Returns:
```json
{
  "vehicles": [{ "plate", "rfid_uid_hash", "unit_id", "unit_number", "resident_name" }],
  "blacklist": [{ "plate", "rfid_uid_hash" }]
}
```

- [ ] **Step 4: Create `src/access-check.js`** — The critical access decision endpoint

`POST /access/check` — target < 300ms. Logic:
1. Check Redis cache first for plate/rfid lookup
2. If cache miss, query Postgres
3. Check blacklist
4. Check visitor passes (for OTP method)
5. Return allow/deny/guard_review with event_id
6. Insert gate_event row
7. Upload snapshot to S3 if provided (async, don't block response)

- [ ] **Step 5: Create `src/index.js`** — Express app setup

Mount all routes under appropriate paths. Export the app for testing.

- [ ] **Step 6: Write tests** — Test vehicle CRUD, whitelist sync, access check

Use vitest with mocked pg pool. Test:
- Vehicle creation with valid/invalid data
- Whitelist sync returns correct format
- Access check: known plate → allow, unknown → guard_review, blacklisted → deny

- [ ] **Step 7: Run tests**

```bash
npx pnpm --filter vehicle-service test
```

- [ ] **Step 8: Commit**

```bash
git add services/vehicle-service/
git commit -m "feat: add vehicle service — CRUD, whitelist sync, access check"
```

---

### Task 4: Visitor Service

**Files:**
- Create: `services/visitor-service/package.json`
- Create: `services/visitor-service/src/index.js`
- Create: `services/visitor-service/src/routes.js`
- Create: `services/visitor-service/src/otp.js`
- Test: `services/visitor-service/src/__tests__/routes.test.js`

- [ ] **Step 1: Create package.json**

- [ ] **Step 2: Create `src/routes.js`** — Visitor pass routes

Implements:
- `POST /passes` — create pass, generate 6-digit OTP, (mock) SMS via MSG91
- `GET /passes` — list passes with status/date filters
- `DELETE /passes/:id` — revoke active pass
- `POST /passes/verify` — verify OTP at gate (device token auth)
- `POST /passes/assign-rfid` — link temp RFID to pass (admin)

- [ ] **Step 3: Create `src/otp.js`** — OTP generation + SMS integration

Generate secure 6-digit OTP. MSG91 SMS integration with mock mode for dev (log to console instead of sending).

- [ ] **Step 4: Write tests**

Test pass creation, OTP verification (valid/expired/used), pass revocation.

- [ ] **Step 5: Run tests and commit**

```bash
npx pnpm --filter visitor-service test
git add services/visitor-service/
git commit -m "feat: add visitor service — passes, OTP generation, SMS mock"
```

---

### Task 5: Gate Command Service

**Files:**
- Create: `services/gate-command-service/package.json`
- Create: `services/gate-command-service/src/index.js`
- Create: `services/gate-command-service/src/routes.js`
- Create: `services/gate-command-service/src/mqtt-publisher.js`
- Test: `services/gate-command-service/src/__tests__/routes.test.js`

- [ ] **Step 1: Create package.json**

- [ ] **Step 2: Create `src/mqtt-publisher.js`** — MQTT client wrapper

Connects to MQTT broker (Mosquitto locally, IoT Core in prod). Publishes gate commands with:
- TTL stamp (Unix epoch + 30s)
- Event ID (UUID for idempotency)
- QoS 1, no retain

Listens for ACK messages and updates gate_events.

- [ ] **Step 3: Create `src/routes.js`** — Gate & event routes

Implements:
- `GET /gates` — all gates with live status
- `GET /gates/:id/status` — single gate status
- `POST /gates/:id/command` — manual gate open/close (admin), publishes MQTT
- `POST /heartbeat` — edge ping, updates gates.last_seen
- `POST /events/sync` — edge uploads queued offline events (batch insert into gate_events)
- `GET /events` — paginated event log with filters (cursor-based)

- [ ] **Step 4: Write tests**

Test MQTT command publishing (mock mqtt client), heartbeat updating last_seen, event sync batch insert.

- [ ] **Step 5: Run tests and commit**

```bash
npx pnpm --filter gate-command-service test
git add services/gate-command-service/
git commit -m "feat: add gate command service — MQTT publish, heartbeat, event sync"
```

---

### Task 6: Notification Service

**Files:**
- Create: `services/notification-service/package.json`
- Create: `services/notification-service/src/index.js`
- Create: `services/notification-service/src/routes.js`
- Create: `services/notification-service/src/fcm.js`
- Create: `services/notification-service/src/sms.js`
- Test: `services/notification-service/src/__tests__/routes.test.js`

- [ ] **Step 1: Create package.json**

- [ ] **Step 2: Create `src/fcm.js`** — Firebase Cloud Messaging wrapper

Send push notifications to residents. Mock mode for dev (log to console).

- [ ] **Step 3: Create `src/sms.js`** — MSG91 SMS wrapper

Send SMS (entry notifications, OTP). Mock mode for dev.

- [ ] **Step 4: Create `src/routes.js`**

Internal API for other services to trigger notifications. Not directly exposed to users.

- [ ] **Step 5: Write tests and commit**

```bash
npx pnpm --filter notification-service test
git add services/notification-service/
git commit -m "feat: add notification service — FCM push and SMS with mock mode"
```

---

### Task 7: Audit Service

**Files:**
- Create: `services/audit-service/package.json`
- Create: `services/audit-service/src/index.js`
- Create: `services/audit-service/src/routes.js`
- Create: `services/audit-service/src/pdf-report.js`
- Test: `services/audit-service/src/__tests__/routes.test.js`

- [ ] **Step 1: Create package.json**

- [ ] **Step 2: Create `src/routes.js`**

Implements:
- `GET /events` — paginated event log with filters (gate, method, decision, date range, plate). Cursor-based pagination.
- `GET /reports/daily` — generate PDF daily report for a given date

- [ ] **Step 3: Create `src/pdf-report.js`** — PDF report generation via pdfkit

Generate a daily summary PDF with:
- Total entries/exits
- Breakdown by method (ANPR vs RFID vs OTP)
- Denied entries with reasons
- Peak hours

- [ ] **Step 4: Write tests and commit**

```bash
npx pnpm --filter audit-service test
git add services/audit-service/
git commit -m "feat: add audit service — event log queries and PDF daily reports"
```

---

### Task 8: API Gateway — Route Aggregation + Rate Limiting

**Files:**
- Create: `services/api-gateway/src/index.js`
- Create: `services/api-gateway/src/routes/vehicles.js`
- Create: `services/api-gateway/src/routes/passes.js`
- Create: `services/api-gateway/src/routes/gates.js`
- Create: `services/api-gateway/src/routes/events.js`
- Create: `services/api-gateway/src/middleware/rateLimit.js`
- Create: `services/api-gateway/Dockerfile`
- Modify: existing test files

The API gateway is the single entry point. It either handles routes directly or proxies to internal services.

- [ ] **Step 1: Create `src/middleware/rateLimit.js`**

```javascript
import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

export const deviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.headers['x-device-token'] || req.ip,
});
```

- [ ] **Step 2: Create route files** — Mount all /api/v1 routes

Each route file mounts the corresponding service's endpoints:
- `/api/v1/vehicles/*` → vehicle-service routes
- `/api/v1/passes/*` → visitor-service routes
- `/api/v1/gates/*`, `/api/v1/heartbeat`, `/api/v1/events/sync` → gate-command-service routes
- `/api/v1/events`, `/api/v1/reports/*` → audit-service routes
- `/api/v1/whitelist/*`, `/api/v1/access/*`, `/api/v1/blacklist/*` → vehicle-service routes

- [ ] **Step 3: Create `src/index.js`** — Main Express server

Sets up: helmet, cors, JSON parsing, requestId middleware, rate limiting, route mounting, error handler. Listens on PORT_API_GATEWAY (3000).

- [ ] **Step 4: Create Dockerfile**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["node", "src/index.js"]
```

- [ ] **Step 5: Write integration tests**

Test: full request flow through gateway → service → response for key endpoints.

- [ ] **Step 6: Run ALL service tests**

```bash
npx pnpm test --recursive
```
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add services/api-gateway/
git commit -m "feat: add API gateway — route aggregation, rate limiting, JWT auth"
```

---

### Task 9: Final Integration Verification

**Files:**
- Modify: `CLAUDE.md` (mark Steps 9-14 as complete)

- [ ] **Step 1: Run all Node.js tests**

```bash
npx pnpm test --recursive
```

- [ ] **Step 2: Run all Python tests**

```bash
GATE_ID=gate-test COMMUNITY_ID=test-community DEVICE_TOKEN=test-token USE_GPIO_MOCK=true USE_RFID_MOCK=true USE_CAMERA_MOCK=true python -m pytest tests/ -v
```

- [ ] **Step 3: Verify Docker Compose builds for services with Dockerfiles**

- [ ] **Step 4: Update CLAUDE.md**

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "feat: complete Phase 2 — all backend services implemented and tested"
```
