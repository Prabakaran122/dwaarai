# Resident App Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Resident App with 5-tab navigation (Home/Visitors/Vehicles/Activity/Profile), self-registration flow, WhatsApp pass sharing, live activity feed, and full entry/exit history.

**Architecture:** Backend-first approach — add DB migration, then new/modified API endpoints, then update frontend stores and API client, then build screens bottom-up (new components, new screens, redesigned screens, navigation). Each task produces a working commit.

**Tech Stack:** Node.js/Express (API Gateway), PostgreSQL, Redis, React Native (Expo), Zustand, Axios, expo-linear-gradient, react-native-reanimated, MaterialCommunityIcons.

---

## File Structure

### Backend (services/api-gateway/)

| File | Action | Responsibility |
|------|--------|----------------|
| `migrations/009_invite_code.sql` | Create | Add invite_code to communities, visitor_vehicle to visitor_passes |
| `src/routes/auth.js` | Modify | Add resident-register + resident-register-verify endpoints |
| `src/routes/events.js` | Modify | Add GET /events/my-unit for residents |
| `src/routes/vehicles.js` | Modify | Include last_entry_at in GET /vehicles response |
| `src/routes/passes.js` | Modify | Add visitor_vehicle field to pass creation, include pass URL in response |

### Frontend (apps/resident-app/)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/api/client.ts` | Modify | Add register, myUnitEvents, updated pass endpoints |
| `src/store/authStore.ts` | Modify | Add register flow (community code + phone + unit + OTP) |
| `src/store/vehicleStore.ts` | Modify | Add lastEntryAt field to Vehicle interface |
| `src/screens/RegisterScreen.tsx` | Create | Community code + phone + unit + OTP registration |
| `src/screens/LoginScreen.tsx` | Modify | Add "First time? Register" link |
| `src/screens/HomeScreen.tsx` | Rewrite | Activity feed + quick actions + today's summary |
| `src/screens/VisitorsScreen.tsx` | Create (replaces PassesScreen) | WhatsApp sharing + QR + swipe-to-revoke |
| `src/screens/ActivityScreen.tsx` | Create | Full history with date/type filters |
| `src/screens/VehiclesScreen.tsx` | Rewrite | FASTag status + last entry + info banner |
| `src/screens/ProfileScreen.tsx` | Create | Unit info, notification prefs, logout |
| `src/components/ActivityItem.tsx` | Create | Timeline row for activity feed |
| `src/components/VisitorPassCard.tsx` | Create | Pass card with OTP, QR icon, share button |
| `app/index.tsx` | Rewrite | 5-tab navigation + register screen routing |

### Removed:
| File | Reason |
|------|--------|
| `src/screens/PassesScreen.tsx` | Replaced by VisitorsScreen.tsx |
| `src/screens/NotificationsScreen.tsx` | Replaced by ActivityScreen.tsx |

---

## Task 1: Database Migration — invite_code + visitor_vehicle

**Files:**
- Create: `services/api-gateway/migrations/009_invite_code.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 009_invite_code.sql — Resident self-registration + visitor vehicle support

-- Community invite code for self-registration
ALTER TABLE communities ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20) UNIQUE;

-- Generate invite codes for existing communities
UPDATE communities SET invite_code = UPPER(SUBSTR(REPLACE(gen_random_uuid()::text, '-', ''), 1, 8))
WHERE invite_code IS NULL;

-- Visitor vehicle number for ANPR auto-entry
ALTER TABLE visitor_passes ADD COLUMN IF NOT EXISTS visitor_vehicle VARCHAR(20);
```

- [ ] **Step 2: Run migration against dev database**

Run: `cd services/api-gateway && docker compose exec postgres psql -U communitygate -d communitygate -f /dev/stdin < migrations/009_invite_code.sql`
Expected: ALTER TABLE, UPDATE, ALTER TABLE — no errors.

- [ ] **Step 3: Verify columns exist**

Run: `docker compose exec postgres psql -U communitygate -d communitygate -c "\d communities" | grep invite_code`
Expected: `invite_code | character varying(20) |`

Run: `docker compose exec postgres psql -U communitygate -d communitygate -c "\d visitor_passes" | grep visitor_vehicle`
Expected: `visitor_vehicle | character varying(20) |`

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/migrations/009_invite_code.sql
git commit -m "feat: migration 009 — invite_code on communities + visitor_vehicle on passes"
```

---

## Task 2: Auth API — Resident Self-Registration

**Files:**
- Modify: `services/api-gateway/src/routes/auth.js`

The existing file has guard-login, resident-otp, resident-verify, and admin-login. We add two new endpoints after the existing resident-verify block (after line 229).

- [ ] **Step 1: Add Zod schemas for registration**

Add after the existing `adminLoginSchema` (line 45) in `services/api-gateway/src/routes/auth.js`:

```javascript
const residentRegisterSchema = z.object({
  community_code: z.string().min(1).max(20),
  phone: z.string().min(10).max(15),
  unit_number: z.string().min(1).max(30),
});

const residentRegisterVerifySchema = z.object({
  phone: z.string().min(10).max(15),
  otp: z.string().length(6),
});
```

- [ ] **Step 2: Add POST /auth/resident-register endpoint**

Add before the admin-login route (before line 231) in `services/api-gateway/src/routes/auth.js`:

```javascript
// -- POST /auth/resident-register --------------------------------------------

