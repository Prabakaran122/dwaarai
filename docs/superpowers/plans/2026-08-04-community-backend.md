# Community Module — Backend + Committee Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server side of the Basera Community module — issues with an immutable status timeline, role-gated RWA controls, poll voting rules, a unified feed — plus the Admin Portal screen that appoints committee members.

**Architecture:** Extends the existing `issues.js`, `polls.js`, `community-feed.js` routes in api-gateway rather than adding a service. One additive migration. Committee identity lives on `residents.committee_role`; every permission is enforced server-side. The status timeline is an insert-only table written in the same transaction as the status change.

**Tech Stack:** Node 20 ESM, Express, Postgres (`pg`), zod, vitest, multer. Admin Portal is Next.js 14.

**Spec:** `docs/superpowers/specs/2026-08-04-basera-community-module-design.md`

**Scope note:** The Basera app screens are a SEPARATE plan. This plan delivers a testable API + portal screen on its own.

## Global Constraints

- **ESM only**; Node 20+. Follow the existing route file conventions.
- Tests: `pnpm --filter api-gateway test`. Portal: `pnpm --filter admin-portal lint`.
- **Migration numbering continues at `037`** — 036 is the highest applied.
- **Every permission is enforced server-side.** Hiding a control in a client is presentation, never authorisation.
- **`issue_status_events` is insert-only.** No route, helper, or admin path may UPDATE or DELETE it.
- Status transitions are **forward-only**: `open → in_progress → resolved`. Backwards or skipping is a 422.
- Actor name and role are **denormalised onto timeline rows** — an audit record shows who someone was at the time, not who they are now.
- Committee roles: `president | secretary | treasurer | member`. NULL means not committee.
- Keep the existing route METHOD and PATH for status (`PUT /issues/:id/status`) — changing it would break current callers.

---

### Task 1: Migration 037 — community v1 schema

**Files:**
- Create: `services/api-gateway/migrations/037_community_v1.sql`
- Test: `services/api-gateway/src/__tests__/migrate.test.js` (existing — must still pass)

**Interfaces:**
- Consumes: nothing.
- Produces: `residents.committee_role`; tables `issue_status_events`, `issue_photos`, `issue_replies`; columns `issues.reference`, `issues.assignee_name`, `issues.resolved_at`; columns `polls.topic`, `polls.one_vote_per_unit`, `polls.is_anonymous`, `polls.show_live_results`, `polls.audience`; table `issue_reference_seq`.

- [ ] **Step 1: Write the migration**

```sql
-- Community module v1.0 (BRD, Aug 2026).

-- Committee identity. The mockups label people "Rajan Kumar · Secretary";
-- residents previously had only an is_committee boolean and no way to set it.
ALTER TABLE residents ADD COLUMN IF NOT EXISTS committee_role VARCHAR(20);

-- The accountability surface. INSERT-ONLY: nothing in the codebase updates or
-- deletes these rows, and they outlive the parent issue being hidden.
-- changed_by_name/role are denormalised on purpose: an audit entry must read
-- correctly after the actor leaves the committee.
CREATE TABLE IF NOT EXISTS issue_status_events (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id                UUID NOT NULL REFERENCES issues(id),
  community_id            UUID NOT NULL REFERENCES communities(id),
  from_status             VARCHAR(20),
  to_status               VARCHAR(20),
  changed_by_resident_id  UUID REFERENCES residents(id),
  changed_by_name         VARCHAR(200),
  changed_by_role         VARCHAR(20),
  kind                    VARCHAR(20) NOT NULL DEFAULT 'status_change',
  detail                  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ise_issue ON issue_status_events(issue_id, created_at);

-- Up to 5 ordered photos per issue. A child table, not an array column, so the
-- cap and ordering are enforceable.
CREATE TABLE IF NOT EXISTS issue_photos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id   UUID NOT NULL REFERENCES issues(id),
  path       TEXT NOT NULL,
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_photos ON issue_photos(issue_id, position);

CREATE TABLE IF NOT EXISTS issue_replies (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id            UUID NOT NULL REFERENCES issues(id),
  community_id        UUID NOT NULL REFERENCES communities(id),
  author_resident_id  UUID REFERENCES residents(id),
  author_name         VARCHAR(200),
  author_unit         VARCHAR(30),
  author_role         VARCHAR(20),
  body                TEXT NOT NULL,
  is_official         BOOLEAN NOT NULL DEFAULT FALSE,
  is_removed          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_replies ON issue_replies(issue_id, created_at);

ALTER TABLE issues ADD COLUMN IF NOT EXISTS reference     VARCHAR(20);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS assignee_name VARCHAR(200);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at   TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_issue_reference
  ON issues(community_id, reference) WHERE reference IS NOT NULL;

-- Per-community, per-year counter for IQ-YYYY-NNN. A row-locked counter rather
-- than MAX(n)+1, which collides under concurrent inserts.
CREATE TABLE IF NOT EXISTS issue_reference_seq (
  community_id UUID NOT NULL,
  year         INT  NOT NULL,
  last_value   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (community_id, year)
);

ALTER TABLE polls ADD COLUMN IF NOT EXISTS topic              VARCHAR(80);
ALTER TABLE polls ADD COLUMN IF NOT EXISTS one_vote_per_unit  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS is_anonymous       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS show_live_results  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS audience           VARCHAR(20) NOT NULL DEFAULT 'all';
```

- [ ] **Step 2: Apply it against a scratch database and confirm a second run is a no-op**

Run:
```bash
cd services/api-gateway && node src/db/migrate.js && node src/db/migrate.js
```
Expected: first run applies `037_community_v1.sql`; second prints that everything is up to date. (This is what `migrate.test.js` asserts in CI.)

