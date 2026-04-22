# Recurring Visitor Passes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Residents create recurring passes for daily visitors (maid, cook, tutor). Guards see an "Expected Now" panel, tap "Arrived" with photo capture. Same visitor across multiple flats is grouped — one tap marks all.

**Architecture:** Two new DB tables (recurring_passes + expected_visits). CRUD API for passes, expected visits API for guards with photo upload. Daily cron generates expected visit rows. Guard app gets an ExpectedVisitors component in ToolsPanel. Resident app gets a recurring section in VisitorsScreen.

**Tech Stack:** Node.js/Express (ESM), PostgreSQL, multer (file upload), node-cron, expo-image-picker (camera), React Native/Expo

**Spec:** `docs/superpowers/specs/2026-04-22-recurring-passes-design.md`

---

## File Structure

### Backend (API Gateway)
| Action | File | Responsibility |
|--------|------|----------------|
| Create | `services/api-gateway/migrations/012_recurring_passes.sql` | Two new tables + indexes |
| Create | `services/api-gateway/src/routes/recurring-passes.js` | CRUD for recurring passes (resident) |
| Create | `services/api-gateway/src/routes/expected-visits.js` | Expected list, mark arrived, photo upload (guard) |
| Create | `services/api-gateway/src/cron/generate-visits.js` | Daily generation logic + cron schedule |
| Modify | `services/api-gateway/src/index.js` | Mount new routes + start cron |
| Modify | `services/api-gateway/package.json` | Add node-cron dependency |

### Guard App
| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/guard-app/src/components/ExpectedVisitors.tsx` | Expected visitors panel with camera + arrived |
| Modify | `apps/guard-app/src/components/ToolsPanel.tsx` | Add ExpectedVisitors component |
| Modify | `apps/guard-app/src/api/client.ts` | Add getExpectedVisits + markArrived functions |

### Resident App
| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/resident-app/src/components/RecurringPassCard.tsx` | Display a recurring pass with today's status |
| Modify | `apps/resident-app/src/screens/VisitorsScreen.tsx` | Add recurring visitors section + create form |
| Modify | `apps/resident-app/src/api/client.ts` | Add recurring pass CRUD functions |

---

## Task 1: Database Migration

**Files:**
- Create: `services/api-gateway/migrations/012_recurring_passes.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 012_recurring_passes.sql
-- Recurring visitor passes + daily expected visits

CREATE TABLE IF NOT EXISTS recurring_passes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL REFERENCES communities(id),
  unit_id         UUID NOT NULL REFERENCES units(id),
  created_by      UUID NOT NULL REFERENCES residents(id),
  visitor_name    VARCHAR(200) NOT NULL,
  visitor_name_normalized VARCHAR(200) NOT NULL,
  visitor_role    VARCHAR(50),
  schedule_type   VARCHAR(20) NOT NULL,
  schedule_days   SMALLINT[],
  time_from       TIME NOT NULL,
  time_until      TIME NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recurring_active ON recurring_passes(community_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS expected_visits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_pass_id UUID NOT NULL REFERENCES recurring_passes(id),
  community_id    UUID NOT NULL REFERENCES communities(id),
  unit_id         UUID NOT NULL,
  visit_date      DATE NOT NULL,
  time_from       TIME NOT NULL,
  time_until      TIME NOT NULL,
  visitor_name_normalized VARCHAR(200) NOT NULL,
  visitor_role    VARCHAR(50),
  status          VARCHAR(20) NOT NULL DEFAULT 'expected',
  arrived_at      TIMESTAMPTZ,
  marked_by       UUID,
  photo_url       VARCHAR(500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expected_today ON expected_visits(community_id, visit_date, status);
CREATE INDEX idx_expected_name ON expected_visits(community_id, visit_date, visitor_name_normalized)
  WHERE status = 'expected';
```

- [ ] **Step 2: Run migration locally**

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U cguser -d communitygate -f /dev/stdin < services/api-gateway/migrations/012_recurring_passes.sql
```

Expected: `CREATE TABLE` x2, `CREATE INDEX` x3.

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/migrations/012_recurring_passes.sql
git commit -m "feat: add recurring_passes and expected_visits tables"
```

---

## Task 2: Daily Visit Generation (Cron)

**Files:**
- Create: `services/api-gateway/src/cron/generate-visits.js`
- Modify: `services/api-gateway/package.json`

- [ ] **Step 1: Install node-cron**

```bash
cd services/api-gateway && npm install node-cron
```

- [ ] **Step 2: Create generation logic**

Create `services/api-gateway/src/cron/generate-visits.js`:

```javascript
import cron from 'node-cron';
import { query, queryRows } from '../db/queries.js';

/**
 * Check if today (day of week) matches a recurring pass schedule.
 * @param {string} scheduleType - daily, weekday, weekly, custom
 * @param {number[]|null} scheduleDays - array of day numbers (0=Sun..6=Sat)
 * @returns {boolean}
 */
function matchesToday(scheduleType, scheduleDays) {
  const today = new Date().getDay(); // 0=Sun, 1=Mon...6=Sat
  switch (scheduleType) {
    case 'daily':
      return true;
    case 'weekday':
      return today >= 1 && today <= 5;
    case 'weekly':
    case 'custom':
      return Array.isArray(scheduleDays) && scheduleDays.includes(today);
    default:
      return false;
  }
}

/**
 * Generate expected_visits for today from all active recurring_passes.
 * Skips passes that already have a visit generated for today.
 * Also marks yesterday's unresolved 'expected' as 'missed'.
 */
export async function generateExpectedVisits() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  try {
    // Mark yesterday's unresolved expected visits as missed
    const missed = await query(
      `UPDATE expected_visits SET status = 'missed'
       WHERE visit_date = $1 AND status = 'expected'
       RETURNING id`,
      [yesterday]
    );
    if (missed.length > 0) {
      console.log(`[Cron] Marked ${missed.length} visits as missed for ${yesterday}`);
    }

    // Get all active recurring passes
    const passes = await queryRows(
      `SELECT rp.*, u.unit_number
       FROM recurring_passes rp
       JOIN units u ON u.id = rp.unit_id
       WHERE rp.status = 'active'`
    );

    let generated = 0;

    for (const pass of passes) {
      // Check if today matches schedule
      if (!matchesToday(pass.schedule_type, pass.schedule_days)) continue;

      // Skip if already generated for today
      const existing = await query(
        `SELECT id FROM expected_visits
         WHERE recurring_pass_id = $1 AND visit_date = $2`,
        [pass.id, today]
      );
      if (existing.length > 0) continue;

      // Generate expected visit
      await query(
        `INSERT INTO expected_visits
           (recurring_pass_id, community_id, unit_id, visit_date,
            time_from, time_until, visitor_name_normalized, visitor_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [pass.id, pass.community_id, pass.unit_id, today,
         pass.time_from, pass.time_until, pass.visitor_name_normalized, pass.visitor_role]
      );
      generated++;
    }

    if (generated > 0) {
      console.log(`[Cron] Generated ${generated} expected visits for ${today}`);
    }
  } catch (err) {
    console.error('[Cron] Generate visits error:', err);
  }
}

/**
 * Start the daily cron job. Also runs immediately on startup.
 */
export function startVisitCron() {
  // Generate on startup
  generateExpectedVisits();

  // Run daily at 00:05
  cron.schedule('5 0 * * *', () => {
    console.log('[Cron] Running daily visit generation');
    generateExpectedVisits();
  });

  console.log('[Cron] Visit generation cron scheduled (daily 00:05)');
}
```

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/src/cron/generate-visits.js services/api-gateway/package.json services/api-gateway/package-lock.json
git commit -m "feat: daily expected visit generation with node-cron"
```

---

## Task 3: Recurring Passes API (Resident CRUD)

**Files:**
- Create: `services/api-gateway/src/routes/recurring-passes.js`

- [ ] **Step 1: Create recurring passes route file**

Create `services/api-gateway/src/routes/recurring-passes.js`:

```javascript
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { generateExpectedVisits } from '../cron/generate-visits.js';

const router = Router();

const VALID_ROLES = ['maid', 'cook', 'driver', 'tutor', 'newspaper', 'other'];

const createSchema = z.object({
  visitor_name: z.string().min(1).max(200),
  visitor_role: z.enum(VALID_ROLES).optional(),
  schedule_type: z.enum(['daily', 'weekday', 'weekly', 'custom']),
  schedule_days: z.array(z.number().min(0).max(6)).optional(),
  time_from: z.string().regex(/^\d{2}:\d{2}$/),
  time_until: z.string().regex(/^\d{2}:\d{2}$/),
});

const updateSchema = z.object({
  visitor_name: z.string().min(1).max(200).optional(),
  visitor_role: z.enum(VALID_ROLES).optional(),
  schedule_type: z.enum(['daily', 'weekday', 'weekly', 'custom']).optional(),
  schedule_days: z.array(z.number().min(0).max(6)).optional(),
  time_from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  time_until: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

function normalize(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// -- POST /recurring-passes (resident JWT) -----------------------------------

router.post('/recurring-passes', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { visitor_name, visitor_role, schedule_type, schedule_days, time_from, time_until } = parsed.data;
    const user = req.user;

    // Validate schedule_days for weekly/custom
    if ((schedule_type === 'weekly' || schedule_type === 'custom') && (!schedule_days || schedule_days.length === 0)) {
      return error(res, 'schedule_days required for weekly/custom schedule', 400);
    }

    const pass = await queryOne(
      `INSERT INTO recurring_passes
         (community_id, unit_id, created_by, visitor_name, visitor_name_normalized,
          visitor_role, schedule_type, schedule_days, time_from, time_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [user.community_id, user.unit_id, user.sub, visitor_name, normalize(visitor_name),
       visitor_role || null, schedule_type, schedule_days || null, time_from, time_until]
    );

    // Generate today's expected visit if schedule matches
    await generateExpectedVisits();

    return success(res, pass, 201);
  } catch (err) {
    console.error('POST /recurring-passes error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /recurring-passes (resident JWT) ------------------------------------

router.get('/recurring-passes', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const today = new Date().toISOString().slice(0, 10);

    const passes = await queryRows(
      `SELECT rp.*,
              ev.status AS today_status,
              ev.arrived_at AS today_arrived_at,
              ev.photo_url AS today_photo_url
       FROM recurring_passes rp
       LEFT JOIN expected_visits ev
         ON ev.recurring_pass_id = rp.id AND ev.visit_date = $3
       WHERE rp.unit_id = $1 AND rp.status != 'cancelled'
       ORDER BY rp.created_at DESC`,
      [user.unit_id, user.community_id, today]
    );

    return success(res, passes);
  } catch (err) {
    console.error('GET /recurring-passes error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /recurring-passes/:id (resident JWT) --------------------------------

router.put('/recurring-passes/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const passId = req.params.id;
    const user = req.user;

    // Verify ownership
    const existing = await queryOne(
      'SELECT id FROM recurring_passes WHERE id = $1 AND created_by = $2',
      [passId, user.sub]
    );
    if (!existing) {
      return error(res, 'Pass not found', 404);
    }

    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;

    const data = parsed.data;
    if (data.visitor_name) {
      fields.push(`visitor_name = $${idx}`, `visitor_name_normalized = $${idx + 1}`);
      values.push(data.visitor_name, normalize(data.visitor_name));
      idx += 2;
    }
    if (data.visitor_role) { fields.push(`visitor_role = $${idx}`); values.push(data.visitor_role); idx++; }
    if (data.schedule_type) { fields.push(`schedule_type = $${idx}`); values.push(data.schedule_type); idx++; }
    if (data.schedule_days) { fields.push(`schedule_days = $${idx}`); values.push(data.schedule_days); idx++; }
    if (data.time_from) { fields.push(`time_from = $${idx}`); values.push(data.time_from); idx++; }
    if (data.time_until) { fields.push(`time_until = $${idx}`); values.push(data.time_until); idx++; }
    if (data.status) { fields.push(`status = $${idx}`); values.push(data.status); idx++; }

    if (fields.length === 0) {
      return error(res, 'No fields to update', 400);
    }

    values.push(passId);
    const updated = await queryOne(
      `UPDATE recurring_passes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return success(res, updated);
  } catch (err) {
    console.error('PUT /recurring-passes/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /recurring-passes/:id (resident JWT) -----------------------------

router.delete('/recurring-passes/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const passId = req.params.id;
    const user = req.user;

    const existing = await queryOne(
      'SELECT id FROM recurring_passes WHERE id = $1 AND created_by = $2',
      [passId, user.sub]
    );
    if (!existing) {
      return error(res, 'Pass not found', 404);
    }

    // Cancel the pass
    await query(
      "UPDATE recurring_passes SET status = 'cancelled' WHERE id = $1",
      [passId]
    );

    // Delete future expected visits (keep historical arrived records)
    await query(
      `DELETE FROM expected_visits
       WHERE recurring_pass_id = $1 AND visit_date >= CURRENT_DATE AND status = 'expected'`,
      [passId]
    );

    return success(res, { cancelled: true });
  } catch (err) {
    console.error('DELETE /recurring-passes/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/routes/recurring-passes.js
git commit -m "feat: recurring passes CRUD API (create, list, update, cancel)"
```

---

## Task 4: Expected Visits API (Guard + Photo Upload)

**Files:**
- Create: `services/api-gateway/src/routes/expected-visits.js`

- [ ] **Step 1: Create expected visits route file**

Create `services/api-gateway/src/routes/expected-visits.js`:

```javascript
import { Router } from 'express';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const router = Router();

// Photo upload config
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/opt/communitygate/uploads/visits';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const dir = path.join(UPLOAD_DIR, month);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, _file, cb) => {
    cb(null, `${req.params.id}.jpg`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

// -- GET /expected-visits (guard JWT) ----------------------------------------

router.get('/expected-visits', authenticateJWT(['guard']), async (req, res) => {
  try {
    const communityId = req.user.community_id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // Get all expected visits for the date, joined with pass info
    const visits = await queryRows(
      `SELECT ev.*, rp.visitor_name, rp.visitor_role, u.unit_number
       FROM expected_visits ev
       JOIN recurring_passes rp ON rp.id = ev.recurring_pass_id
       JOIN units u ON u.id = ev.unit_id
       WHERE ev.community_id = $1 AND ev.visit_date = $2
       ORDER BY ev.time_from, rp.visitor_name`,
      [communityId, date]
    );

    // Group by visitor_name_normalized + visitor_role
    const expectedMap = new Map();
    const arrivedList = [];

    for (const v of visits) {
      if (v.status === 'arrived') {
        arrivedList.push({
          visitor_name: v.visitor_name,
          visitor_role: v.visitor_role,
          unit_number: v.unit_number,
          arrived_at: v.arrived_at,
          photo_url: v.photo_url,
        });
        continue;
      }

      if (v.status !== 'expected') continue;

      const key = `${v.visitor_name_normalized}:${v.visitor_role || ''}`;
      if (!expectedMap.has(key)) {
        expectedMap.set(key, {
          id: v.id, // first visit ID (used for marking arrived)
          visitor_name: v.visitor_name,
          visitor_role: v.visitor_role,
          units: [],
          visit_ids: [],
          time_from: v.time_from,
          time_until: v.time_until,
        });
      }
      const group = expectedMap.get(key);
      group.units.push(v.unit_number);
      group.visit_ids.push(v.id);
    }

    return success(res, {
      expected: Array.from(expectedMap.values()),
      arrived: arrivedList,
    });
  } catch (err) {
    console.error('GET /expected-visits error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /expected-visits/:id/arrived (guard JWT) ---------------------------

router.post('/expected-visits/:id/arrived', authenticateJWT(['guard']), upload.single('photo'), async (req, res) => {
  try {
    const visitId = req.params.id;
    const guardId = req.user.sub;
    const communityId = req.user.community_id;

    // Find the target visit
    const visit = await queryOne(
      `SELECT ev.*, rp.visitor_name
       FROM expected_visits ev
       JOIN recurring_passes rp ON rp.id = ev.recurring_pass_id
       WHERE ev.id = $1 AND ev.community_id = $2`,
      [visitId, communityId]
    );

    if (!visit) {
      return error(res, 'Expected visit not found', 404);
    }

    // Build photo URL if uploaded
    let photoUrl = null;
    if (req.file) {
      const month = new Date().toISOString().slice(0, 7);
      photoUrl = `/uploads/visits/${month}/${visitId}.jpg`;
    }

    // Find ALL matching expected visits (same person, same day, same community)
    const matched = await queryRows(
      `SELECT ev.id, u.unit_number
       FROM expected_visits ev
       JOIN units u ON u.id = ev.unit_id
       WHERE ev.community_id = $1
         AND ev.visit_date = $2
         AND ev.visitor_name_normalized = $3
         AND ($4::varchar IS NULL OR ev.visitor_role = $4 OR ev.visitor_role IS NULL)
         AND ev.status = 'expected'`,
      [communityId, visit.visit_date, visit.visitor_name_normalized, visit.visitor_role]
    );

    // Mark all as arrived
    const ids = matched.map((m) => m.id);
    if (ids.length > 0) {
      await query(
        `UPDATE expected_visits
         SET status = 'arrived', arrived_at = NOW(), marked_by = $1, photo_url = $2
         WHERE id = ANY($3)`,
        [guardId, photoUrl, ids]
      );
    }

    return success(res, {
      marked: ids.length,
      units: matched.map((m) => m.unit_number),
      photo_url: photoUrl,
      visitor_name: visit.visitor_name,
    });
  } catch (err) {
    console.error('POST /expected-visits/:id/arrived error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/routes/expected-visits.js
git commit -m "feat: expected visits API — guard list, mark arrived, photo upload"
```

---

## Task 5: Mount Routes + Start Cron

**Files:**
- Modify: `services/api-gateway/src/index.js`

- [ ] **Step 1: Add imports and mount routes**

In `services/api-gateway/src/index.js`:

Add imports after the existing approvalRoutes import (after line 15):

```javascript
import recurringPassRoutes from './routes/recurring-passes.js';
import expectedVisitRoutes from './routes/expected-visits.js';
import { startVisitCron } from './cron/generate-visits.js';
```

Add route mounts after the approvalRoutes mount (after line 46):

```javascript
app.use('/api/v1', recurringPassRoutes);
app.use('/api/v1', expectedVisitRoutes);
```

Add static file serving for uploads, before the error handler (before `app.use(errorHandler)`):

```javascript
// Serve uploaded visit photos
import { fileURLToPath } from 'url';
import expressStatic from 'express';
const UPLOAD_BASE = process.env.UPLOAD_DIR || '/opt/communitygate/uploads';
app.use('/uploads', express.static(UPLOAD_BASE));
```

Start cron inside the server block (after `server.listen`):

```javascript
    startVisitCron();
```

- [ ] **Step 2: Verify server starts**

```bash
cd services/api-gateway
DATABASE_URL=postgresql://cguser:devpass@localhost:5432/communitygate \
JWT_SECRET=dev-secret-do-not-use-in-prod \
REDIS_URL=redis://localhost:6379 \
PORT_API_GATEWAY=3000 \
node src/index.js
```

Expected: `API Gateway listening on port 3000` + `[Cron] Visit generation cron scheduled` with no errors.

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/src/index.js
git commit -m "feat: mount recurring pass routes + start daily visit cron"
```

---

## Task 6: Guard App — API Client + ExpectedVisitors Component

**Files:**
- Modify: `apps/guard-app/src/api/client.ts`
- Create: `apps/guard-app/src/components/ExpectedVisitors.tsx`
- Modify: `apps/guard-app/src/components/ToolsPanel.tsx`

- [ ] **Step 1: Add API functions to guard client**

In `apps/guard-app/src/api/client.ts`, add after the existing `getApproval` function:

```typescript
// Expected visits (recurring visitors)
export const getExpectedVisits = (date?: string) =>
  api.get('/expected-visits', { params: date ? { date } : undefined });

export const markVisitArrived = (id: string, photo?: FormData) => {
  if (photo) {
    return api.post(`/expected-visits/${id}/arrived`, photo, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }
  return api.post(`/expected-visits/${id}/arrived`);
};
```

- [ ] **Step 2: Create ExpectedVisitors component**

Create `apps/guard-app/src/components/ExpectedVisitors.tsx`:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import AnimatedEntry from './AnimatedEntry';
import { getExpectedVisits, markVisitArrived } from '../api/client';

interface ExpectedGroup {
  id: string;
  visitor_name: string;
  visitor_role: string | null;
  units: string[];
  visit_ids: string[];
  time_from: string;
  time_until: string;
}

interface ArrivedEntry {
  visitor_name: string;
  visitor_role: string | null;
  unit_number: string;
  arrived_at: string;
  photo_url: string | null;
}

const ROLE_ICONS: Record<string, string> = {
  maid: 'broom',
  cook: 'chef-hat',
  driver: 'car',
  tutor: 'book-open-variant',
  newspaper: 'newspaper',
  other: 'account',
};

function formatTime(time: string) {
  const [h, m] = time.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

export default function ExpectedVisitors() {
  const [expected, setExpected] = useState<ExpectedGroup[]>([]);
  const [arrived, setArrived] = useState<ArrivedEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);

  const fetchVisits = useCallback(async () => {
    try {
      const res = await getExpectedVisits();
      const data = res.data.data;
      setExpected(data.expected || []);
      setArrived(data.arrived || []);
    } catch {
      // Silently fail — not critical
    }
  }, []);

  useEffect(() => {
    fetchVisits();
    const interval = setInterval(fetchVisits, 60000); // Poll every 60s
    return () => clearInterval(interval);
  }, [fetchVisits]);

  const handleArrived = async (group: ExpectedGroup) => {
    try {
      // Open camera
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Camera access is needed to take visitor photo');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        allowsEditing: false,
        aspect: [4, 3],
      });

      if (result.canceled) return;

      setLoading(group.id);

      const photo = result.assets[0];
      const formData = new FormData();
      formData.append('photo', {
        uri: photo.uri,
        type: 'image/jpeg',
        name: `${group.id}.jpg`,
      } as any);

      const res = await markVisitArrived(group.id, formData);
      const data = res.data.data;

      Alert.alert('Arrived', `${data.visitor_name} marked — ${data.marked} unit(s)`);
      fetchVisits();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error?.message || 'Failed to mark arrived');
    } finally {
      setLoading(null);
    }
  };

  if (expected.length === 0 && arrived.length === 0) {
    return null; // Hide panel when no expected visitors
  }

  return (
    <GlowCard style={styles.card}>
      <Text style={styles.label}>EXPECTED NOW ({expected.length})</Text>

      {expected.map((group, i) => {
        const icon = ROLE_ICONS[group.visitor_role || 'other'] || 'account';
        return (
          <AnimatedEntry key={group.id} direction="fade" delay={i * 50}>
            <View style={styles.visitorRow}>
              <MaterialCommunityIcons name={icon as any} size={20} color={colors.info} />
              <View style={styles.visitorInfo}>
                <Text style={styles.visitorName}>
                  {group.visitor_name}
                  {group.visitor_role ? ` · ${group.visitor_role}` : ''}
                </Text>
                <Text style={styles.visitorDetail}>
                  {group.units.length > 1 ? `Flats: ${group.units.join(', ')}` : `Flat ${group.units[0]}`}
                </Text>
                <Text style={styles.visitorTime}>
                  {formatTime(group.time_from)} - {formatTime(group.time_until)}
                </Text>
              </View>
              <View style={{ width: 90 }}>
                <GradientButton
                  title="Arrived"
                  icon="camera"
                  variant="success"
                  onPress={() => handleArrived(group)}
                  loading={loading === group.id}
                />
              </View>
            </View>
          </AnimatedEntry>
        );
      })}

      {arrived.length > 0 && (
        <>
          <Text style={[styles.label, { marginTop: spacing.md }]}>ARRIVED TODAY ({arrived.length})</Text>
          {arrived.map((entry, i) => {
            const time = new Date(entry.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <View key={`arrived-${i}`} style={styles.arrivedRow}>
                <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
                <Text style={styles.arrivedText}>
                  {entry.visitor_name} · Flat {entry.unit_number} · {time}
                </Text>
              </View>
            );
          })}
        </>
      )}
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  visitorRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  visitorInfo: { flex: 1, gap: 2 },
  visitorName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  visitorDetail: { fontSize: 12, color: colors.textSecondary },
  visitorTime: { fontSize: 11, color: colors.textMuted },
  arrivedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  arrivedText: { fontSize: 12, color: colors.textMuted },
});
```

- [ ] **Step 3: Add ExpectedVisitors to ToolsPanel**

In `apps/guard-app/src/components/ToolsPanel.tsx`, add import after line 10:

```typescript
import ExpectedVisitors from './ExpectedVisitors';
```

Add the component in the ScrollView, after `<OTPInput />` (after line 70):

```tsx
      <ExpectedVisitors />
```

- [ ] **Step 4: Commit**

```bash
git add apps/guard-app/src/api/client.ts apps/guard-app/src/components/ExpectedVisitors.tsx apps/guard-app/src/components/ToolsPanel.tsx
git commit -m "feat: guard app expected visitors panel with camera capture"
```

---

## Task 7: Resident App — API Client + RecurringPassCard

**Files:**
- Modify: `apps/resident-app/src/api/client.ts`
- Create: `apps/resident-app/src/components/RecurringPassCard.tsx`

- [ ] **Step 1: Add API functions to resident client**

In `apps/resident-app/src/api/client.ts`, add after the `respondToApproval` function:

```typescript
// Recurring passes
export const getRecurringPasses = () => api.get('/recurring-passes');

export const createRecurringPass = (data: {
  visitor_name: string;
  visitor_role?: string;
  schedule_type: string;
  schedule_days?: number[];
  time_from: string;
  time_until: string;
}) => api.post('/recurring-passes', data);

export const updateRecurringPass = (id: string, data: Record<string, any>) =>
  api.put(`/recurring-passes/${id}`, data);

export const cancelRecurringPass = (id: string) =>
  api.delete(`/recurring-passes/${id}`);
```

- [ ] **Step 2: Create RecurringPassCard component**

Create `apps/resident-app/src/components/RecurringPassCard.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';

export interface RecurringPassData {
  id: string;
  visitor_name: string;
  visitor_role: string | null;
  schedule_type: string;
  schedule_days: number[] | null;
  time_from: string;
  time_until: string;
  status: string;
  today_status: string | null;
  today_arrived_at: string | null;
  today_photo_url: string | null;
}

interface Props {
  pass: RecurringPassData;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ROLE_ICONS: Record<string, string> = {
  maid: 'broom',
  cook: 'chef-hat',
  driver: 'car',
  tutor: 'book-open-variant',
  newspaper: 'newspaper',
  other: 'account',
};

function formatTime(time: string) {
  const [h, m] = time.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function scheduleLabel(type: string, days: number[] | null) {
  switch (type) {
    case 'daily': return 'Every day';
    case 'weekday': return 'Mon - Fri';
    case 'weekly':
    case 'custom':
      return days ? days.map((d) => DAY_LABELS[d]).join(', ') : type;
    default: return type;
  }
}

export default function RecurringPassCard({ pass, onPause, onResume, onCancel }: Props) {
  const icon = ROLE_ICONS[pass.visitor_role || 'other'] || 'account';
  const isPaused = pass.status === 'paused';

  return (
    <GlowCard style={styles.card}>
      <View style={styles.header}>
        <MaterialCommunityIcons name={icon as any} size={22} color={colors.info} />
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{pass.visitor_name}</Text>
          {pass.visitor_role && (
            <Text style={styles.role}>{pass.visitor_role}</Text>
          )}
        </View>
        {isPaused && (
          <View style={styles.pausedBadge}>
            <Text style={styles.pausedText}>PAUSED</Text>
          </View>
        )}
      </View>

      <Text style={styles.schedule}>
        {scheduleLabel(pass.schedule_type, pass.schedule_days)} · {formatTime(pass.time_from)} - {formatTime(pass.time_until)}
      </Text>

      {/* Today's status */}
      {pass.today_status === 'arrived' && pass.today_arrived_at && (
        <View style={styles.arrivedRow}>
          <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
          <Text style={styles.arrivedText}>
            Arrived at {new Date(pass.today_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      )}
      {pass.today_status === 'expected' && (
        <View style={styles.arrivedRow}>
          <MaterialCommunityIcons name="clock-outline" size={16} color={colors.warning} />
          <Text style={[styles.arrivedText, { color: colors.warning }]}>Expected today</Text>
        </View>
      )}

      <View style={styles.actions}>
        {isPaused ? (
          <GradientButton title="Resume" icon="play" variant="success" onPress={() => onResume(pass.id)} />
        ) : (
          <GradientButton title="Pause" icon="pause" variant="primary" onPress={() => onPause(pass.id)} />
        )}
        <GradientButton title="Cancel" icon="close" variant="danger" onPress={() => onCancel(pass.id)} />
      </View>
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerInfo: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  role: { fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize' },
  pausedBadge: { backgroundColor: colors.warningBg, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  pausedText: { fontSize: 10, fontWeight: '700', color: colors.warning },
  schedule: { fontSize: 13, color: colors.textMuted },
  arrivedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  arrivedText: { fontSize: 13, color: colors.success, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/resident-app/src/api/client.ts apps/resident-app/src/components/RecurringPassCard.tsx
git commit -m "feat: resident app recurring pass API client + card component"
```

---

## Task 8: Resident App — VisitorsScreen Recurring Section + Form

**Files:**
- Modify: `apps/resident-app/src/screens/VisitorsScreen.tsx`

- [ ] **Step 1: Update VisitorsScreen with recurring section and form**

In `apps/resident-app/src/screens/VisitorsScreen.tsx`:

Add imports after line 10:

```typescript
import RecurringPassCard, { RecurringPassData } from '../components/RecurringPassCard';
import * as recurringApi from '../api/client';
```

Add state inside the component (after line 29):

```typescript
  const [recurringPasses, setRecurringPasses] = useState<RecurringPassData[]>([]);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [rName, setRName] = useState('');
  const [rRole, setRRole] = useState('maid');
  const [rScheduleType, setRScheduleType] = useState('daily');
  const [rDays, setRDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [rTimeFrom, setRTimeFrom] = useState('06:00');
  const [rTimeUntil, setRTimeUntil] = useState('09:00');
```

Add fetch function (after fetchPasses):

```typescript
  const fetchRecurring = useCallback(async () => {
    try {
      const res = await recurringApi.getRecurringPasses();
      const data = res.data.data;
      setRecurringPasses(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => { fetchRecurring(); }, [fetchRecurring]);
```

Add handlers (after handleRevoke):

```typescript
  const handleCreateRecurring = async () => {
    if (!rName.trim()) return;
    try {
      await recurringApi.createRecurringPass({
        visitor_name: rName.trim(),
        visitor_role: rRole,
        schedule_type: rScheduleType,
        schedule_days: rScheduleType === 'daily' ? undefined : rDays,
        time_from: rTimeFrom,
        time_until: rTimeUntil,
      });
      setRName('');
      setShowRecurringForm(false);
      fetchRecurring();
    } catch {}
  };

  const handlePause = async (id: string) => {
    await recurringApi.updateRecurringPass(id, { status: 'paused' });
    fetchRecurring();
  };

  const handleResume = async (id: string) => {
    await recurringApi.updateRecurringPass(id, { status: 'active' });
    fetchRecurring();
  };

  const handleCancelRecurring = async (id: string) => {
    await recurringApi.cancelRecurringPass(id);
    fetchRecurring();
  };

  const toggleDay = (day: number) => {
    setRDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort());
  };
```

Replace the FlatList (lines 85-109) with a ScrollView that includes both recurring and OTP sections:

```tsx
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {/* Recurring Visitors Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recurring Visitors ({recurringPasses.length})</Text>
        </View>

        {recurringPasses.map((pass) => (
          <RecurringPassCard
            key={pass.id}
            pass={pass}
            onPause={handlePause}
            onResume={handleResume}
            onCancel={handleCancelRecurring}
          />
        ))}

        <TouchableOpacity onPress={() => setShowRecurringForm(true)} style={styles.addButton}>
          <MaterialCommunityIcons name="plus-circle" size={20} color={colors.info} />
          <Text style={styles.addButtonText}>Add Recurring Visitor</Text>
        </TouchableOpacity>

        {/* Visitor Passes Section */}
        <View style={[styles.sectionHeader, { marginTop: spacing.xl }]}>
          <Text style={styles.sectionTitle}>Visitor Passes ({passes.length})</Text>
        </View>

        {passes.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No visitor passes</Text>
          </View>
        ) : (
          [...activePasses, ...otherPasses].map((item, index) => (
            <AnimatedEntry key={item.id} direction="left" delay={index * 80}>
              <VisitorPassCard
                pass={item}
                residentName={user?.name || 'Resident'}
                unitNumber={user?.unitNumber ? `Unit ${user.unitNumber}` : ''}
                communityName={user?.communityName}
                onRevoke={handleRevoke}
              />
            </AnimatedEntry>
          ))
        )}
      </ScrollView>
```

Add the recurring form modal (after the existing Create Pass modal, before the closing `</LinearGradient>`):

```tsx
      {/* Recurring Visitor Form Modal */}
      <Modal visible={showRecurringForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Recurring Visitor</Text>
            <TextInput
              style={styles.input}
              placeholder="Visitor name"
              placeholderTextColor={colors.textMuted}
              value={rName}
              onChangeText={setRName}
            />

            <Text style={styles.durationLabel}>ROLE</Text>
            <View style={styles.durationChips}>
              {['maid', 'cook', 'driver', 'tutor', 'newspaper', 'other'].map((role) => (
                <TouchableOpacity key={role} onPress={() => setRRole(role)}>
                  {rRole === role ? (
                    <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.durationChip}>
                      <Text style={styles.durationChipTextActive}>{role}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.durationChipInactive}>
                      <Text style={styles.durationChipText}>{role}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.durationLabel}>SCHEDULE</Text>
            <View style={styles.durationChips}>
              {['daily', 'weekday', 'weekly', 'custom'].map((type) => (
                <TouchableOpacity key={type} onPress={() => setRScheduleType(type)}>
                  {rScheduleType === type ? (
                    <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.durationChip}>
                      <Text style={styles.durationChipTextActive}>{type}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.durationChipInactive}>
                      <Text style={styles.durationChipText}>{type}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {(rScheduleType === 'weekly' || rScheduleType === 'custom') && (
              <>
                <Text style={styles.durationLabel}>DAYS</Text>
                <View style={styles.durationChips}>
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, i) => (
                    <TouchableOpacity key={i} onPress={() => toggleDay(i)}>
                      {rDays.includes(i) ? (
                        <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.dayChip}>
                          <Text style={styles.durationChipTextActive}>{label}</Text>
                        </LinearGradient>
                      ) : (
                        <View style={styles.dayChipInactive}>
                          <Text style={styles.durationChipText}>{label}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.durationLabel}>TIME WINDOW</Text>
            <View style={styles.timeRow}>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={rTimeFrom}
                onChangeText={setRTimeFrom}
                placeholder="06:00"
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.timeSep}>to</Text>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={rTimeUntil}
                onChangeText={setRTimeUntil}
                placeholder="09:00"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={() => setShowRecurringForm(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Save" variant="success" icon="check" onPress={handleCreateRecurring} disabled={!rName.trim()} />
              </View>
            </View>
          </GlowCard>
        </View>
      </Modal>
```

Add new styles to the StyleSheet:

```typescript
  sectionHeader: { marginBottom: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  addButtonText: { fontSize: 14, color: colors.info, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  timeInput: { flex: 1, textAlign: 'center', marginBottom: 0 },
  timeSep: { color: colors.textMuted, fontSize: 14 },
  dayChip: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayChipInactive: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
```

Also add `ScrollView` to the React Native imports (line 2) if not already there.

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/VisitorsScreen.tsx
git commit -m "feat: resident app recurring visitors section + create form"
```

---

## Task 9: Deploy + Test on EC2

- [ ] **Step 1: Run migration on EC2**

```bash
cat services/api-gateway/migrations/012_recurring_passes.sql | ssh -i communitygate-test.pem ec2-user@54.235.41.163 "docker exec -i communitygate-postgres-1 psql -U cguser -d communitygate"
```

- [ ] **Step 2: Deploy updated API to EC2**

```bash
tar czf /tmp/recurring-deploy.tar.gz \
  services/api-gateway/src/routes/recurring-passes.js \
  services/api-gateway/src/routes/expected-visits.js \
  services/api-gateway/src/cron/generate-visits.js \
  services/api-gateway/src/index.js \
  services/api-gateway/src/lib/fcm.js

scp -i communitygate-test.pem /tmp/recurring-deploy.tar.gz ec2-user@54.235.41.163:/tmp/

ssh -i communitygate-test.pem ec2-user@54.235.41.163 "
  cd /opt/communitygate && tar xzf /tmp/recurring-deploy.tar.gz
  cd services/api-gateway && npm install node-cron
  fuser -k 3000/tcp
  sleep 1
  CORS_ORIGINS='https://dwaarai.in,https://dwaarai.com' \
  DATABASE_URL=postgresql://cguser:devpass@localhost:5432/communitygate \
  JWT_SECRET=dev-secret-key-change-me \
  REDIS_URL=redis://localhost:6379 \
  PORT_API_GATEWAY=3000 \
  UPLOAD_DIR=/opt/communitygate/uploads/visits \
  nohup node src/index.js > /tmp/api-gateway.log 2>&1 &
"
```

- [ ] **Step 3: Configure nginx for static uploads**

```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 "
  sudo mkdir -p /opt/communitygate/uploads/visits
  sudo chown -R ec2-user:ec2-user /opt/communitygate/uploads
"
```

- [ ] **Step 4: Test API endpoints with curl**

```bash
# Create recurring pass (resident token)
curl -s -X POST https://dwaarai.in/api/v1/recurring-passes \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <resident-token>' \
  -d '{"visitor_name":"Lakshmi","visitor_role":"maid","schedule_type":"daily","time_from":"06:00","time_until":"09:00"}'

# List recurring passes
curl -s https://dwaarai.in/api/v1/recurring-passes \
  -H 'Authorization: Bearer <resident-token>'

# Get expected visits (guard token)
curl -s https://dwaarai.in/api/v1/expected-visits \
  -H 'Authorization: Bearer <guard-token>'

# Mark arrived (guard token, with photo)
curl -s -X POST https://dwaarai.in/api/v1/expected-visits/<visit-id>/arrived \
  -H 'Authorization: Bearer <guard-token>' \
  -F 'photo=@test-photo.jpg'
```

- [ ] **Step 5: Verify cron generation**

Check API logs for cron output:
```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 "grep Cron /tmp/api-gateway.log"
```

Expected: `[Cron] Visit generation cron scheduled` and `[Cron] Generated N expected visits for YYYY-MM-DD`