router.post('/auth/resident-register', loginLimiter, async (req, res) => {
  try {
    const parsed = residentRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { community_code, phone, unit_number } = parsed.data;

    // Find community by invite code
    const community = await queryOne(
      'SELECT id, name FROM communities WHERE invite_code = $1 AND is_active = true',
      [community_code.toUpperCase()]
    );
    if (!community) {
      return error(res, 'Invalid community code', 400);
    }

    // Find unit in this community
    const unit = await queryOne(
      'SELECT id, unit_number, block_id FROM units WHERE community_id = $1 AND unit_number = $2',
      [community.id, unit_number]
    );
    if (!unit) {
      return error(res, 'Unit not found in this community', 400);
    }

    // Check if phone already registered in this community
    const existing = await queryOne(
      'SELECT id FROM residents WHERE community_id = $1 AND mobile = $2 AND is_active = true',
      [community.id, phone]
    );
    if (existing) {
      return error(res, 'Phone number already registered', 409);
    }

    // Generate and store OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const redis = getRedisClient();
    await redis.set(`reg:${phone}`, JSON.stringify({
      otp,
      community_id: community.id,
      community_name: community.name,
      unit_id: unit.id,
      unit_number: unit.unit_number,
    }), 'EX', 300);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] Registration OTP for ${phone}: ${otp}`);
    }

    return success(res, { message: 'OTP sent', communityName: community.name });
  } catch (err) {
    console.error('POST /auth/resident-register error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 3: Add POST /auth/resident-register-verify endpoint**

Add immediately after the resident-register route:

```javascript
// -- POST /auth/resident-register-verify ------------------------------------

router.post('/auth/resident-register-verify', loginLimiter, async (req, res) => {
  try {
    const parsed = residentRegisterVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { phone, otp } = parsed.data;

    const redis = getRedisClient();
    const raw = await redis.get(`reg:${phone}`);
    if (!raw) {
      return error(res, 'Invalid or expired OTP', 401);
    }

    const regData = JSON.parse(raw);
    if (regData.otp !== otp) {
      return error(res, 'Invalid or expired OTP', 401);
    }

    await redis.del(`reg:${phone}`);

    // Double-check no duplicate was created in the meantime
    const existing = await queryOne(
      'SELECT id FROM residents WHERE community_id = $1 AND mobile = $2 AND is_active = true',
      [regData.community_id, phone]
    );
    if (existing) {
      return error(res, 'Phone number already registered', 409);
    }

    // Create resident record
    const resident = await queryOne(
      `INSERT INTO residents (community_id, unit_id, name, mobile, type, is_primary)
       VALUES ($1, $2, $3, $4, 'owner', false)
       RETURNING id, community_id, unit_id, name, mobile`,
      [regData.community_id, regData.unit_id, 'Resident', phone]
    );

    const token = signToken({
      sub: resident.id,
      role: 'resident',
      community_id: resident.community_id,
      unit_id: resident.unit_id,
      name: resident.name,
    });

    return success(res, {
      token,
      user: {
        id: resident.id,
        name: resident.name,
        phone: resident.mobile,
        unitNumber: regData.unit_number,
        communityName: regData.community_name,
      },
    }, 201);
  } catch (err) {
    console.error('POST /auth/resident-register-verify error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 4: Verify the server starts without errors**

Run: `cd services/api-gateway && node -e "import('./src/routes/auth.js').then(() => console.log('OK'))"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add services/api-gateway/src/routes/auth.js
git commit -m "feat: add resident self-registration endpoints (community code + OTP)"
```

---

## Task 3: Events API — Resident Unit Events

**Files:**
- Modify: `services/api-gateway/src/routes/events.js`

The existing GET /events is admin-only. We add GET /events/my-unit for residents that filters by their unit_id.

- [ ] **Step 1: Add GET /events/my-unit endpoint**

Add after the existing GET /events route (after line 84) in `services/api-gateway/src/routes/events.js`:

```javascript
// -- GET /events/my-unit (JWT resident) --------------------------------------

router.get('/events/my-unit', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const community_id = user.community_id;
    const unit_id = user.unit_id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.query.cursor || null;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;
    const methodFilter = req.query.detection_method || null;

    let sql = `SELECT ge.*, g.name AS gate_name
      FROM gate_events ge
      LEFT JOIN gates g ON ge.gate_id = g.id
      WHERE ge.community_id = $1
        AND ge.matched_unit_id = $2`;
    const params = [community_id, unit_id];

    if (dateFrom) {
      sql += ` AND ge.event_ts >= $${params.length + 1}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND ge.event_ts <= $${params.length + 1}`;
      params.push(dateTo);
    }
    if (methodFilter) {
      sql += ` AND ge.detection_method = $${params.length + 1}`;
      params.push(methodFilter);
    }
    if (cursor) {
      sql += ` AND ge.event_ts < $${params.length + 1}`;
      params.push(cursor);
    }

    sql += ` ORDER BY ge.event_ts DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const rows = await queryRows(sql, params);
    const hasMore = rows.length > limit;
    const rawData = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? rawData[rawData.length - 1].event_ts.toISOString() : null;

    const data = rawData.map(row => ({
      id: row.id,
      timestamp: row.event_ts,
      gate_name: row.gate_name || 'Unknown',
      method: row.detection_method,
      plate: row.raw_value || '',
      decision: row.access_decision,
      direction: row.direction || 'entry',
      resident_name: row.resident_name || '',
      confidence: row.anpr_confidence,
    }));

    return success(res, data);
  } catch (err) {
    console.error('GET /events/my-unit error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/routes/events.js
git commit -m "feat: add GET /events/my-unit endpoint for resident activity feed"
```

---

## Task 4: Vehicles API — Include last_entry_at

**Files:**
- Modify: `services/api-gateway/src/routes/vehicles.js:107-147`

- [ ] **Step 1: Update GET /vehicles query to include last entry timestamp**

Replace the GET /vehicles handler's SQL query section. In `services/api-gateway/src/routes/vehicles.js`, find the existing GET /vehicles route (starts at line 108). Replace the SQL building logic (lines 116-141) so it joins gate_events for last entry:

```javascript
// GET /vehicles
router.get('/vehicles', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const user = req.user;
    const community_id = user.community_id;
    const cursor = req.query.cursor || null;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const plateSearch = req.query.plate || null;

    let sql, params;
    if (user.role === 'admin') {
      sql = `SELECT v.*,
               (SELECT ge.event_ts FROM gate_events ge
                WHERE ge.matched_vehicle_id = v.id
                ORDER BY ge.event_ts DESC LIMIT 1) AS last_entry_at
             FROM vehicles v
             WHERE v.community_id = $1 AND v.is_active = true`;
      params = [community_id];
    } else {
      sql = `SELECT v.*,
               (SELECT ge.event_ts FROM gate_events ge
                WHERE ge.matched_vehicle_id = v.id
                ORDER BY ge.event_ts DESC LIMIT 1) AS last_entry_at
             FROM vehicles v
             WHERE v.community_id = $1 AND v.unit_id = $2 AND v.is_active = true`;
      params = [community_id, user.unit_id];
    }

    if (plateSearch) {
      sql += ` AND v.plate ILIKE $${params.length + 1}`;
      params.push(`%${plateSearch}%`);
    }

    if (cursor) {
      sql += ` AND v.created_at < $${params.length + 1}`;
      params.push(cursor);
    }
    sql += ` ORDER BY v.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const rows = await queryRows(sql, params);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].created_at.toISOString() : null;

    return success(res, data);
  } catch (err) {
    console.error('GET /vehicles error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/routes/vehicles.js
git commit -m "feat: include last_entry_at in GET /vehicles response"
```

---

## Task 5: Passes API — Visitor Vehicle + Pass URL

**Files:**
- Modify: `services/api-gateway/src/routes/passes.js`

- [ ] **Step 1: Update create pass schema to accept visitor_vehicle**

In `services/api-gateway/src/routes/passes.js`, replace the `createPassSchema` (lines 24-30):

```javascript
const createPassSchema = z.object({
  visitor_name: z.string().min(1).max(200),
  visitor_mobile: z.string().min(7).max(15).optional(),
  visitor_vehicle: z.string().max(20).optional(),
  valid_from: z.string().datetime(),
  valid_until: z.string().datetime(),
  max_uses: z.number().int().min(1).default(1),
});
```

- [ ] **Step 2: Update POST /passes to save visitor_vehicle**

In the POST /passes handler (line 44-72), update the destructure and INSERT to include `visitor_vehicle`. Replace the handler body:

```javascript
router.post('/passes', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = createPassSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { visitor_name, visitor_mobile, visitor_vehicle, valid_from, valid_until, max_uses } = parsed.data;
    const user = req.user;
    const community_id = user.community_id;
    const unit_id = user.unit_id;
    const created_by = user.sub;

    const otp = generateOTP(6);

    const pass = await queryOne(
      `INSERT INTO visitor_passes
         (community_id, unit_id, created_by, visitor_name, visitor_mobile, visitor_vehicle, otp, valid_from, valid_until, max_uses)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [community_id, unit_id, created_by, visitor_name, visitor_mobile || null, visitor_vehicle || null, otp, valid_from, valid_until, max_uses]
    );

    return success(res, pass, 201);
  } catch (err) {
    console.error('POST /passes error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 3: Update GET /passes to return flat array (fix frontend data contract)**

The current GET /passes returns `{ passes: [...], nextCursor }` but the resident app expects a flat array at `res.data.data`. Update the GET /passes response (line 120) to return the flat array for residents:

In `services/api-gateway/src/routes/passes.js`, replace the return in GET /passes:

```javascript
    return success(res, data);
```

(Keep the nextCursor logic but only send the array. The resident app doesn't paginate passes currently.)

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/src/routes/passes.js
git commit -m "feat: add visitor_vehicle to passes, return flat array from GET /passes"
```

---

## Task 6: API Client — New Endpoints

**Files:**
- Modify: `apps/resident-app/src/api/client.ts`

- [ ] **Step 1: Rewrite the API client with all new endpoints**

Replace the entire file `apps/resident-app/src/api/client.ts`:

```typescript
import axios from 'axios';
import { z } from 'zod';

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

const api = axios.create({ baseURL: API_BASE, timeout: 10000 });

export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any(),
  error: z.any().nullable(),
  meta: z.object({ ts: z.string(), requestId: z.string() }),
});

export type ApiResponse = z.infer<typeof ApiResponseSchema>;

export function setAuthToken(token: string) {
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export function clearAuthToken() {
  delete api.defaults.headers.common['Authorization'];
}

// Auth — phone + OTP (existing login)
export const requestOTP = (phone: string) =>
  api.post('/auth/resident-otp', { phone });

export const verifyOTP = (phone: string, otp: string) =>
  api.post('/auth/resident-verify', { phone, otp });

// Auth — self-registration
export const registerResident = (data: {
  community_code: string;
  phone: string;
  unit_number: string;
}) => api.post('/auth/resident-register', data);

export const verifyRegistration = (phone: string, otp: string) =>
  api.post('/auth/resident-register-verify', { phone, otp });

// Vehicles
export const getVehicles = () => api.get('/vehicles');

export const createVehicle = (data: {
  plate: string;
  make: string;
  model: string;
  type: string;
}) => api.post('/vehicles', data);

export const updateVehicle = (
  id: string,
  data: { plate?: string; make?: string; model?: string; type?: string },
) => api.put(`/vehicles/${id}`, data);

export const deleteVehicle = (id: string) => api.delete(`/vehicles/${id}`);

// Passes
export const getPasses = () => api.get('/passes');

export const createPass = (data: {
  visitor_name: string;
  visitor_mobile?: string;
  visitor_vehicle?: string;
  valid_from: string;
  valid_until: string;
}) => api.post('/passes', data);

export const revokePass = (id: string) => api.delete(`/passes/${id}`);

// Events — resident unit events
export const getMyUnitEvents = (params?: Record<string, string>) =>
  api.get('/events/my-unit', { params });

export default api;
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/api/client.ts
git commit -m "feat: add registration + unit events endpoints to API client"
```

---

## Task 7: Auth Store — Register Flow

**Files:**
- Modify: `apps/resident-app/src/store/authStore.ts`

- [ ] **Step 1: Rewrite authStore with registration support**

Replace the entire file `apps/resident-app/src/store/authStore.ts`:

```typescript
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken, clearAuthToken } from '../api/client';

const AUTH_STORAGE_KEY = 'communitygate_resident_auth';

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  unitNumber: string;
  communityName?: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  showRegister: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  rehydrate: () => Promise<void>;
  setShowRegister: (show: boolean) => void;
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  showRegister: false,

  login: (token, user) => {
    setAuthToken(token);
    set({ token, user, isAuthenticated: true, showRegister: false });
    AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, user })).catch(() => {});
  },

  logout: () => {
    clearAuthToken();
    set({
      token: null,
      user: null,
      isAuthenticated: false,
    });
    AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
  },

  rehydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const { token, user } = JSON.parse(raw);
        if (token && !isTokenExpired(token)) {
          setAuthToken(token);
          set({ token, user, isAuthenticated: true, isLoading: false });
          return;
        }
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
    }
    set({ isLoading: false });
  },

  setShowRegister: (show) => set({ showRegister: show }),
}));
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/store/authStore.ts
git commit -m "feat: add registration flow + communityName to auth store"
```

---

## Task 8: Vehicle Store — lastEntryAt Field

**Files:**
- Modify: `apps/resident-app/src/store/vehicleStore.ts`

- [ ] **Step 1: Update Vehicle interface and store**

Replace the entire file `apps/resident-app/src/store/vehicleStore.ts`:

```typescript
import { create } from 'zustand';
import * as api from '../api/client';