- [ ] **Step 3: Run the suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/migrations/037_community_v1.sql
git commit -m "feat(db): community v1 schema — committee roles, issue timeline, photos, poll rules"
```

---

### Task 2: Committee role helpers

**Files:**
- Create: `services/api-gateway/src/lib/committee.js`
- Test: `services/api-gateway/src/__tests__/committee.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `COMMITTEE_ROLES: string[]`, `isCommittee(actor): boolean`, `roleLabel(role): string`, `canPostIssue(actor): boolean`, `canAnnounce(actor): boolean`, `canChangeStatus(actor): boolean`. `actor` is `{ role, committee_role, resident_type }` where `resident_type` is the `residents.type` value (`owner`/`tenant`/`guard`).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import {
  COMMITTEE_ROLES, isCommittee, roleLabel,
  canPostIssue, canAnnounce, canChangeStatus,
} from '../lib/committee.js';

const owner     = { role: 'resident', resident_type: 'owner',  committee_role: null };
const tenant    = { role: 'resident', resident_type: 'tenant', committee_role: null };
const secretary = { role: 'resident', resident_type: 'owner',  committee_role: 'secretary' };
const guard     = { role: 'guard',    resident_type: 'guard',  committee_role: null };

describe('committee roles', () => {
  it('lists exactly the four roles the BRD names', () => {
    expect(COMMITTEE_ROLES).toEqual(['president', 'secretary', 'treasurer', 'member']);
  });

  it('treats only a real committee_role as committee', () => {
    expect(isCommittee(secretary)).toBe(true);
    expect(isCommittee(owner)).toBe(false);
    expect(isCommittee({ role: 'resident', committee_role: 'bogus' })).toBe(false);
    expect(isCommittee(undefined)).toBe(false);
  });

  it('labels roles for display', () => {
    expect(roleLabel('secretary')).toBe('Secretary');
    expect(roleLabel(null)).toBe('');
  });
});