export interface Vehicle {
  id: string;
  plate: string;
  make: string;
  model: string;
  type: string;
  rfidTag?: string;
  fastagTidHash?: string;
  lastEntryAt?: string;
  createdAt: string;
}

interface VehicleState {
  vehicles: Vehicle[];
  loading: boolean;
  fetch: () => Promise<void>;
  add: (data: { plate: string; make: string; model: string; type: string }) => Promise<void>;
  update: (id: string, data: Partial<Vehicle>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

function mapVehicle(raw: any): Vehicle {
  return {
    id: raw.id,
    plate: raw.plate_display || raw.plate,
    make: raw.make || '',
    model: raw.model || '',
    type: raw.type || 'car',
    rfidTag: raw.rfid_uid_hash,
    fastagTidHash: raw.fastag_tid_hash,
    lastEntryAt: raw.last_entry_at || undefined,
    createdAt: raw.created_at,
  };
}

export const useVehicleStore = create<VehicleState>((set) => ({
  vehicles: [],
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.getVehicles();
      const raw = res.data.data;
      const vehicles = Array.isArray(raw) ? raw.map(mapVehicle) : [];
      set({ vehicles });
    } finally {
      set({ loading: false });
    }
  },
  add: async (data) => {
    const res = await api.createVehicle(data);
    const vehicle = mapVehicle(res.data.data);
    set((s) => ({ vehicles: [...s.vehicles, vehicle] }));
  },
  update: async (id, data) => {
    const res = await api.updateVehicle(id, data);
    const vehicle = mapVehicle(res.data.data);
    set((s) => ({
      vehicles: s.vehicles.map((v) => (v.id === id ? vehicle : v)),
    }));
  },
  remove: async (id) => {
    await api.deleteVehicle(id);
    set((s) => ({ vehicles: s.vehicles.filter((v) => v.id !== id) }));
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/store/vehicleStore.ts
git commit -m "feat: add lastEntryAt + mapVehicle to vehicle store"
```

---

## Task 9: ActivityItem Component

**Files:**
- Create: `apps/resident-app/src/components/ActivityItem.tsx`

- [ ] **Step 1: Create the ActivityItem component**

Create `apps/resident-app/src/components/ActivityItem.tsx`:

```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';

export interface ActivityEvent {
  id: string;
  timestamp: string;
  gate_name: string;
  method: string;
  plate: string;
  decision: string;
  direction?: string;
  resident_name?: string;
}

const methodConfig: Record<string, { color: string; label: string }> = {
  fastag: { color: '#06b6d4', label: 'FASTag' },
  anpr: { color: '#3b82f6', label: 'ANPR' },
  rfid: { color: '#8b5cf6', label: 'RFID' },
  otp: { color: '#a855f7', label: 'OTP' },
};

function getVehicleIcon(plate: string): string {
  return 'car';
}

export default function ActivityItem({ event }: { event: ActivityEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const isEntry = event.direction !== 'exit';
  const method = methodConfig[event.method] || { color: colors.textMuted, label: event.method };

  return (
    <GlowCard style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.time}>{time}</Text>
        <MaterialCommunityIcons
          name={isEntry ? 'arrow-down-circle' : 'arrow-up-circle'}
          size={20}
          color={isEntry ? colors.success : colors.danger}
          style={styles.directionIcon}
        />
        <View style={styles.info}>
          <Text style={styles.plate} numberOfLines={1}>
            {event.plate || event.resident_name || 'Unknown'}
          </Text>
          <Text style={styles.gate}>{event.gate_name}</Text>
        </View>
        <View style={[styles.methodPill, { backgroundColor: method.color + '20' }]}>
          <Text style={[styles.methodText, { color: method.color }]}>{method.label}</Text>
        </View>
      </View>
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, width: 60 },
  directionIcon: { marginRight: 2 },
  info: { flex: 1, gap: 2 },
  plate: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  gate: { fontSize: 11, color: colors.textMuted },
  methodPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  methodText: { fontSize: 10, fontWeight: '700' },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/components/ActivityItem.tsx
git commit -m "feat: add ActivityItem component for timeline rows"
```

---

## Task 10: VisitorPassCard Component

**Files:**
- Create: `apps/resident-app/src/components/VisitorPassCard.tsx`

- [ ] **Step 1: Create the VisitorPassCard component**

Create `apps/resident-app/src/components/VisitorPassCard.tsx`:

```typescript
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';

export interface PassData {
  id: string;
  visitor_name: string;
  visitor_mobile?: string;
  visitor_vehicle?: string;
  otp: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  valid_from: string;
  valid_until: string;
  uses_count: number;
  max_uses: number;
}

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  active: { color: colors.success, bg: colors.successBg, label: 'Active' },
  used: { color: colors.info, bg: colors.infoBg, label: 'Used' },
  expired: { color: colors.textMuted, bg: colors.surface, label: 'Expired' },
  revoked: { color: colors.danger, bg: colors.dangerBg, label: 'Revoked' },
};

interface Props {
  pass: PassData;
  residentName: string;
  unitNumber: string;
  communityName?: string;
  onRevoke: (id: string) => void;
}

export default function VisitorPassCard({ pass, residentName, unitNumber, communityName, onRevoke }: Props) {
  const status = statusConfig[pass.status] || statusConfig.expired;
  const variant = pass.status === 'active' ? 'success' : pass.status === 'revoked' ? 'danger' : 'default';
  const validUntil = new Date(pass.valid_until).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const usesText = `${pass.uses_count}/${pass.max_uses} uses`;

  const shareWhatsApp = () => {
    const validFrom = new Date(pass.valid_from).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const msg = [
      `Hi! I've shared a visitor pass for you at ${communityName || 'our community'}.`,
      '',
      `Gate Code: ${pass.otp}`,
      `Valid: ${validFrom} - ${validUntil}`,
      '',
      `- ${residentName}, ${unitNumber}`,
    ].join('\n');

    const url = `whatsapp://send?text=${encodeURIComponent(msg)}`;
    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) Linking.openURL(url);
        else Alert.alert('WhatsApp not installed');
      })
      .catch(() => Alert.alert('Could not open WhatsApp'));
  };

  const handleRevoke = () => {
    Alert.alert('Revoke Pass', 'This will invalidate the visitor pass.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => onRevoke(pass.id) },
    ]);
  };

  return (
    <GlowCard variant={variant} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.info}>
          <Text style={styles.name}>{pass.visitor_name}</Text>
          {pass.visitor_vehicle ? (
            <Text style={styles.vehicle}>{pass.visitor_vehicle}</Text>
          ) : null}
          <Text style={styles.validity}>Valid until {validUntil} · {usesText}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      {pass.status === 'active' && (
        <View style={styles.activeSection}>
          <View style={styles.otpBox}>
            <MaterialCommunityIcons name="qrcode" size={20} color={colors.info} />
            <Text style={styles.otpCode}>{pass.otp}</Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity onPress={shareWhatsApp} style={styles.shareButton}>
              <LinearGradient
                colors={colors.gradientSuccess as [string, string]}
                style={styles.shareGradient}
              >
                <MaterialCommunityIcons name="whatsapp" size={18} color={colors.white} />
                <Text style={styles.shareText}>Share</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleRevoke} style={styles.revokeButton}>
              <MaterialCommunityIcons name="close-circle-outline" size={18} color={colors.danger} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  vehicle: { fontSize: 13, fontFamily: 'monospace', color: colors.info, letterSpacing: 1 },
  validity: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: '700' },
  activeSection: { marginTop: spacing.md },
  otpBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.infoBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  otpCode: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.info,
    letterSpacing: 4,
    fontFamily: 'monospace',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  shareButton: { flex: 1 },
  shareGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  shareText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  revokeButton: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/components/VisitorPassCard.tsx
git commit -m "feat: add VisitorPassCard component with WhatsApp sharing"
```

---

## Task 11: RegisterScreen

**Files:**
- Create: `apps/resident-app/src/screens/RegisterScreen.tsx`

- [ ] **Step 1: Create RegisterScreen**

Create `apps/resident-app/src/screens/RegisterScreen.tsx`:

```typescript
import React, { useState, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { registerResident, verifyRegistration } from '../api/client';
import { useAuthStore } from '../store/authStore';

type Step = 'details' | 'otp';

export default function RegisterScreen() {
  const login = useAuthStore((s) => s.login);
  const setShowRegister = useAuthStore((s) => s.setShowRegister);
  const [step, setStep] = useState<Step>('details');
  const [communityCode, setCommunityCode] = useState('');
  const [phone, setPhone] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [communityName, setCommunityName] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const handleRegister = async () => {
    if (!communityCode.trim() || !phone.trim() || !unitNumber.trim()) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await registerResident({
        community_code: communityCode.trim().toUpperCase(),
        phone: phone.trim(),
        unit_number: unitNumber.trim(),
      });
      setCommunityName(res.data.data?.communityName || '');
      setStep('otp');
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'Registration failed';
      setErrorMsg(typeof msg === 'string' ? msg : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '');
    if (!cleaned && value === '') {
      const newDigits = [...digits];
      newDigits[index] = '';
      setDigits(newDigits);
      if (index > 0) inputRefs.current[index - 1]?.focus();
      return;
    }
    if (cleaned.length === 1) {
      const newDigits = [...digits];
      newDigits[index] = cleaned;
      setDigits(newDigits);
      if (index < 5) inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      const newDigits = [...digits];
      newDigits[index - 1] = '';
      setDigits(newDigits);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const otp = digits.join('');

  const handleVerifyOTP = async () => {
    if (otp.length !== 6) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await verifyRegistration(phone.trim(), otp);
      const { token, user } = res.data.data;
      login(token, { ...user, communityName });
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'Invalid or expired OTP';
      setErrorMsg(typeof msg === 'string' ? msg : 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={colors.gradientBg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.container}>
      <AnimatedEntry direction="up" duration={600}>
        <GlowCard style={styles.card}>
          <View style={styles.logoRow}>
            <LinearGradient colors={colors.gradientSuccess as [string, string]} style={styles.logoCircle}>
              <MaterialCommunityIcons name="account-plus" size={28} color={colors.white} />
            </LinearGradient>
          </View>
          <Text style={styles.title}>Join Community</Text>
          <Text style={styles.subtitle}>RESIDENT REGISTRATION</Text>

          {errorMsg ? (
            <AnimatedEntry direction="fade">
              <Text style={styles.error}>{errorMsg}</Text>
            </AnimatedEntry>
          ) : null}

          {step === 'details' ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Community Code (e.g., PALM2026)"
                placeholderTextColor={colors.textMuted}
                value={communityCode}
                onChangeText={setCommunityCode}
                autoCapitalize="characters"
              />
              <TextInput
                style={styles.input}
                placeholder="Phone number"
                placeholderTextColor={colors.textMuted}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
              <TextInput
                style={styles.input}
                placeholder="Unit number (e.g., 301)"
                placeholderTextColor={colors.textMuted}
                value={unitNumber}
                onChangeText={setUnitNumber}
              />
              <GradientButton
                title="Register"
                onPress={handleRegister}
                icon="account-plus"
                variant="success"
                loading={loading}
                disabled={!communityCode.trim() || !phone.trim() || !unitNumber.trim()}
              />
            </>
          ) : (
            <>
              <Text style={styles.otpSentLabel}>OTP sent to {phone}</Text>
              {communityName ? (
                <Text style={styles.communityLabel}>Joining {communityName}</Text>
              ) : null}
              <View style={styles.digitRow}>
                {digits.map((digit, i) => (
                  <View key={i} style={[styles.digitBox, digit ? styles.digitBoxFilled : null]}>
                    <TextInput
                      ref={(ref) => { inputRefs.current[i] = ref; }}
                      style={styles.digitInput}
                      value={digit}
                      onChangeText={(v) => handleDigitChange(i, v)}
                      onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
                      keyboardType="number-pad"
                      maxLength={1}
                      textAlign="center"
                      selectTextOnFocus
                    />
                  </View>
                ))}
              </View>
              <GradientButton
                title="Verify OTP"
                onPress={handleVerifyOTP}
                icon="check-circle"
                variant="success"
                loading={loading}
                disabled={otp.length !== 6}
              />
              <TouchableOpacity onPress={() => { setStep('details'); setDigits(['', '', '', '', '', '']); setErrorMsg(''); }} style={styles.changeLink}>
                <Text style={styles.changeLinkText}>Change details</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity onPress={() => setShowRegister(false)} style={styles.changeLink}>
            <Text style={styles.changeLinkText}>Already have an account? Login</Text>
          </TouchableOpacity>
        </GlowCard>
      </AnimatedEntry>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { width: '85%', maxWidth: 360 },
  logoRow: { alignItems: 'center', marginBottom: spacing.lg },
  logoCircle: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { fontSize: 12, color: colors.success, textAlign: 'center', marginBottom: spacing['2xl'], letterSpacing: 2 },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.lg, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md,
  },
  otpSentLabel: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: spacing.xs },
  communityLabel: { color: colors.success, fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: spacing.lg },
  digitRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl, justifyContent: 'center' },
  digitBox: {
    width: 44, height: 56, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
  },
  digitBoxFilled: { borderColor: 'rgba(34,197,94,0.5)' },
  digitInput: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, width: '100%', height: '100%', textAlign: 'center' },
  changeLink: { alignItems: 'center', marginTop: spacing.lg },
  changeLinkText: { color: colors.textSecondary, fontSize: 14 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/RegisterScreen.tsx
git commit -m "feat: add RegisterScreen with community code + phone + unit + OTP"
```

---

## Task 12: Update LoginScreen — Add Register Link

**Files:**
- Modify: `apps/resident-app/src/screens/LoginScreen.tsx`

- [ ] **Step 1: Add "First time? Register" link**

In `apps/resident-app/src/screens/LoginScreen.tsx`, add the import for `setShowRegister` and a register link at the bottom of the card.

After line 14 (`const login = useAuthStore((s) => s.login);`), add:

```typescript
  const setShowRegister = useAuthStore((s) => s.setShowRegister);
```

After the `changeLink` TouchableOpacity (after line 158, the closing `</>` of the otp step), but still inside the GlowCard, add this block right before the closing `</GlowCard>`:

```typescript
          <TouchableOpacity onPress={() => setShowRegister(true)} style={styles.changeLink}>
            <Text style={styles.registerLinkText}>First time? Register with community code</Text>
          </TouchableOpacity>
```

Add a new style `registerLinkText` to the StyleSheet:

```typescript
  registerLinkText: { color: colors.success, fontSize: 14, fontWeight: '500' },
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/LoginScreen.tsx
git commit -m "feat: add 'First time? Register' link to LoginScreen"
```

---

## Task 13: HomeScreen — Redesign

**Files:**
- Rewrite: `apps/resident-app/src/screens/HomeScreen.tsx`

- [ ] **Step 1: Rewrite HomeScreen with activity feed, quick actions, summary**

Replace the entire file `apps/resident-app/src/screens/HomeScreen.tsx`:

```typescript
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import ActivityItem, { ActivityEvent } from '../components/ActivityItem';
import { getMyUnitEvents, getPasses } from '../api/client';
import { useVehicleStore } from '../store/vehicleStore';
import { useAuthStore } from '../store/authStore';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

interface Props {
  onNavigate?: (tab: string) => void;
}

export default function HomeScreen({ onNavigate }: Props) {
  const user = useAuthStore((s) => s.user);
  const { vehicles, fetch: fetchVehicles } = useVehicleStore();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [activePasses, setActivePasses] = useState(0);
  const [todayStats, setTodayStats] = useState({ entries: 0, visitors: 0, deliveries: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      await fetchVehicles();
      const today = new Date().toISOString().slice(0, 10);
      const [eventRes, passRes] = await Promise.all([
        getMyUnitEvents({ limit: '5' }),
        getPasses(),
      ]);
      const eventData = eventRes.data.data || [];
      setEvents(eventData);

      const passes = Array.isArray(passRes.data.data) ? passRes.data.data : [];
      setActivePasses(passes.filter((p: any) => p.status === 'active').length);

      // Today's stats from events
      const todayEvents = eventData.filter((e: any) =>
        e.timestamp && e.timestamp.startsWith(today)
      );
      setTodayStats({
        entries: todayEvents.filter((e: any) => e.direction !== 'exit').length,
        visitors: passes.filter((p: any) => p.status === 'active' || p.status === 'used').length,
        deliveries: 0,
      });
    } catch { /* silently fail on refresh */ }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const firstName = user?.name?.split(' ')[0] || 'Resident';

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.info} />}
      >
        {/* Header */}
        <AnimatedEntry direction="fade">
          <Text style={styles.greeting}>{getGreeting()}, {firstName}</Text>
          {user?.unitNumber && (
            <Text style={styles.unitBadge}>Unit {user.unitNumber}{user.communityName ? ` · ${user.communityName}` : ''}</Text>
          )}
        </AnimatedEntry>

        {/* Quick Actions */}
        <AnimatedEntry direction="up" delay={100}>
          <View style={styles.quickGrid}>
            <TouchableOpacity style={styles.quickMainWrap} onPress={() => onNavigate?.('visitors')} activeOpacity={0.8}>
              <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.quickMain}>
                <MaterialCommunityIcons name="share-variant" size={24} color={colors.white} />
                <Text style={styles.quickMainText}>Share Visitor Pass</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickItemWrap} onPress={() => onNavigate?.('vehicles')} activeOpacity={0.7}>
              <GlowCard style={styles.quickItem}>
                <MaterialCommunityIcons name="car" size={20} color={colors.info} />
                <Text style={styles.quickItemText}>My Vehicles</Text>
              </GlowCard>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickItemWrap} onPress={() => onNavigate?.('visitors')} activeOpacity={0.7}>
              <GlowCard style={styles.quickItem}>
                <MaterialCommunityIcons name="clock-outline" size={20} color={colors.warning} />
                <Text style={styles.quickItemText}>Expected: {activePasses}</Text>
              </GlowCard>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickItemWrap} onPress={() => onNavigate?.('activity')} activeOpacity={0.7}>
              <GlowCard style={styles.quickItem}>
                <MaterialCommunityIcons name="history" size={20} color={colors.success} />
                <Text style={styles.quickItemText}>Gate History</Text>
              </GlowCard>
            </TouchableOpacity>
          </View>
        </AnimatedEntry>