describe('permissions matrix from the BRD', () => {
  it('lets owners and committee post issues, but never tenants or guards', () => {
    expect(canPostIssue(owner)).toBe(true);
    expect(canPostIssue(secretary)).toBe(true);
    expect(canPostIssue(tenant)).toBe(false);
    expect(canPostIssue(guard)).toBe(false);
  });

  it('restricts announcements and status changes to committee', () => {
    for (const fn of [canAnnounce, canChangeStatus]) {
      expect(fn(secretary)).toBe(true);
      expect(fn(owner)).toBe(false);
      expect(fn(tenant)).toBe(false);
      expect(fn(guard)).toBe(false);
    }
  });

  it('never grants a guard anything', () => {
    expect(canPostIssue(guard) || canAnnounce(guard) || canChangeStatus(guard)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test committee`
Expected: FAIL — cannot resolve `../lib/committee.js`.

- [ ] **Step 3: Implement**

```js
/**
 * Who may do what in the Community module.
 *
 * Straight from the BRD's role table. Kept in one place because these checks
 * are duplicated across issues, polls and notices routes, and a permission that
 * drifts between routes is a security bug, not a style problem.
 */
export const COMMITTEE_ROLES = ['president', 'secretary', 'treasurer', 'member'];

export function isCommittee(actor) {
  return COMMITTEE_ROLES.includes(actor?.committee_role);
}

export function roleLabel(role) {
  if (!COMMITTEE_ROLES.includes(role)) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Guards read the feed and nothing else. */
function isGuard(actor) {
  return actor?.role === 'guard' || actor?.resident_type === 'guard';
}

/** Tenants may discuss and vote, but may not raise issues (BRD role table). */
export function canPostIssue(actor) {
  if (isGuard(actor)) return false;
  return isCommittee(actor) || actor?.resident_type === 'owner';
}

export function canAnnounce(actor) {
  return !isGuard(actor) && isCommittee(actor);
}

export function canChangeStatus(actor) {
  return !isGuard(actor) && isCommittee(actor);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm --filter api-gateway test committee`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add services/api-gateway/src/lib/committee.js services/api-gateway/src/__tests__/committee.test.js
git commit -m "feat(api): committee role helpers and the BRD permission matrix"
```

---

### Task 3: Forward-only status changes with an immutable timeline

This is the compliance core of the module. Two behaviours matter and both must be enforced in the database, not the UI: a status may only move forward, and every change leaves a permanent record written in the *same transaction* so a timeline can never be missing an entry.

**Files:**
- Modify: `services/api-gateway/src/routes/issues.js:144-168` (the existing `PUT /issues/:id/status`)
- Test: `services/api-gateway/src/__tests__/issue-status.test.js`

**Interfaces:**
- Consumes: `canChangeStatus`, `roleLabel` from `../lib/committee.js`.
- Produces: `nextStatusIsValid(from, to): boolean` exported from `issues.js`; `PUT /issues/:id/status` accepting `{ status, assignee_name? }`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { nextStatusIsValid } from '../routes/issues.js';

describe('status transitions are forward-only', () => {
  it('allows each forward step', () => {
    expect(nextStatusIsValid('open', 'in_progress')).toBe(true);
    expect(nextStatusIsValid('in_progress', 'resolved')).toBe(true);
  });

  it('rejects every backwards step', () => {
    expect(nextStatusIsValid('in_progress', 'open')).toBe(false);
    expect(nextStatusIsValid('resolved', 'in_progress')).toBe(false);
    expect(nextStatusIsValid('resolved', 'open')).toBe(false);
  });

  it('rejects skipping a step', () => {
    expect(nextStatusIsValid('open', 'resolved')).toBe(false);
  });

  it('rejects a no-op and unknown statuses', () => {
    expect(nextStatusIsValid('open', 'open')).toBe(false);
    expect(nextStatusIsValid('open', 'closed')).toBe(false);
    expect(nextStatusIsValid(undefined, 'open')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test issue-status`
Expected: FAIL — `nextStatusIsValid` is not exported.

- [ ] **Step 3: Implement the guard and export it**

Add near the top of `services/api-gateway/src/routes/issues.js`:

```js
import { canChangeStatus, roleLabel } from '../lib/committee.js';

// open -> in_progress -> resolved, and nothing else. The BRD is explicit that
// there are no backwards transitions: a resolved issue that recurs is a new
// issue, so the original's audit trail stays true.
const STATUS_ORDER = ['open', 'in_progress', 'resolved'];

export function nextStatusIsValid(from, to) {
  const i = STATUS_ORDER.indexOf(from);
  const j = STATUS_ORDER.indexOf(to);
  return i !== -1 && j !== -1 && j === i + 1;
}
```

- [ ] **Step 4: Replace the handler body**

Replace the body of `PUT /issues/:id/status` with a transaction that verifies the actor, checks the transition, updates the issue and writes the timeline row together:

```js
router.put('/issues/:id/status', authenticateJWT(['resident', 'admin']), async (req, res) => {
  const client = await pool.connect();
  try {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id } = req.user;
    const { status } = parsed.data;

    // The actor's committee role comes from the database, never the token —
    // a token issued before someone left the committee must not still work.
    const actor = await queryOne(
      `SELECT id, name, type AS resident_type, committee_role
         FROM residents WHERE id = $1 AND community_id = $2 AND is_active = true`,
      [req.user.sub, community_id]
    );
    if (!canChangeStatus({ ...actor, role: req.user.role })) {
      return error(res, 'Only committee members can change issue status', 403);
    }

    await client.query('BEGIN');
    // Lock the row so two committee members cannot race the same transition.
    const current = await client.query(
      `SELECT id, status FROM issues
        WHERE id = $1 AND community_id = $2 AND is_removed = false FOR UPDATE`,
      [req.params.id, community_id]
    );
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return error(res, 'Issue not found', 404);
    }
    const from = current.rows[0].status;
    if (!nextStatusIsValid(from, status)) {
      await client.query('ROLLBACK');
      return error(res, `Cannot move an issue from ${from} to ${status}`, 422);
    }

    await client.query(
      `UPDATE issues
          SET status = $1, last_activity_at = NOW(),
              assignee_name = COALESCE($2, assignee_name),
              resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
        WHERE id = $3 AND community_id = $4`,
      [status, parsed.data.assignee_name || null, req.params.id, community_id]
    );

    // Same transaction as the update: a status change without its timeline row
    // is exactly the gap this feature exists to close.
    await client.query(
      `INSERT INTO issue_status_events
         (issue_id, community_id, from_status, to_status,
          changed_by_resident_id, changed_by_name, changed_by_role, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'status_change')`,
      [req.params.id, community_id, from, status,
       actor.id, actor.name, roleLabel(actor.committee_role)]
    );
    await client.query('COMMIT');

    return success(res, { id: req.params.id, status, from });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('PUT /issues/:id/status error:', err);
    return error(res, 'Internal server error', 500);
  } finally {
    client.release();
  }
});
```

Add `import { pool } from '../db/pool.js';` if `pool` is not already imported in this file — check the file's existing imports first and reuse whatever it already has for a transaction-capable client.

- [ ] **Step 5: Widen the status schema**

`updateStatusSchema` must accept the optional assignee:

```js
const updateStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved']),
  assignee_name: z.string().max(200).optional(),
});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter api-gateway test`
Expected: PASS — the new transition tests plus no regressions.

- [ ] **Step 7: Commit**

```bash
git add services/api-gateway/src/routes/issues.js services/api-gateway/src/__tests__/issue-status.test.js
git commit -m "feat(api): forward-only issue status with an immutable timeline entry"
```

---

### Task 4: Issue reference allocation (IQ-YYYY-NNN)

**Files:**
- Create: `services/api-gateway/src/lib/issue-reference.js`
- Modify: `services/api-gateway/src/routes/issues.js` (the `POST /issues` handler)
- Test: `services/api-gateway/src/__tests__/issue-reference.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatReference(year, n): string`, `allocateReference(client, communityId, year): Promise<string>` — must be called inside an open transaction.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { formatReference, allocateReference } from '../lib/issue-reference.js';

describe('formatReference', () => {
  it('pads the sequence to three digits', () => {
    expect(formatReference(2026, 1)).toBe('IQ-2026-001');
    expect(formatReference(2026, 47)).toBe('IQ-2026-047');
    expect(formatReference(2026, 999)).toBe('IQ-2026-999');
  });

  it('does not truncate past three digits', () => {
    expect(formatReference(2026, 1000)).toBe('IQ-2026-1000');
  });
});

describe('allocateReference', () => {
  it('uses an atomic upsert, not read-then-write', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ last_value: 5 }] }) };
    const ref = await allocateReference(client, 'c1', 2026);

    const [sql, params] = client.query.mock.calls[0];
    // A MAX+1 or SELECT-then-UPDATE would collide under concurrent inserts.
    expect(sql).toMatch(/INSERT INTO issue_reference_seq/i);
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(sql).toMatch(/RETURNING/i);
    expect(params).toEqual(['c1', 2026]);
    expect(ref).toBe('IQ-2026-005');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test issue-reference`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
/**
 * Per-community, per-year issue references (IQ-2026-047).
 *
 * Allocated with an atomic upsert rather than MAX(reference)+1: two residents
 * reporting an issue at the same moment would otherwise be handed the same
 * number, and the unique index would reject one of them.
 */
export function formatReference(year, n) {
  return `IQ-${year}-${String(n).padStart(3, '0')}`;
}

export async function allocateReference(client, communityId, year) {
  const { rows } = await client.query(
    `INSERT INTO issue_reference_seq (community_id, year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (community_id, year)
     DO UPDATE SET last_value = issue_reference_seq.last_value + 1
     RETURNING last_value`,
    [communityId, year]
  );
  return formatReference(year, rows[0].last_value);
}
```

- [ ] **Step 4: Wire it into issue creation**

In `POST /issues`, wrap creation in a transaction, reject tenants, allocate the reference, and write the opening timeline entry:

```js
    const actor = await queryOne(
      `SELECT id, name, type AS resident_type, committee_role
         FROM residents WHERE id = $1 AND community_id = $2 AND is_active = true`,
      [req.user.sub, req.user.community_id]
    );
    if (!canPostIssue({ ...actor, role: req.user.role })) {
      return error(res, 'Only owners and committee members can report issues', 403);
    }
```

then inside the transaction, before the INSERT:

```js
    const reference = await allocateReference(client, community_id, new Date().getFullYear());
```

include `reference` in the issues INSERT column list, and after it:

```js
    await client.query(
      `INSERT INTO issue_status_events
         (issue_id, community_id, from_status, to_status,
          changed_by_resident_id, changed_by_name, changed_by_role, kind, detail)
       VALUES ($1,$2,NULL,'open',$3,$4,$5,'status_change','Issue reported')`,
      [issueId, community_id, actor.id, actor.name, roleLabel(actor.committee_role)]
    );
```

- [ ] **Step 5: Run the suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api-gateway/src/lib/issue-reference.js services/api-gateway/src/routes/issues.js services/api-gateway/src/__tests__/issue-reference.test.js
git commit -m "feat(api): collision-safe IQ-YYYY-NNN issue references"
```

---

### Task 5: Upvote threshold system timeline entry

The mockup's timeline contains "24 residents affected — Community upvote threshold crossed", which no user performs. It is written by the upvote handler when the count first crosses the threshold.

**Files:**
- Modify: `services/api-gateway/src/routes/issues.js` (`POST /issues/:id/upvote`)
- Test: `services/api-gateway/src/__tests__/issue-threshold.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `UPVOTE_THRESHOLD: number` and `crossedThreshold(before, after): boolean`, exported from `issues.js`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { UPVOTE_THRESHOLD, crossedThreshold } from '../routes/issues.js';

describe('upvote threshold', () => {
  it('fires exactly once, on the crossing', () => {
    expect(crossedThreshold(UPVOTE_THRESHOLD - 1, UPVOTE_THRESHOLD)).toBe(true);
  });

  it('does not fire before, after, or on the way down', () => {
    expect(crossedThreshold(0, 1)).toBe(false);
    expect(crossedThreshold(UPVOTE_THRESHOLD, UPVOTE_THRESHOLD + 1)).toBe(false);
    expect(crossedThreshold(UPVOTE_THRESHOLD, UPVOTE_THRESHOLD - 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test issue-threshold`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

```js
// The count at which an issue is treated as a community-wide concern. Crossing
// it writes a system timeline entry, which is what turns a pile of upvotes into
// visible pressure on the RWA.
export const UPVOTE_THRESHOLD = 20;

export function crossedThreshold(before, after) {
  return before < UPVOTE_THRESHOLD && after >= UPVOTE_THRESHOLD;
}
```

In the upvote handler, after the count changes:

```js
    if (crossedThreshold(before, after)) {
      await client.query(
        `INSERT INTO issue_status_events
           (issue_id, community_id, kind, detail)
         VALUES ($1, $2, 'system', $3)`,
        [req.params.id, community_id, `${after} residents affected — community upvote threshold crossed`]
      );
    }
```

System entries carry a NULL actor, which is why `changed_by_*` are nullable.

- [ ] **Step 4: Run the suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api-gateway/src/routes/issues.js services/api-gateway/src/__tests__/issue-threshold.test.js
git commit -m "feat(api): system timeline entry when an issue crosses the upvote threshold"
```

---

### Task 6: Issue detail, replies and photos

**Files:**
- Modify: `services/api-gateway/src/routes/issues.js`
- Test: `services/api-gateway/src/__tests__/issue-detail.test.js`

**Interfaces:**
- Consumes: `isCommittee`, `roleLabel` from `../lib/committee.js`.
- Produces: `GET /issues/:id` returning `{ issue, photos, timeline, replies, upvoteCount, myUpvoted }`; `POST /issues/:id/replies` accepting `{ body }`; `POST /issues/:id/photos` (multipart, field `photos`, max 5).
- Produces: `MAX_ISSUE_PHOTOS: number` exported from `issues.js`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { MAX_ISSUE_PHOTOS, remainingPhotoSlots } from '../routes/issues.js';

describe('photo cap', () => {
  it('caps an issue at five photos, per the BRD', () => {
    expect(MAX_ISSUE_PHOTOS).toBe(5);
  });

  it('reports how many more may be uploaded', () => {
    expect(remainingPhotoSlots(0)).toBe(5);
    expect(remainingPhotoSlots(3)).toBe(2);
    expect(remainingPhotoSlots(5)).toBe(0);
    expect(remainingPhotoSlots(7)).toBe(0);   // never negative
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test issue-detail`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement the cap helper**

```js
export const MAX_ISSUE_PHOTOS = 5;

export function remainingPhotoSlots(existingCount) {
  return Math.max(0, MAX_ISSUE_PHOTOS - existingCount);
}
```

- [ ] **Step 4: Add the detail route**

```js
router.get('/issues/:id', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id } = req.user;
    const issue = await queryOne(
      `SELECT * FROM issues WHERE id = $1 AND community_id = $2 AND is_removed = false`,
      [req.params.id, community_id]
    );
    if (!issue) return error(res, 'Issue not found', 404);

    const [photos, timeline, replies, counts] = await Promise.all([
      queryRows('SELECT id, path, position FROM issue_photos WHERE issue_id = $1 ORDER BY position', [issue.id]),
      queryRows(
        `SELECT from_status, to_status, changed_by_name, changed_by_role, kind, detail, created_at
           FROM issue_status_events WHERE issue_id = $1 ORDER BY created_at`, [issue.id]),
      queryRows(
        `SELECT id, author_name, author_unit, author_role, body, is_official, created_at
           FROM issue_replies WHERE issue_id = $1 AND is_removed = false ORDER BY created_at`, [issue.id]),
      queryOne(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE resident_id = $2)::int AS mine
           FROM issue_upvotes WHERE issue_id = $1`, [issue.id, req.user.sub]),
    ]);

    return success(res, {
      issue, photos, timeline, replies,
      upvoteCount: counts.total,
      myUpvoted: counts.mine > 0,
    });
  } catch (err) {
    console.error('GET /issues/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 5: Add the replies route**

Committee replies are flagged official at write time, so the flag reflects the author's standing when they wrote it:

```js
router.post('/issues/:id/replies', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = z.object({ body: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return error(res, 'Validation error', 400, parsed.error.issues);

    const { community_id } = req.user;
    const actor = await queryOne(
      `SELECT id, name, committee_role,
              (SELECT unit_number FROM units WHERE id = residents.unit_id) AS unit
         FROM residents WHERE id = $1 AND community_id = $2 AND is_active = true`,
      [req.user.sub, community_id]
    );
    if (!actor) return error(res, 'Resident not found', 404);

    const official = isCommittee(actor);
    const row = await queryOne(
      `INSERT INTO issue_replies
         (issue_id, community_id, author_resident_id, author_name, author_unit,
          author_role, body, is_official)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, author_name, author_unit, author_role, body, is_official, created_at`,
      [req.params.id, community_id, actor.id, actor.name, actor.unit,
       roleLabel(actor.committee_role), parsed.data.body, official]
    );
    await query('UPDATE issues SET last_activity_at = NOW() WHERE id = $1', [req.params.id]);
    return success(res, row, 201);
  } catch (err) {
    console.error('POST /issues/:id/replies error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 6: Add the photo upload route**

Follow the incidents pattern exactly (`services/api-gateway/src/routes/incidents.js:15-30`) — read it first and mirror its multer disk-storage setup, changing only the subdirectory to `issues`:

```js
const issueStorage = multer.diskStorage({ /* mirror incidents.js, dir: `${UPLOAD_BASE}/issues/${month}` */ });
const uploadIssuePhotos = multer({
  storage: issueStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_ISSUE_PHOTOS },
  fileFilter: (req, file, cb) => cb(null, /jpeg|jpg|png|heic/i.test(file.mimetype)),
});

router.post('/issues/:id/photos', authenticateJWT(['resident', 'admin']),
  uploadIssuePhotos.array('photos', MAX_ISSUE_PHOTOS), async (req, res) => {
    const existing = await queryOne(
      'SELECT COUNT(*)::int AS n FROM issue_photos WHERE issue_id = $1', [req.params.id]);
    const slots = remainingPhotoSlots(existing.n);
    if ((req.files || []).length > slots) {
      return error(res, `This issue can take ${slots} more photo(s)`, 422);
    }
    // insert each file at position existing.n + index, path `/uploads/issues/${month}/${filename}`
  });
```

- [ ] **Step 7: Run the suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/api-gateway/src/routes/issues.js services/api-gateway/src/__tests__/issue-detail.test.js
git commit -m "feat(api): issue detail with timeline, official replies and capped photo uploads"
```

---

### Task 7: Poll rules — audience, one vote per unit, anonymity

**Files:**
- Modify: `services/api-gateway/src/routes/polls.js`
- Test: `services/api-gateway/src/__tests__/poll-rules.test.js`

**Interfaces:**
- Consumes: `isCommittee` from `../lib/committee.js`.
- Produces: `POLL_AUDIENCES: string[]`, `isEligibleVoter(poll, voter): boolean` exported from `polls.js`; `POST /polls` accepting `{ topic, question, options[], closes_at, audience, target_block_id?, one_vote_per_unit, is_anonymous, show_live_results }`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { POLL_AUDIENCES, isEligibleVoter } from '../routes/polls.js';

const owner  = { resident_type: 'owner',  unit_id: 'u1', block_id: 'b1' };
const tenant = { resident_type: 'tenant', unit_id: 'u2', block_id: 'b1' };
const other  = { resident_type: 'owner',  unit_id: 'u3', block_id: 'b2' };

describe('poll audiences', () => {
  it('supports exactly the audiences the BRD names', () => {
    expect(POLL_AUDIENCES).toEqual(['all', 'owners', 'block']);
  });

  it('all: everyone votes', () => {
    const poll = { audience: 'all' };
    expect(isEligibleVoter(poll, owner)).toBe(true);
    expect(isEligibleVoter(poll, tenant)).toBe(true);
  });

  it('owners: tenants are excluded', () => {
    const poll = { audience: 'owners' };
    expect(isEligibleVoter(poll, owner)).toBe(true);
    expect(isEligibleVoter(poll, tenant)).toBe(false);
  });

  it('block: only residents of the targeted block', () => {
    const poll = { audience: 'block', target_block_id: 'b1' };
    expect(isEligibleVoter(poll, owner)).toBe(true);
    expect(isEligibleVoter(poll, other)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test poll-rules`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

```js
export const POLL_AUDIENCES = ['all', 'owners', 'block'];

export function isEligibleVoter(poll, voter) {
  if (poll?.audience === 'owners') return voter?.resident_type === 'owner';
  if (poll?.audience === 'block')  return voter?.block_id === poll.target_block_id;
  return true;
}
```

- [ ] **Step 4: Enforce the rules in the vote handler**

In `POST /polls/:id/vote`, before recording the vote:

```js
    if (!isEligibleVoter(poll, voter)) {
      return error(res, 'This poll is not open to you', 403);
    }
    if (new Date(poll.closes_at) <= new Date()) {
      return error(res, 'This poll has closed', 422);
    }
    if (poll.one_vote_per_unit) {
      const existing = await queryOne(
        'SELECT 1 FROM poll_votes WHERE poll_id = $1 AND unit_id = $2',
        [poll.id, voter.unit_id]
      );
      if (existing) return error(res, 'Someone in your flat has already voted', 409);
    }
```

The unit check is server-side deliberately: the app disables the control, but a second resident in the same flat must be refused even if they call the API directly.

- [ ] **Step 5: Hide results when the poll says so**

Where results are returned, respect `show_live_results`:

```js
    const closed = new Date(poll.closes_at) <= new Date();
    const results = (poll.show_live_results || closed)
      ? tallies
      : null;    // the app renders "Results hidden until poll closes"
```

And when `is_anonymous`, never return voter identities — only counts.

- [ ] **Step 6: Run the suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api-gateway/src/routes/polls.js services/api-gateway/src/__tests__/poll-rules.test.js
git commit -m "feat(api): poll audience targeting, one-vote-per-unit and result visibility rules"
```

---

### Task 8: Unified community feed

The existing `GET /community/feed` returns `{announcements, issues, polls}` grouped. The BRD wants one reverse-chronological list with the most recent announcement pinned first and a type filter.

**Files:**
- Modify: `services/api-gateway/src/routes/community-feed.js`
- Test: `services/api-gateway/src/__tests__/community-feed.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `orderFeed(posts): object[]` exported from `community-feed.js`; `GET /community/feed?type=` returning `{ posts: [...] }` where each post has `{ id, type, createdAt, ... }` and `type` is one of `announcement | issue | poll | discussion`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { orderFeed } from '../routes/community-feed.js';

const p = (id, type, iso) => ({ id, type, createdAt: iso });

describe('orderFeed', () => {
  it('pins the most recent announcement first regardless of age', () => {
    const out = orderFeed([
      p('i1', 'issue', '2026-08-03T10:00:00Z'),
      p('a1', 'announcement', '2026-07-01T09:00:00Z'),
      p('p1', 'poll', '2026-08-02T09:00:00Z'),
    ]);
    expect(out[0].id).toBe('a1');
  });

  it('orders everything after the pin reverse-chronologically', () => {
    const out = orderFeed([
      p('i1', 'issue', '2026-08-01T10:00:00Z'),
      p('a1', 'announcement', '2026-07-01T09:00:00Z'),
      p('p1', 'poll', '2026-08-02T09:00:00Z'),
    ]);
    expect(out.map((x) => x.id)).toEqual(['a1', 'p1', 'i1']);
  });

  it('pins only the newest announcement, leaving older ones in place', () => {
    const out = orderFeed([
      p('a_old', 'announcement', '2026-06-01T09:00:00Z'),
      p('a_new', 'announcement', '2026-07-01T09:00:00Z'),
      p('i1', 'issue', '2026-08-01T10:00:00Z'),
    ]);
    expect(out[0].id).toBe('a_new');
    expect(out.map((x) => x.id)).toEqual(['a_new', 'i1', 'a_old']);
  });

  it('handles an empty feed and a feed with no announcements', () => {
    expect(orderFeed([])).toEqual([]);
    const out = orderFeed([p('i1', 'issue', '2026-08-01T10:00:00Z')]);
    expect(out.map((x) => x.id)).toEqual(['i1']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test community-feed`
Expected: FAIL — `orderFeed` is not exported.

- [ ] **Step 3: Implement**

```js
/**
 * Feed order per BRD F-01: the most recent announcement is pinned to the top
 * regardless of its age, everything else is reverse-chronological. Only ONE
 * announcement is pinned — older ones fall back into the timeline, or a society
 * that posts often would show nothing but announcements.
 */
export function orderFeed(posts) {
  const byNewest = [...posts].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  const pinIndex = byNewest.findIndex((p) => p.type === 'announcement');
  if (pinIndex <= 0) return byNewest;
  const [pinned] = byNewest.splice(pinIndex, 1);
  return [pinned, ...byNewest];
}
```

- [ ] **Step 4: Reshape the route**

Query the same three sources, map each row to a common post shape with an explicit `type`, concatenate, pass through `orderFeed`, and return `{ posts }`. Honour `?type=` by filtering after ordering so the pin rule still applies within a filtered view. Keep `Promise.allSettled` so one failing source does not empty the feed — the existing handler already does this; preserve it.

- [ ] **Step 5: Update the existing app test that asserts the old shape**

`apps/resident-app/src/screens/CommunityScreen.test.tsx` mocks the grouped shape. It will be rewritten with the screen in the app plan; for now, update its mock to `{ posts: [...] }` so the repo stays green.

- [ ] **Step 6: Run both suites**

Run: `pnpm --filter api-gateway test && pnpm --filter resident-app test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api-gateway/src/routes/community-feed.js services/api-gateway/src/__tests__/community-feed.test.js apps/resident-app/src/screens/CommunityScreen.test.tsx
git commit -m "feat(api): unified community feed with pinned announcement and type filter"
```

---

### Task 9: Committee appointment — API + Admin Portal screen

**Files:**
- Create: `services/api-gateway/src/routes/residents-admin.js`
- Modify: `services/api-gateway/src/index.js` (mount it, following the `unitRoutes` pattern at lines 36 and 102)
- Create: `apps/admin-portal/app/residents/page.tsx`
- Modify: `apps/admin-portal/components/Sidebar.tsx` (add the nav entry)
- Test: `services/api-gateway/src/__tests__/residents-admin.test.js`

**Interfaces:**
- Consumes: `COMMITTEE_ROLES` from `../lib/committee.js`.
- Produces: `GET /admin/residents?search=` → `[{ id, name, unit, type, committee_role }]`; `PUT /admin/residents/:id/committee-role` accepting `{ committee_role: string|null }`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { validCommitteeRole } from '../routes/residents-admin.js';

describe('validCommitteeRole', () => {
  it('accepts the four roles and null (meaning: remove from committee)', () => {
    for (const r of ['president', 'secretary', 'treasurer', 'member']) {
      expect(validCommitteeRole(r)).toBe(true);
    }
    expect(validCommitteeRole(null)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(validCommitteeRole('admin')).toBe(false);
    expect(validCommitteeRole('')).toBe(false);
    expect(validCommitteeRole('SECRETARY')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test residents-admin`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route module**

```js
import { Router } from 'express';
import { z } from 'zod';
import { queryOne, queryRows } from '../db/queries.js';
import { authenticateJWT } from '../middleware/auth.js';
import { success, error } from '../middleware/response.js';
import { COMMITTEE_ROLES } from '../lib/committee.js';

const router = Router();

export function validCommitteeRole(role) {
  return role === null || COMMITTEE_ROLES.includes(role);
}

router.get('/admin/residents', authenticateJWT(['admin']), async (req, res) => {
  try {
    const communityId = req.user.community_id;
    if (!communityId) return error(res, 'No community selected', 400);
    const params = [communityId];
    let sql = `SELECT r.id, r.name, r.type, r.committee_role,
                      COALESCE(u.unit_number, '') AS unit
                 FROM residents r
                 LEFT JOIN units u ON u.id = r.unit_id
                WHERE r.community_id = $1 AND r.is_active = true`;
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      sql += ` AND (r.name ILIKE $${params.length} OR u.unit_number ILIKE $${params.length})`;
    }
    sql += ' ORDER BY r.committee_role NULLS LAST, u.unit_number, r.name LIMIT 500';
    return success(res, await queryRows(sql, params));
  } catch (err) {
    console.error('GET /admin/residents error:', err);
    return error(res, 'Internal server error', 500);
  }
});

router.put('/admin/residents/:id/committee-role', authenticateJWT(['admin']), async (req, res) => {
  try {
    const parsed = z.object({
      committee_role: z.enum(['president', 'secretary', 'treasurer', 'member']).nullable(),
    }).safeParse(req.body);
    if (!parsed.success) return error(res, 'Validation error', 400, parsed.error.issues);

    const communityId = req.user.community_id;
    const row = await queryOne(
      `UPDATE residents SET committee_role = $1, is_committee = ($1 IS NOT NULL)
        WHERE id = $2 AND community_id = $3
        RETURNING id, name, committee_role`,
      [parsed.data.committee_role, req.params.id, communityId]
    );
    if (!row) return error(res, 'Resident not found', 404);
    return success(res, row);
  } catch (err) {
    console.error('PUT /admin/residents/:id/committee-role error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
```

`is_committee` is kept in sync with `committee_role` so existing code reading the boolean keeps working.

- [ ] **Step 4: Mount it**

In `services/api-gateway/src/index.js`, add the import beside the other route imports and `app.use('/api/v1', residentAdminRoutes);` beside the others. Confirm afterwards that the import appears exactly once — a duplicate ESM import is a syntax error that git merges have produced in this file before:

```bash
grep -c "residentAdminRoutes" services/api-gateway/src/index.js   # expect 2
node --check services/api-gateway/src/index.js
```

- [ ] **Step 5: Build the portal screen**

`apps/admin-portal/app/residents/page.tsx`: a client component following the existing `app/units/page.tsx` pattern — `apiFetch('/admin/residents')` on mount, a search box, a table of Name / Unit / Type / Committee role, and a `<select>` per row with options None, President, Secretary, Treasurer, Member that calls `apiPut(\`/admin/residents/${id}/committee-role\`, { committee_role })` and updates local state on success. Read `app/units/page.tsx` first and mirror its loading, error and table styling rather than inventing new patterns. Add a "Residents" entry to `components/Sidebar.tsx` alongside the existing items.

- [ ] **Step 6: Verify**

Run: `pnpm --filter api-gateway test && pnpm --filter admin-portal lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api-gateway/src/routes/residents-admin.js services/api-gateway/src/index.js services/api-gateway/src/__tests__/residents-admin.test.js apps/admin-portal/app/residents/page.tsx apps/admin-portal/components/Sidebar.tsx
git commit -m "feat(portal): appoint committee members from the Admin Portal"
```

---

### Task 10: Resolve notification

**Files:**
- Modify: `services/api-gateway/src/routes/issues.js` (status handler, after COMMIT)
- Test: `services/api-gateway/src/__tests__/issue-notify.test.js`

**Interfaces:**
- Consumes: the existing notification helper used elsewhere in api-gateway — find it with `grep -rn "notification" services/api-gateway/src/routes/*.js | head` and reuse it rather than adding a new client.
- Produces: `resolveNotificationTargets(reporterId, upvoterIds): string[]` exported from `issues.js`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { resolveNotificationTargets } from '../routes/issues.js';

describe('resolveNotificationTargets', () => {
  it('notifies the reporter and every upvoter', () => {
    expect(resolveNotificationTargets('r1', ['u1', 'u2']).sort()).toEqual(['r1', 'u1', 'u2']);
  });

  it('never notifies the same person twice', () => {
    expect(resolveNotificationTargets('r1', ['r1', 'u1']).sort()).toEqual(['r1', 'u1']);
  });

  it('copes with no upvoters', () => {
    expect(resolveNotificationTargets('r1', [])).toEqual(['r1']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test issue-notify`
Expected: FAIL — export missing.

- [ ] **Step 3: Implement**

```js
export function resolveNotificationTargets(reporterId, upvoterIds) {
  return [...new Set([reporterId, ...upvoterIds].filter(Boolean))];
}
```

- [ ] **Step 4: Send on resolve**

After the status transaction commits, and only when the new status is `resolved`, gather upvoters and dispatch. Send **after** COMMIT and never let a notification failure roll back or fail the request — the status change is the source of truth:

```js
    if (status === 'resolved') {
      try {
        const upvoters = await queryRows(
          'SELECT resident_id FROM issue_upvotes WHERE issue_id = $1', [req.params.id]);
        const targets = resolveNotificationTargets(
          issueRow.author_resident_id, upvoters.map((u) => u.resident_id));
        // dispatch via the existing notification helper, deep-linking to the thread
      } catch (notifyErr) {
        console.error('[issues] resolve notification failed:', notifyErr.message);
      }
    }
```

- [ ] **Step 5: Run the suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api-gateway/src/routes/issues.js services/api-gateway/src/__tests__/issue-notify.test.js
git commit -m "feat(api): notify reporter and upvoters when an issue is resolved"
```

---

### Task 11: Announcements — committee-only, with priority

The BRD puts announcements in scope ("Announcement composer, committee-only, with priority levels") and the feed renders them pinned in Deep Ocean. `notices.js` already posts notices but gates on the older role strings and has no priority.

**Files:**
- Modify: `services/api-gateway/src/routes/notices.js`
- Create: `services/api-gateway/migrations/038_notice_priority.sql`
- Test: `services/api-gateway/src/__tests__/notice-priority.test.js`

**Interfaces:**
- Consumes: `canAnnounce`, `roleLabel` from `../lib/committee.js`.
- Produces: `NOTICE_PRIORITIES: string[]`, `isUrgent(priority): boolean` exported from `notices.js`; `POST /notices` additionally accepting `{ priority }`.

- [ ] **Step 1: Write the migration**

```sql
-- Announcement priority (BRD: announcement composer with priority levels).
ALTER TABLE notices ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal';
```

- [ ] **Step 2: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { NOTICE_PRIORITIES, isUrgent } from '../routes/notices.js';

describe('announcement priority', () => {
  it('supports exactly normal and urgent', () => {
    expect(NOTICE_PRIORITIES).toEqual(['normal', 'urgent']);
  });

  it('identifies urgent announcements, which the feed renders differently', () => {
    expect(isUrgent('urgent')).toBe(true);
    expect(isUrgent('normal')).toBe(false);
    expect(isUrgent(undefined)).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test notice-priority`
Expected: FAIL — exports missing.

- [ ] **Step 4: Implement**

```js
export const NOTICE_PRIORITIES = ['normal', 'urgent'];

export function isUrgent(priority) {
  return priority === 'urgent';
}
```

- [ ] **Step 5: Gate posting on committee membership**

In `POST /notices`, replace the existing role check with the shared helper, reading the actor's committee role from the database rather than the token:

```js
    const actor = await queryOne(
      `SELECT id, name, type AS resident_type, committee_role
         FROM residents WHERE id = $1 AND community_id = $2 AND is_active = true`,
      [req.user.sub, req.user.community_id]
    );
    if (!canAnnounce({ ...actor, role: req.user.role })) {
      return error(res, 'Only committee members can post announcements', 403);
    }
```

Include `priority` in the insert, validated with `z.enum(['normal', 'urgent']).default('normal')`, and store `roleLabel(actor.committee_role)` in `posted_by_role` so the feed can render "Rajan Kumar · Secretary".

Note: portal admins post notices through this route today. Preserve that — allow the existing admin path in addition to resident committee members, or portal announcements break.

- [ ] **Step 6: Run the suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api-gateway/src/routes/notices.js services/api-gateway/migrations/038_notice_priority.sql services/api-gateway/src/__tests__/notice-priority.test.js
git commit -m "feat(api): committee-only announcements with priority"
```

---

## Deferred to the Basera app plan

Feed screen rebuild, `IssueDetailScreen`, `PollCreateScreen`, the compose type-selector sheet, client-side image compression to 1200px, and optimistic upvote/vote behaviour.

## Not in this module

Trending topics (P2). The F-03 five-second push deviation is documented in the spec and awaits product-owner approval.