        {/* Today's Summary */}
        <AnimatedEntry direction="up" delay={200}>
          <GlowCard style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Today's Summary</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryNumber}>{todayStats.entries}</Text>
                <Text style={styles.summaryLabel}>Entries</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryNumber}>{todayStats.visitors}</Text>
                <Text style={styles.summaryLabel}>Visitors</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryNumber}>{vehicles.length}</Text>
                <Text style={styles.summaryLabel}>Vehicles</Text>
              </View>
            </View>
          </GlowCard>
        </AnimatedEntry>

        {/* Live Activity */}
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {events.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="clock-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>No recent activity</Text>
          </View>
        ) : (
          events.map((e, i) => (
            <AnimatedEntry key={e.id} direction="left" delay={300 + i * 80}>
              <TouchableOpacity onPress={() => onNavigate?.('activity')} activeOpacity={0.8}>
                <ActivityItem event={e} />
              </TouchableOpacity>
            </AnimatedEntry>
          ))
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  greeting: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  unitBadge: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.xl },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  quickMainWrap: { width: '100%' },
  quickMain: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    padding: spacing.lg, borderRadius: radius.lg,
  },
  quickMainText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  quickItemWrap: { flex: 1, minWidth: '45%' },
  quickItem: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  quickItemText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  summaryCard: { marginBottom: spacing.xl },
  summaryTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNumber: { fontSize: 28, fontWeight: '800', color: colors.textPrimary },
  summaryLabel: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
  summaryDivider: { width: 1, height: 32, backgroundColor: colors.surfaceBorder },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['3xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/HomeScreen.tsx
git commit -m "feat: redesign HomeScreen with activity feed, quick actions, summary"
```

---

## Task 14: VisitorsScreen (replaces PassesScreen)

**Files:**
- Create: `apps/resident-app/src/screens/VisitorsScreen.tsx`
- Delete: `apps/resident-app/src/screens/PassesScreen.tsx`

- [ ] **Step 1: Create VisitorsScreen**

Create `apps/resident-app/src/screens/VisitorsScreen.tsx`:

```typescript
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Modal, TouchableOpacity, Switch } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import VisitorPassCard, { PassData } from '../components/VisitorPassCard';
import * as api from '../api/client';
import { useAuthStore } from '../store/authStore';

const DURATION_OPTIONS = [
  { label: 'Today', hours: 4 },
  { label: 'Tomorrow', hours: 24 },
  { label: '48h', hours: 48 },
  { label: 'Custom', hours: 0 },
];

export default function VisitorsScreen() {
  const user = useAuthStore((s) => s.user);
  const [passes, setPasses] = useState<PassData[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [byCab, setByCab] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(0);

  const fetchPasses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPasses();
      const data = res.data.data;
      setPasses(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPasses(); }, [fetchPasses]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      const now = new Date();
      const hours = DURATION_OPTIONS[selectedDuration].hours || 24;
      const until = new Date(now.getTime() + hours * 3600000);
      await api.createPass({
        visitor_name: name.trim(),
        visitor_vehicle: byCab ? undefined : vehicle.trim() || undefined,
        valid_from: now.toISOString(),
        valid_until: until.toISOString(),
      });
      setName('');
      setVehicle('');
      setByCab(false);
      setSelectedDuration(0);
      setShowForm(false);
      fetchPasses();
    } catch (err: any) {
      // Alert handled by global error handler if needed
    }
  };

  const handleRevoke = async (id: string) => {
    await api.revokePass(id);
    fetchPasses();
  };

  const activePasses = passes.filter((p) => p.status === 'active');
  const otherPasses = passes.filter((p) => p.status !== 'active');

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Quick Share Bar */}
      <TouchableOpacity onPress={() => setShowForm(true)} activeOpacity={0.8} style={styles.shareBarWrap}>
        <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.shareBar}>
          <MaterialCommunityIcons name="share-variant" size={20} color={colors.white} />
          <Text style={styles.shareBarText}>Share Visitor Pass</Text>
        </LinearGradient>
      </TouchableOpacity>

      <FlatList
        data={[...activePasses, ...otherPasses]}
        keyExtractor={(p) => p.id}
        refreshing={loading}
        onRefresh={fetchPasses}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <AnimatedEntry direction="left" delay={index * 80}>
            <VisitorPassCard
              pass={item}
              residentName={user?.name || 'Resident'}
              unitNumber={user?.unitNumber ? `Unit ${user.unitNumber}` : ''}
              communityName={user?.communityName}
              onRevoke={handleRevoke}
            />
          </AnimatedEntry>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="account-group" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No visitor passes</Text>
            <Text style={styles.emptySubtext}>Tap above to share a pass</Text>
          </View>
        }
      />

      {/* Create Pass Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Visitor Pass</Text>
            <TextInput
              style={styles.input}
              placeholder="Visitor name"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />
            {!byCab && (
              <TextInput
                style={styles.input}
                placeholder="Vehicle number (optional)"
                placeholderTextColor={colors.textMuted}
                value={vehicle}
                onChangeText={setVehicle}
                autoCapitalize="characters"
              />
            )}
            <View style={styles.cabRow}>
              <Text style={styles.cabLabel}>Coming by cab</Text>
              <Switch
                value={byCab}
                onValueChange={setByCab}
                trackColor={{ false: colors.surface, true: colors.successBg }}
                thumbColor={byCab ? colors.success : colors.textMuted}
              />
            </View>

            <Text style={styles.durationLabel}>TIME WINDOW</Text>
            <View style={styles.durationChips}>
              {DURATION_OPTIONS.map((opt, i) => (
                <TouchableOpacity key={i} onPress={() => setSelectedDuration(i)}>
                  {selectedDuration === i ? (
                    <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.durationChip}>
                      <Text style={styles.durationChipTextActive}>{opt.label}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.durationChipInactive}>
                      <Text style={styles.durationChipText}>{opt.label}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={() => setShowForm(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Create" variant="success" icon="ticket-account" onPress={handleCreate} disabled={!name.trim()} />
              </View>
            </View>
          </GlowCard>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  shareBarWrap: { marginHorizontal: spacing.lg, marginTop: spacing.md },
  shareBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.lg,
  },
  shareBarText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  list: { padding: spacing.lg, paddingBottom: 100 },
  emptyState: { alignItems: 'center', gap: spacing.sm, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: colors.textMuted, fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md,
  },
  cabRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  cabLabel: { color: colors.textPrimary, fontSize: 14 },
  durationLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm },
  durationChips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  durationChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  durationChipInactive: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
  },
  durationChipText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  durationChipTextActive: { color: colors.white, fontSize: 14, fontWeight: '600' },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
});
```

- [ ] **Step 2: Delete the old PassesScreen**

Run: `rm apps/resident-app/src/screens/PassesScreen.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/resident-app/src/screens/VisitorsScreen.tsx
git rm apps/resident-app/src/screens/PassesScreen.tsx
git commit -m "feat: replace PassesScreen with VisitorsScreen (WhatsApp sharing + vehicle support)"
```

---

## Task 15: ActivityScreen

**Files:**
- Create: `apps/resident-app/src/screens/ActivityScreen.tsx`

- [ ] **Step 1: Create ActivityScreen with filters**

Create `apps/resident-app/src/screens/ActivityScreen.tsx`:

```typescript
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import AnimatedEntry from '../components/AnimatedEntry';
import ActivityItem, { ActivityEvent } from '../components/ActivityItem';
import { getMyUnitEvents } from '../api/client';

const DATE_FILTERS = ['Today', 'Yesterday', 'This Week'];
const TYPE_FILTERS = ['All', 'Vehicles', 'Visitors'];

function getDateRange(filter: string): { date_from?: string; date_to?: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (filter === 'Today') {
    return { date_from: `${today}T00:00:00.000Z` };
  }
  if (filter === 'Yesterday') {
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    return { date_from: `${yesterday}T00:00:00.000Z`, date_to: `${yesterday}T23:59:59.999Z` };
  }
  if (filter === 'This Week') {
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    return { date_from: `${weekAgo}T00:00:00.000Z` };
  }
  return {};
}

export default function ActivityScreen() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState('Today');
  const [typeFilter, setTypeFilter] = useState('All');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '50', ...getDateRange(dateFilter) };
      if (typeFilter === 'Vehicles') params.detection_method = 'anpr';
      if (typeFilter === 'Visitors') params.detection_method = 'otp';
      const res = await getMyUnitEvents(params);
      setEvents(res.data.data || []);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [dateFilter, typeFilter]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Group events by date
  const grouped: { date: string; events: ActivityEvent[] }[] = [];
  const dateMap = new Map<string, ActivityEvent[]>();
  events.forEach((e) => {
    const date = new Date(e.timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (!dateMap.has(date)) dateMap.set(date, []);
    dateMap.get(date)!.push(e);
  });
  dateMap.forEach((events, date) => grouped.push({ date, events }));

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Filter bar */}
      <View style={styles.filterBar}>
        <View style={styles.filterRow}>
          {DATE_FILTERS.map((f) => (
            <TouchableOpacity key={f} onPress={() => setDateFilter(f)}>
              {dateFilter === f ? (
                <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.filterPill}>
                  <Text style={styles.filterTextActive}>{f}</Text>
                </LinearGradient>
              ) : (
                <View style={styles.filterPillInactive}>
                  <Text style={styles.filterText}>{f}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.filterRow}>
          {TYPE_FILTERS.map((f) => (
            <TouchableOpacity key={f} onPress={() => setTypeFilter(f)}>
              <View style={[styles.chipPill, typeFilter === f && styles.chipPillActive]}>
                <Text style={[styles.chipText, typeFilter === f && styles.chipTextActive]}>{f}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={grouped}
        keyExtractor={(item) => item.date}
        refreshing={loading}
        onRefresh={fetchEvents}
        contentContainerStyle={styles.list}
        renderItem={({ item: group }) => (
          <View>
            <Text style={styles.dateHeader}>{group.date}</Text>
            {group.events.map((e, i) => (
              <AnimatedEntry key={e.id} direction="left" delay={i * 60}>
                <ActivityItem event={e} />
              </AnimatedEntry>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No activity found</Text>
          </View>
        }
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  filterPill: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  filterPillInactive: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
  },
  filterText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  filterTextActive: { color: colors.white, fontSize: 13, fontWeight: '600' },
  chipPill: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipPillActive: { backgroundColor: colors.infoBg },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: colors.info, fontWeight: '600' },
  list: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  dateHeader: {
    fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  emptyState: { alignItems: 'center', marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/ActivityScreen.tsx
git commit -m "feat: add ActivityScreen with date/type filters and grouped timeline"
```

---

## Task 16: VehiclesScreen — Redesign

**Files:**
- Rewrite: `apps/resident-app/src/screens/VehiclesScreen.tsx`

- [ ] **Step 1: Rewrite VehiclesScreen with FASTag status, last entry, info banner**

Replace the entire file `apps/resident-app/src/screens/VehiclesScreen.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, Modal, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import PlateText from '../components/PlateText';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useVehicleStore, Vehicle } from '../store/vehicleStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const typeIcons: Record<string, string> = {
  car: 'car',
  bike: 'motorbike',
  truck: 'truck',
};

const BANNER_KEY = 'communitygate_fastag_banner_dismissed';

function FastagBadge({ vehicle }: { vehicle: Vehicle }) {
  if (vehicle.fastagTidHash) {
    return (
      <View style={[badgeStyles.pill, { backgroundColor: 'rgba(6,182,212,0.15)' }]}>
        <MaterialCommunityIcons name="car-wireless" size={12} color="#06b6d4" />
        <Text style={[badgeStyles.text, { color: '#06b6d4' }]}>FASTag Linked</Text>
      </View>
    );
  }
  return (
    <View style={[badgeStyles.pill, { backgroundColor: colors.surface }]}>
      <Text style={[badgeStyles.text, { color: colors.textMuted }]}>No FASTag</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  text: { fontSize: 10, fontWeight: '700' },
});

export default function VehiclesScreen() {
  const { vehicles, loading, fetch, add, update, remove } = useVehicleStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [type, setType] = useState('car');
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    fetch();
    AsyncStorage.getItem(BANNER_KEY).then((v) => { if (!v) setShowBanner(true); });
  }, []);

  const dismissBanner = () => {
    setShowBanner(false);
    AsyncStorage.setItem(BANNER_KEY, '1').catch(() => {});
  };

  const resetForm = () => { setPlate(''); setMake(''); setModel(''); setType('car'); setEditing(null); setShowForm(false); };

  const openEdit = (v: Vehicle) => {
    setEditing(v); setPlate(v.plate); setMake(v.make); setModel(v.model); setType(v.type); setShowForm(true);
  };

  const handleSave = async () => {
    if (!plate.trim()) { Alert.alert('Error', 'Plate number is required'); return; }
    try {
      if (editing) { await update(editing.id, { plate, make, model, type }); }
      else { await add({ plate, make, model, type }); }
      resetForm();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.error || 'Save failed'); }
  };

  const handleDelete = (v: Vehicle) => {
    Alert.alert('Remove Vehicle', `Remove ${v.plate}? This will unlink any FASTag.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(v.id) },
    ]);
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <FlatList
        data={vehicles}
        keyExtractor={(v) => v.id}
        refreshing={loading}
        onRefresh={fetch}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          showBanner ? (
            <AnimatedEntry direction="fade">
              <GlowCard variant="success" style={styles.bannerCard}>
                <View style={styles.bannerRow}>
                  <MaterialCommunityIcons name="car-wireless" size={24} color={colors.success} />
                  <View style={styles.bannerText}>
                    <Text style={styles.bannerTitle}>Your FASTag links automatically!</Text>
                    <Text style={styles.bannerDesc}>Just drive through the gate — your FASTag will be detected and linked to this vehicle. No setup needed.</Text>
                  </View>
                  <TouchableOpacity onPress={dismissBanner}>
                    <MaterialCommunityIcons name="close" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </GlowCard>
            </AnimatedEntry>
          ) : null
        }
        renderItem={({ item, index }) => {
          const lastEntry = item.lastEntryAt
            ? `Last entered: ${new Date(item.lastEntryAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${new Date(item.lastEntryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '';

          return (
            <AnimatedEntry direction="left" delay={index * 80}>
              <GlowCard style={styles.vehicleCard}>
                <TouchableOpacity onPress={() => openEdit(item)} onLongPress={() => handleDelete(item)} activeOpacity={0.7}>
                  <View style={styles.vehicleRow}>
                    <IconBadge
                      icon={(typeIcons[item.type] || 'car') as any}
                      color={colors.info}
                      gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']}
                      size={40}
                    />
                    <View style={styles.vehicleInfo}>
                      <PlateText plate={item.plate} size="lg" />
                      {(item.make || item.model) ? (
                        <Text style={styles.vehicleDetail}>{item.make} {item.model}</Text>
                      ) : null}
                      {lastEntry ? (
                        <Text style={styles.lastEntry}>{lastEntry}</Text>
                      ) : null}
                    </View>
                    <View style={styles.vehicleMeta}>
                      <FastagBadge vehicle={item} />
                    </View>
                  </View>
                </TouchableOpacity>
              </GlowCard>
            </AnimatedEntry>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="car" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No vehicles registered</Text>
            <Text style={styles.emptySubtext}>Tap + to add your first vehicle</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fabWrap} onPress={() => setShowForm(true)} activeOpacity={0.8}>
        <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.fab}>
          <MaterialCommunityIcons name="plus" size={28} color={colors.white} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Modal Form */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Vehicle' : 'Add Vehicle'}</Text>
            <TextInput style={styles.input} placeholder="Plate number" placeholderTextColor={colors.textMuted} value={plate} onChangeText={setPlate} autoCapitalize="characters" />
            <TextInput style={styles.input} placeholder="Make (optional)" placeholderTextColor={colors.textMuted} value={make} onChangeText={setMake} />
            <TextInput style={styles.input} placeholder="Model (optional)" placeholderTextColor={colors.textMuted} value={model} onChangeText={setModel} />
            <View style={styles.typeChips}>
              {(['car', 'bike', 'truck'] as const).map((t) => (
                <TouchableOpacity key={t} onPress={() => setType(t)}>
                  {type === t ? (
                    <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.chip}>
                      <MaterialCommunityIcons name={(typeIcons[t] || 'car') as any} size={16} color={colors.white} />
                      <Text style={styles.chipTextActive}>{t}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.chipInactive}>
                      <MaterialCommunityIcons name={(typeIcons[t] || 'car') as any} size={16} color={colors.textMuted} />
                      <Text style={styles.chipText}>{t}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={resetForm} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Save" variant="success" icon="check-circle" onPress={handleSave} />
              </View>
            </View>
          </GlowCard>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: 100 },
  bannerCard: { marginBottom: spacing.lg },
  bannerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: colors.success, marginBottom: spacing.xs },
  bannerDesc: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleInfo: { flex: 1, gap: spacing.xs },
  vehicleDetail: { color: colors.textMuted, fontSize: 13 },
  lastEntry: { color: colors.textSecondary, fontSize: 11 },
  vehicleMeta: { alignItems: 'flex-end' },
  emptyState: { alignItems: 'center', gap: spacing.sm, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: colors.textMuted, fontSize: 13 },
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md,
  },
  typeChips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  chipInactive: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  chipText: { color: colors.textMuted, fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: colors.white, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/VehiclesScreen.tsx
git commit -m "feat: redesign VehiclesScreen with FASTag badges, last entry, info banner"
```

---

## Task 17: ProfileScreen

**Files:**
- Create: `apps/resident-app/src/screens/ProfileScreen.tsx`

- [ ] **Step 1: Create ProfileScreen**

Create `apps/resident-app/src/screens/ProfileScreen.tsx`:

```typescript
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { useAuthStore } from '../store/authStore';

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Unit Info Card */}
        <AnimatedEntry direction="fade">
          <GlowCard style={styles.unitCard}>
            <View style={styles.unitHeader}>
              <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(user?.name || 'R').charAt(0).toUpperCase()}
                </Text>
              </LinearGradient>
              <View style={styles.unitInfo}>
                <Text style={styles.unitName}>{user?.name || 'Resident'}</Text>
                <Text style={styles.unitDetail}>Unit {user?.unitNumber || '-'}</Text>
                {user?.communityName ? (
                  <Text style={styles.communityName}>{user.communityName}</Text>
                ) : null}
              </View>
            </View>
          </GlowCard>
        </AnimatedEntry>

        {/* Contact Details */}
        <AnimatedEntry direction="up" delay={100}>
          <GlowCard style={styles.detailsCard}>
            <Text style={styles.sectionTitle}>Contact Details</Text>
            <View style={styles.detailRow}>
              <MaterialCommunityIcons name="phone" size={18} color={colors.textMuted} />
              <Text style={styles.detailText}>{user?.phone || '-'}</Text>
            </View>
          </GlowCard>
        </AnimatedEntry>

        {/* App Info */}
        <AnimatedEntry direction="up" delay={200}>
          <GlowCard style={styles.detailsCard}>
            <Text style={styles.sectionTitle}>About</Text>
            <View style={styles.detailRow}>
              <MaterialCommunityIcons name="information" size={18} color={colors.textMuted} />
              <Text style={styles.detailText}>CommunityGate Resident App v1.0</Text>
            </View>
          </GlowCard>
        </AnimatedEntry>

        {/* Logout */}
        <AnimatedEntry direction="up" delay={300}>
          <View style={styles.logoutSection}>
            <GradientButton title="Logout" icon="logout" variant="danger" onPress={logout} />
          </View>
        </AnimatedEntry>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  unitCard: { marginBottom: spacing.lg },
  unitHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24, fontWeight: '800', color: colors.white },
  unitInfo: { flex: 1 },
  unitName: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  unitDetail: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  communityName: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  detailsCard: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailText: { fontSize: 14, color: colors.textMuted },
  logoutSection: { marginTop: spacing.xl },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/ProfileScreen.tsx
git commit -m "feat: add ProfileScreen with unit info + logout"
```

---

## Task 18: Navigation — 5-Tab Layout + Register Flow

**Files:**
- Rewrite: `apps/resident-app/app/index.tsx`
- Delete: `apps/resident-app/src/screens/NotificationsScreen.tsx`

- [ ] **Step 1: Rewrite app/index.tsx with 5-tab navigation and register routing**

Replace the entire file `apps/resident-app/app/index.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/authStore';
import { colors } from '../src/theme/colors';
import { spacing } from '../src/theme/spacing';
import LoginScreen from '../src/screens/LoginScreen';
import RegisterScreen from '../src/screens/RegisterScreen';
import HomeScreen from '../src/screens/HomeScreen';
import VehiclesScreen from '../src/screens/VehiclesScreen';
import VisitorsScreen from '../src/screens/VisitorsScreen';
import ActivityScreen from '../src/screens/ActivityScreen';
import ProfileScreen from '../src/screens/ProfileScreen';

type TabKey = 'home' | 'visitors' | 'vehicles' | 'activity' | 'profile';

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'visitors', label: 'Visitors', icon: 'account-group' },
  { key: 'vehicles', label: 'Vehicles', icon: 'car' },
  { key: 'activity', label: 'Activity', icon: 'history' },
  { key: 'profile', label: 'Profile', icon: 'account' },
];

function TabBar({ active, onSelect }: { active: TabKey; onSelect: (key: TabKey) => void }) {
  return (
    <View style={tabStyles.bar}>
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <TouchableOpacity key={tab.key} style={tabStyles.tab} onPress={() => onSelect(tab.key)} activeOpacity={0.7}>
            {isActive && (
              <LinearGradient
                colors={colors.gradientPrimary as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={tabStyles.indicator}
              />
            )}
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={22}
              color={isActive ? colors.textPrimary : colors.textMuted}
            />
            <Text style={[tabStyles.label, isActive && tabStyles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ResidentApp() {
  const [tab, setTab] = useState<TabKey>('home');

  const handleNavigate = (target: string) => {
    if (tabs.some((t) => t.key === target)) {
      setTab(target as TabKey);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      {/* Content */}
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen onNavigate={handleNavigate} />}
        {tab === 'visitors' && <VisitorsScreen />}
        {tab === 'vehicles' && <VehiclesScreen />}
        {tab === 'activity' && <ActivityScreen />}
        {tab === 'profile' && <ProfileScreen />}
      </View>

      {/* Tab Bar */}
      <TabBar active={tab} onSelect={setTab} />
    </View>
  );
}

export default function Page() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const showRegister = useAuthStore((s) => s.showRegister);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  useEffect(() => { rehydrate(); }, []);

  if (isLoading) {
    return (
      <LinearGradient colors={colors.gradientBg} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.info} />
      </LinearGradient>
    );
  }

  if (!isAuthenticated) {
    return showRegister ? <RegisterScreen /> : <LoginScreen />;
  }

  return <ResidentApp />;
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing.sm,
    gap: 2,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: '20%',
    right: '20%',
    height: 2,
    borderRadius: 1,
  },
  label: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '500',
  },
  labelActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
```

- [ ] **Step 2: Delete the old NotificationsScreen**

Run: `rm apps/resident-app/src/screens/NotificationsScreen.tsx`

- [ ] **Step 3: Verify the app compiles**

Run: `cd apps/resident-app && npx expo export --platform web --output-dir /tmp/resident-app-check 2>&1 | tail -5`
Expected: Build completes without import errors.

- [ ] **Step 4: Commit**

```bash
git add app/index.tsx
git rm apps/resident-app/src/screens/NotificationsScreen.tsx
git add -A apps/resident-app/
git commit -m "feat: 5-tab navigation + register flow, remove old Notifications/Passes screens"
```

---

## Task 19: Final Cleanup & Verification

- [ ] **Step 1: Verify all imports resolve**

Run: `cd apps/resident-app && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (or only pre-existing ones unrelated to our changes).

- [ ] **Step 2: Verify API gateway starts cleanly**

Run: `cd services/api-gateway && node -e "import('./src/index.js').catch(e => console.error(e.message))" 2>&1 | head -5`
Expected: Server starts without import errors.

- [ ] **Step 3: Run the migration if not already applied**

Run: `docker compose exec postgres psql -U communitygate -d communitygate -c "SELECT invite_code FROM communities LIMIT 1;"`
Expected: Returns a row with an invite_code value.

- [ ] **Step 4: Smoke test — verify seed community has invite code**

Run: `docker compose exec postgres psql -U communitygate -d communitygate -c "SELECT name, invite_code FROM communities;"`
Expected: Palm Meadows has a non-null invite_code.

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: final cleanup for resident app redesign"
```
