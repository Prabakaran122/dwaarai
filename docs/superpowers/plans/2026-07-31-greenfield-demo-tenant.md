# Greenfield Demo Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A permanently-live demo society — "Greenfield Faridabad Sector 43" — seeded deeply enough that no admin-portal page is empty, fed by an always-on generator that posts realistic gate traffic through the real ingestion API.

**Architecture:** A new workspace package `services/demo-traffic` holds pure data-generation modules (rhythm, plates, population, event), a one-shot seeder that writes the tenant directly to Postgres, and a long-running generator that mints device JWTs and posts to `POST /api/v1/events/sync` — the same endpoint a real edge node uses, so events broadcast to the portal's live feed for free.

**Tech Stack:** Node 18 (ESM), vitest, `pg`, `jsonwebtoken`, global `fetch`, systemd on EC2.

**Spec:** `docs/superpowers/specs/2026-07-31-greenfield-demo-tenant-design.md`

## Global Constraints

- **Node 18 on EC2** (`v18.20.8`) — no Node 20-only APIs. Global `fetch` and `crypto.randomUUID` are available.
- **ESM only** (`"type": "module"`), matching every other service.
- **Test runner is vitest**, run via `pnpm --filter demo-traffic test`.
- **Demo community UUID is fixed:** `00000000-0000-0000-0000-000000000043`.
- **Gate UUIDs are fixed:** Main Entry `00000000-0000-0000-0000-000000043001`, Exit `…043002`, Service `…043003`.
- **Never write to any other `community_id`.** Every destructive statement is `WHERE community_id = <demo>`.
- **`JWT_SECRET` comes from the environment**, never a literal. On EC2 it is currently `dev-secret-key-change-me` (set in `communitygate-api.service`).
- **`gate_events` is append-only and RANGE-partitioned by `event_ts`** — partitions exist through Dec 2027. Never `UPDATE`/`DELETE` individual rows; teardown deletes by `community_id` only.
- **Guards are `residents` rows**, not a separate table — there is no `guards` table.
- **All randomness is seeded** (`mulberry32`) so a re-run reproduces the same society.

---

### Task 0: Bring EC2's database up to date

The live DB is behind the repo: `gate_events.detection_method` is still `VARCHAR(10)` (migration 031 unapplied), `rfid_cards` lacks 030's `holder_name`/`access_start`/`access_end`, `gates` lacks all of 032's telemetry columns, and `schema_migrations` does not exist. PR #13's dashboard reads 032's columns, so nothing below works until this is done.

**Files:**
- Use: `services/api-gateway/src/db/migrate.js` (already in the repo)

- [ ] **Step 1: Confirm the drift**

```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 \
  "docker exec communitygate-postgres-1 psql -U cguser -d communitygate -t -A \
   -c \"SELECT to_regclass('schema_migrations');\" \
   -c \"SELECT character_maximum_length FROM information_schema.columns WHERE table_name='gate_events' AND column_name='detection_method';\""
```

Expected: an empty line (no `schema_migrations`) and `10`.

- [ ] **Step 2: Back up the database first**

```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 \
  "docker exec communitygate-postgres-1 pg_dump -U cguser communitygate | gzip > /tmp/cg-$(date +%Y%m%d%H%M).sql.gz && ls -lh /tmp/cg-*.sql.gz"
```

Expected: a non-empty `.gz` file. Do not proceed without it.

- [ ] **Step 3: Baseline the migration tracker at the last hand-applied migration**

029 is the newest migration whose objects exist (`polls`, `poll_votes`). Baselining records 001–029 as applied **without executing them**.

```bash
cd /opt/communitygate/services/api-gateway
node src/db/migrate.js --baseline 029_committee_polls.sql
```

Expected: reports 29 migrations recorded as applied.

- [ ] **Step 4: Apply the outstanding migrations**

```bash
node src/db/migrate.js
```

Expected: applies `030_staff_access_windows.sql`, `031_event_contract.sql`, `032_gate_telemetry.sql`.

- [ ] **Step 5: Verify**

```bash
docker exec communitygate-postgres-1 psql -U cguser -d communitygate -t -A \
  -c "SELECT character_maximum_length FROM information_schema.columns WHERE table_name='gate_events' AND column_name='detection_method';" \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='gates' AND column_name='queue_depth';"
```

Expected: `20`, and `queue_depth`.

- [ ] **Step 6: No commit** — this task changes server state only.

---

### Task 1: Package scaffold and config

**Files:**
- Create: `services/demo-traffic/package.json`
- Create: `services/demo-traffic/vitest.config.js`
- Create: `services/demo-traffic/src/config.js`
- Test: `services/demo-traffic/src/__tests__/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEMO_COMMUNITY_ID: string`, `GATES: Array<{id: string, name: string, type: string, share: number}>`, `assertDemoCommunity(id: string): void` (throws `Error` if `id !== DEMO_COMMUNITY_ID`), `config(env: object): {apiBase: string, databaseUrl: string, jwtSecret: string, dryRun: boolean}`.

- [ ] **Step 1: Write the failing test**

```js
// services/demo-traffic/src/__tests__/config.test.js
import { describe, it, expect } from 'vitest';
import { DEMO_COMMUNITY_ID, GATES, assertDemoCommunity, config } from '../config.js';

describe('config', () => {
  it('pins the demo community UUID', () => {
    expect(DEMO_COMMUNITY_ID).toBe('00000000-0000-0000-0000-000000000043');
  });

  it('defines three gates whose shares sum to 1', () => {
    expect(GATES).toHaveLength(3);
    const total = GATES.reduce((sum, g) => sum + g.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('refuses any community other than the demo one', () => {
    expect(() => assertDemoCommunity(DEMO_COMMUNITY_ID)).not.toThrow();
    expect(() => assertDemoCommunity('00000000-0000-0000-0000-000000000001'))
      .toThrow(/refusing/i);
  });

  it('reads settings from the environment', () => {
    const c = config({
      API_BASE: 'http://127.0.0.1:3000/api/v1',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      JWT_SECRET: 's3cret',
      DRY_RUN: 'true',
    });
    expect(c.apiBase).toBe('http://127.0.0.1:3000/api/v1');
    expect(c.jwtSecret).toBe('s3cret');
    expect(c.dryRun).toBe(true);
  });

  it('throws when JWT_SECRET is missing', () => {
    expect(() => config({ DATABASE_URL: 'x' })).toThrow(/JWT_SECRET/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo-traffic test`
Expected: FAIL — cannot resolve `../config.js`.

- [ ] **Step 3: Write the package files**

```json
// services/demo-traffic/package.json
{
  "name": "demo-traffic",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "seed": "node src/seed.js",
    "start": "node src/generate.js",
    "test": "vitest run"
  },
  "dependencies": {
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

```js
// services/demo-traffic/vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

```js
// services/demo-traffic/src/config.js
/**
 * Every constant that ties this package to one specific tenant.
 *
 * The community UUID is fixed rather than looked up by name so that a typo in a
 * name can never point the generator at a real society.
 */
export const DEMO_COMMUNITY_ID = '00000000-0000-0000-0000-000000000043';

export const GATES = [
  { id: '00000000-0000-0000-0000-000000043001', name: 'Main Entry',        type: 'entry',   share: 0.55 },
  { id: '00000000-0000-0000-0000-000000043002', name: 'Exit Gate',         type: 'exit',    share: 0.30 },
  { id: '00000000-0000-0000-0000-000000043003', name: 'Service & Vendor',  type: 'service', share: 0.15 },
];

export function assertDemoCommunity(id) {
  if (id !== DEMO_COMMUNITY_ID) {
    throw new Error(
      `refusing to operate on community ${id} — this tool only ever touches ${DEMO_COMMUNITY_ID}`
    );
  }
}

export function config(env) {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  return {
    apiBase: env.API_BASE || 'http://127.0.0.1:3000/api/v1',
    databaseUrl: env.DATABASE_URL || '',
    jwtSecret: env.JWT_SECRET,
    dryRun: env.DRY_RUN === 'true',
  };
}
```

- [ ] **Step 4: Install and run the tests**

Run: `pnpm install && pnpm --filter demo-traffic test`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add services/demo-traffic pnpm-lock.yaml
git commit -m "feat(demo): scaffold demo-traffic package with pinned tenant config"
```

---

### Task 2: Daily rhythm and Poisson arrivals

**Files:**
- Create: `services/demo-traffic/src/rhythm.js`
- Test: `services/demo-traffic/src/__tests__/rhythm.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `ratePerHour(hour: number, isWeekend: boolean): number`, `nextGapMs(rate: number, rand: () => number): number`, `mulberry32(seed: number): () => number`.

- [ ] **Step 1: Write the failing test**

```js
// services/demo-traffic/src/__tests__/rhythm.test.js
import { describe, it, expect } from 'vitest';
import { ratePerHour, nextGapMs, mulberry32 } from '../rhythm.js';

describe('ratePerHour', () => {
  it('is near-dead overnight and peaks in the morning rush', () => {
    expect(ratePerHour(3, false)).toBeLessThan(10);
    expect(ratePerHour(9, false)).toBeGreaterThan(100);
    expect(ratePerHour(3, false)).toBeLessThan(ratePerHour(9, false));
  });

  it('has a second peak in the evening', () => {
    expect(ratePerHour(19, false)).toBeGreaterThan(ratePerHour(15, false));
  });

  it('is positive for every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      expect(ratePerHour(h, false)).toBeGreaterThan(0);
      expect(ratePerHour(h, true)).toBeGreaterThan(0);
    }
  });

  it('flattens the commute peaks at weekends', () => {
    expect(ratePerHour(9, true)).toBeLessThan(ratePerHour(9, false));
  });

  it('sums to roughly 1150 events across a weekday', () => {
    let total = 0;
    for (let h = 0; h < 24; h++) total += ratePerHour(h, false);
    expect(total).toBeGreaterThan(1000);
    expect(total).toBeLessThan(1300);
  });
});

describe('nextGapMs', () => {
  it('averages close to 3600/rate seconds over many draws', () => {
    const rand = mulberry32(42);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += nextGapMs(60, rand);
    const meanSeconds = sum / n / 1000;
    expect(meanSeconds).toBeGreaterThan(50);
    expect(meanSeconds).toBeLessThan(70);
  });

  it('produces varied gaps, not a constant', () => {
    const rand = mulberry32(7);
    const gaps = new Set();
    for (let i = 0; i < 50; i++) gaps.add(nextGapMs(60, rand));
    expect(gaps.size).toBeGreaterThan(40);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo-traffic test rhythm`
Expected: FAIL — cannot resolve `../rhythm.js`.

- [ ] **Step 3: Write the implementation**

```js
// services/demo-traffic/src/rhythm.js
/**
 * Traffic shape for the demo society.
 *
 * Rates are community-wide (all three gates combined) and sum to ~1,150 events
 * on a weekday, matching the seeded history so today's bar doesn't tower over
 * the previous ten days.
 *
 * Gaps come from an exponential distribution — a Poisson process — because that
 * is what clusters events into natural bursts and lulls. A uniform random delay
 * produces an even drip that reads as synthetic to anyone who knows the domain.
 */

// index = hour of day, value = events/hour community-wide
const WEEKDAY = [
  8,  4,  3,  3,  3,  6,   // 00-05 near-dead
  20, 45, 130, 130, 70, 55, // 06-11 staff arrivals, office + school rush
  50, 45, 40, 40, 45, 70,  // 12-17 deliveries, school return
  110, 110, 90, 45, 25, 12, // 18-23 evening return peak, tapering
];

// Weekends: no commute spikes, more midday visitors, later nights.
const WEEKEND = [
  14, 8,  5,  3,  3,  5,
  12, 22, 40, 55, 70, 80,
  80, 75, 65, 60, 60, 70,
  85, 85, 75, 55, 35, 20,
];

export function ratePerHour(hour, isWeekend) {
  const table = isWeekend ? WEEKEND : WEEKDAY;
  return table[((hour % 24) + 24) % 24];
}

/**
 * Exponential inter-arrival gap for a Poisson process of `rate` events/hour.
 * Clamped below at 1s so a burst can't spin the loop.
 */
export function nextGapMs(rate, rand) {
  const safeRate = Math.max(rate, 0.5);
  const u = Math.max(rand(), 1e-9); // avoid log(0)
  const hours = -Math.log(u) / safeRate;
  return Math.max(1000, Math.round(hours * 3600 * 1000));
}

/** Small seeded PRNG so a re-run reproduces the same society. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter demo-traffic test rhythm`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add services/demo-traffic/src/rhythm.js services/demo-traffic/src/__tests__/rhythm.test.js
git commit -m "feat(demo): hour-of-day traffic rhythm with Poisson arrivals"
```

---

### Task 3: Faridabad plates and vehicle catalogue

**Files:**
- Create: `services/demo-traffic/src/plates.js`
- Test: `services/demo-traffic/src/__tests__/plates.test.js`

**Interfaces:**
- Consumes: `mulberry32` from `../rhythm.js`.
- Produces: `randomPlate(rand: () => number): {plate: string, display: string, series: string}`, `randomVehicle(rand: () => number): {make: string, model: string, color: string, type: string}` where `type` is `'car' | 'bike' | 'commercial'`.

- [ ] **Step 1: Write the failing test**

```js
// services/demo-traffic/src/__tests__/plates.test.js
import { describe, it, expect } from 'vitest';
import { randomPlate, randomVehicle } from '../plates.js';
import { mulberry32 } from '../rhythm.js';

const PLATE_RE = /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/;

describe('randomPlate', () => {
  it('produces a normalised Indian plate and a spaced display form', () => {
    const rand = mulberry32(3);
    const { plate, display } = randomPlate(rand);
    expect(plate).toMatch(PLATE_RE);
    expect(display.replace(/ /g, '')).toBe(plate);
  });

  it('is dominated by Faridabad series over many draws', () => {
    const rand = mulberry32(11);
    const counts = {};
    for (let i = 0; i < 4000; i++) {
      const { series } = randomPlate(rand);
      counts[series] = (counts[series] || 0) + 1;
    }
    const faridabad = (counts.HR51 || 0) + (counts.HR38 || 0);
    expect(faridabad / 4000).toBeGreaterThan(0.5);
    expect(counts.DL).toBeGreaterThan(0);
    expect(counts.HR26).toBeGreaterThan(0);
  });

  it('never emits a plate from outside the configured series', () => {
    const rand = mulberry32(5);
    const allowed = new Set(['HR51', 'HR38', 'DL', 'HR26', 'UP16']);
    for (let i = 0; i < 500; i++) {
      expect(allowed.has(randomPlate(rand).series)).toBe(true);
    }
  });
});

describe('randomVehicle', () => {
  it('returns a make, model, colour and type', () => {
    const rand = mulberry32(9);
    const v = randomVehicle(rand);
    expect(v.make).toBeTruthy();
    expect(v.model).toBeTruthy();
    expect(v.color).toBeTruthy();
    expect(['car', 'bike', 'commercial']).toContain(v.type);
  });

  it('is majority cars with a real two-wheeler population', () => {
    const rand = mulberry32(13);
    const counts = { car: 0, bike: 0, commercial: 0 };
    for (let i = 0; i < 2000; i++) counts[randomVehicle(rand).type]++;
    expect(counts.car / 2000).toBeGreaterThan(0.45);
    expect(counts.bike / 2000).toBeGreaterThan(0.25);
    expect(counts.commercial).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo-traffic test plates`
Expected: FAIL — cannot resolve `../plates.js`.

- [ ] **Step 3: Write the implementation**

```js
// services/demo-traffic/src/plates.js
/**
 * Vehicle identity generation weighted to Faridabad's catchment area.
 *
 * HR-51 and HR-38 are the Faridabad RTO series; DL, HR-26 (Gurgaon) and UP-16
 * appear because a large share of this belt commutes across state lines.
 */

const SERIES = [
  { code: 'HR51', prefix: 'HR', district: '51', weight: 45 },
  { code: 'DL',   prefix: 'DL', district: '01', weight: 20 },
  { code: 'HR38', prefix: 'HR', district: '38', weight: 15 },
  { code: 'HR26', prefix: 'HR', district: '26', weight: 10 },
  { code: 'UP16', prefix: 'UP', district: '16', weight: 10 },
];

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // no I/O/Q — not used on Indian plates

const CARS = [
  ['Maruti Suzuki', 'Swift'], ['Maruti Suzuki', 'Baleno'], ['Maruti Suzuki', 'Brezza'],
  ['Maruti Suzuki', 'WagonR'], ['Hyundai', 'i20'], ['Hyundai', 'Creta'],
  ['Hyundai', 'Venue'], ['Tata', 'Nexon'], ['Tata', 'Punch'], ['Honda', 'City'],
  ['Honda', 'Amaze'], ['Mahindra', 'Scorpio'], ['Mahindra', 'XUV700'],
  ['Toyota', 'Innova Crysta'], ['Kia', 'Seltos'], ['Kia', 'Sonet'],
];

const BIKES = [
  ['Honda', 'Activa'], ['Hero', 'Splendor Plus'], ['Hero', 'HF Deluxe'],
  ['Bajaj', 'Pulsar 150'], ['TVS', 'Jupiter'], ['Royal Enfield', 'Classic 350'],
  ['Suzuki', 'Access 125'], ['Yamaha', 'FZ'],
];

const COMMERCIAL = [
  ['Mahindra', 'Bolero Pickup'], ['Tata', 'Ace'], ['Piaggio', 'Ape E-City'],
  ['Mahindra', 'Treo'],
];

const COLORS = ['White', 'Silver', 'Grey', 'Red', 'Blue', 'Black', 'Brown', 'Maroon'];

function weightedPick(items, rand, weightOf) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

export function randomPlate(rand) {
  const series = weightedPick(SERIES, rand, (s) => s.weight);
  const letters = LETTERS[Math.floor(rand() * LETTERS.length)]
    + LETTERS[Math.floor(rand() * LETTERS.length)];
  const digits = String(Math.floor(rand() * 9000) + 1000);
  const plate = `${series.prefix}${series.district}${letters}${digits}`;
  const display = `${series.prefix} ${series.district} ${letters} ${digits}`;
  return { plate, display, series: series.code };
}

export function randomVehicle(rand) {
  const roll = rand();
  let make, model, type;
  if (roll < 0.55) {
    [make, model] = pick(CARS, rand);
    type = 'car';
  } else if (roll < 0.90) {
    [make, model] = pick(BIKES, rand);
    type = 'bike';
  } else {
    [make, model] = pick(COMMERCIAL, rand);
    type = 'commercial';
  }
  return { make, model, color: pick(COLORS, rand), type };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter demo-traffic test plates`
Expected: PASS, 5 tests.

> Real Delhi plates use codes like `DL3C`, which would not match the single
> normalised format `^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$` the rest of the platform
> assumes. `DL01` is used instead — a real series, and it keeps every plate in
> one shape.

- [ ] **Step 5: Commit**

```bash
git add services/demo-traffic/src/plates.js services/demo-traffic/src/__tests__/plates.test.js
git commit -m "feat(demo): Faridabad-weighted plate and vehicle generators"
```

---

### Task 4: Society population

**Files:**
- Create: `services/demo-traffic/src/population.js`
- Test: `services/demo-traffic/src/__tests__/population.test.js`

**Interfaces:**
- Consumes: `randomPlate`, `randomVehicle` from `../plates.js`; `mulberry32` from `../rhythm.js`.
- Produces: `buildPopulation(seed: number): {blocks: Block[], units: Unit[], residents: Resident[], vehicles: Vehicle[], guards: Resident[]}` where
  `Block = {id, name}`,
  `Unit = {id, blockId, unitNumber, floor, ownerName, status, wing, ownershipType}`,
  `Resident = {id, unitId, name, mobile, type, isPrimary, isCommittee}`,
  `Vehicle = {id, unitId, residentId, plate, plateDisplay, make, model, color, type, rfidUidHash, rfidCardNo}`.
  All `id`s are UUID strings generated with `crypto.randomUUID()`.

- [ ] **Step 1: Write the failing test**

```js
// services/demo-traffic/src/__tests__/population.test.js
import { describe, it, expect } from 'vitest';
import { buildPopulation } from '../population.js';

describe('buildPopulation', () => {
  const pop = buildPopulation(2043);

  it('builds 6 towers', () => {
    expect(pop.blocks).toHaveLength(6);
    expect(pop.blocks.map((b) => b.name)).toContain('Tower A');
    expect(pop.blocks.map((b) => b.name)).toContain('Tower F');
  });

  it('builds roughly 450 units across those towers', () => {
    expect(pop.units.length).toBeGreaterThanOrEqual(430);
    expect(pop.units.length).toBeLessThanOrEqual(470);
    const blockIds = new Set(pop.blocks.map((b) => b.id));
    for (const u of pop.units) expect(blockIds.has(u.blockId)).toBe(true);
  });

  it('numbers units as <tower letter>-<floor><nn>', () => {
    for (const u of pop.units.slice(0, 20)) {
      expect(u.unitNumber).toMatch(/^[A-F]-\d{3,4}$/);
    }
  });

  it('gives every occupied unit exactly one primary resident', () => {
    const occupied = pop.units.filter((u) => u.status === 'occupied');
    for (const u of occupied.slice(0, 30)) {
      const primaries = pop.residents.filter((r) => r.unitId === u.id && r.isPrimary);
      expect(primaries).toHaveLength(1);
    }
  });

  it('leaves a realistic tail of unoccupied units', () => {
    const statuses = new Set(pop.units.map((u) => u.status));
    expect(statuses.has('occupied')).toBe(true);
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('builds around 600 vehicles with unique plates', () => {
    expect(pop.vehicles.length).toBeGreaterThanOrEqual(550);
    expect(pop.vehicles.length).toBeLessThanOrEqual(680);
    const plates = new Set(pop.vehicles.map((v) => v.plate));
    expect(plates.size).toBe(pop.vehicles.length);
  });

  it('gives most vehicles an RFID tag but not all', () => {
    const tagged = pop.vehicles.filter((v) => v.rfidUidHash).length;
    expect(tagged).toBeGreaterThan(pop.vehicles.length * 0.6);
    expect(tagged).toBeLessThan(pop.vehicles.length);
  });

  it('builds guards across three shifts', () => {
    expect(pop.guards.length).toBeGreaterThanOrEqual(6);
    for (const g of pop.guards) expect(g.type).toBe('guard');
  });

  it('is deterministic for a given seed', () => {
    const again = buildPopulation(2043);
    expect(again.units.length).toBe(pop.units.length);
    expect(again.vehicles.map((v) => v.plate)).toEqual(pop.vehicles.map((v) => v.plate));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo-traffic test population`
Expected: FAIL — cannot resolve `../population.js`.

- [ ] **Step 3: Write the implementation**

```js
// services/demo-traffic/src/population.js
import { randomUUID, createHash } from 'node:crypto';
import { mulberry32 } from './rhythm.js';
import { randomPlate, randomVehicle } from './plates.js';

const FIRST_NAMES = [
  'Rajesh', 'Sunita', 'Amit', 'Priya', 'Vikram', 'Neha', 'Sanjay', 'Kavita',
  'Deepak', 'Anjali', 'Manoj', 'Pooja', 'Rohit', 'Meenakshi', 'Ashok', 'Ritu',
  'Naveen', 'Shalini', 'Gaurav', 'Preeti', 'Yogesh', 'Rekha', 'Ankit', 'Suman',
  'Harish', 'Jyoti', 'Mukesh', 'Nisha', 'Pankaj', 'Seema',
];

const SURNAMES = [
  'Sharma', 'Yadav', 'Chauhan', 'Gupta', 'Bhardwaj', 'Singh', 'Verma', 'Aggarwal',
  'Malik', 'Rathi', 'Tyagi', 'Khatri', 'Saini', 'Dahiya', 'Nagar', 'Chopra',
  'Kaushik', 'Bansal', 'Ahuja', 'Sehgal',
];

const TOWERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const FLOORS = 12;
const UNITS_PER_FLOOR = 6;   // 6 towers x 12 floors x 6 = 432 units
const GUARD_NAMES = [
  'Ram Kishan', 'Dharmveer Singh', 'Satish Kumar', 'Bijender Pal',
  'Om Prakash', 'Jaipal Yadav', 'Mahesh Chand', 'Kuldeep Rana',
];

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

function personName(rand) {
  return `${pick(FIRST_NAMES, rand)} ${pick(SURNAMES, rand)}`;
}

function mobile(rand) {
  // Indian mobile numbers start 6-9; the DB column is VARCHAR(15).
  const first = 6 + Math.floor(rand() * 4);
  let rest = '';
  for (let i = 0; i < 9; i++) rest += Math.floor(rand() * 10);
  return `${first}${rest}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function buildPopulation(seed) {
  const rand = mulberry32(seed);

  const blocks = TOWERS.map((letter) => ({ id: randomUUID(), name: `Tower ${letter}`, letter }));

  const units = [];
  for (const block of blocks) {
    for (let floor = 1; floor <= FLOORS; floor++) {
      for (let n = 1; n <= UNITS_PER_FLOOR; n++) {
        const roll = rand();
        const status = roll < 0.90 ? 'occupied' : roll < 0.97 ? 'rented' : 'vacant';
        units.push({
          id: randomUUID(),
          blockId: block.id,
          unitNumber: `${block.letter}-${floor}${String(n).padStart(2, '0')}`,
          floor,
          ownerName: personName(rand),
          status,
          wing: block.letter,
          ownershipType: status === 'rented' ? 'tenant' : 'owner',
        });
      }
    }
  }

  const residents = [];
  for (const unit of units) {
    if (unit.status === 'vacant') continue;
    const primary = {
      id: randomUUID(),
      unitId: unit.id,
      name: unit.ownerName,
      mobile: mobile(rand),
      type: unit.ownershipType,
      isPrimary: true,
      isCommittee: rand() < 0.02,
    };
    residents.push(primary);
    // Roughly half the homes register a second adult.
    if (rand() < 0.5) {
      residents.push({
        id: randomUUID(),
        unitId: unit.id,
        name: personName(rand),
        mobile: mobile(rand),
        type: 'family',
        isPrimary: false,
        isCommittee: false,
      });
    }
  }

  const vehicles = [];
  const seenPlates = new Set();
  for (const unit of units) {
    if (unit.status === 'vacant') continue;
    const owner = residents.find((r) => r.unitId === unit.id && r.isPrimary);
    const count = rand() < 0.35 ? 2 : 1;  // ~1.35 vehicles per home
    for (let i = 0; i < count; i++) {
      let plate = randomPlate(rand);
      while (seenPlates.has(plate.plate)) plate = randomPlate(rand);
      seenPlates.add(plate.plate);

      const spec = randomVehicle(rand);
      const tagged = rand() < 0.8;
      const cardNo = tagged ? String(43000000 + vehicles.length) : null;
      vehicles.push({
        id: randomUUID(),
        unitId: unit.id,
        residentId: owner.id,
        plate: plate.plate,
        plateDisplay: plate.display,
        make: spec.make,
        model: spec.model,
        color: spec.color,
        type: spec.type,
        rfidUidHash: cardNo ? sha256(cardNo) : null,
        rfidCardNo: cardNo,
      });
    }
  }

  const guards = GUARD_NAMES.map((name) => ({
    id: randomUUID(),
    unitId: null,
    name,
    mobile: mobile(rand),
    type: 'guard',
    isPrimary: false,
    isCommittee: false,
  }));

  return { blocks, units, residents, vehicles, guards };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter demo-traffic test population`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add services/demo-traffic/src/population.js services/demo-traffic/src/__tests__/population.test.js
git commit -m "feat(demo): generate the Greenfield society population"
```

---

### Task 5: Gate-event builder

**Files:**
- Create: `services/demo-traffic/src/event.js`
- Test: `services/demo-traffic/src/__tests__/event.test.js`

**Interfaces:**
- Consumes: `GATES`, `DEMO_COMMUNITY_ID` from `../config.js`; population objects from `../population.js`.
- Produces: `buildEvent({pop, gate, at, rand}): object` returning a payload matching `eventSyncItemSchema` — keys `community_id`, `gate_id`, `detection_method`, `raw_value`, `matched_vehicle_id`, `matched_unit_id`, `matched_unit_number`, `resident_name`, `access_decision`, `direction`, `deny_reason`, `anpr_confidence`, `processing_ms`, `is_offline_event`, `event_ts`.

- [ ] **Step 1: Write the failing test**

```js
// services/demo-traffic/src/__tests__/event.test.js
import { describe, it, expect } from 'vitest';
import { buildEvent } from '../event.js';
import { buildPopulation } from '../population.js';
import { mulberry32 } from '../rhythm.js';
import { GATES, DEMO_COMMUNITY_ID } from '../config.js';
import { eventSyncItemSchema } from '../../../api-gateway/src/schemas/event-sync.js';

const pop = buildPopulation(2043);

describe('buildEvent', () => {
  it('produces payloads that satisfy the real ingestion contract', () => {
    const rand = mulberry32(21);
    for (let i = 0; i < 300; i++) {
      const evt = buildEvent({ pop, gate: GATES[i % 3], at: new Date(), rand });
      const parsed = eventSyncItemSchema.safeParse(evt);
      if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
      expect(parsed.success).toBe(true);
    }
  });

  it('always targets the demo community and the given gate', () => {
    const rand = mulberry32(22);
    const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
    expect(evt.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(evt.gate_id).toBe(GATES[0].id);
  });

  it('marks events as live, not offline syncs', () => {
    const rand = mulberry32(23);
    const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
    expect(evt.is_offline_event).toBe(false);
  });

  it('is overwhelmingly allow, with a small deny and review tail', () => {
    const rand = mulberry32(24);
    const counts = {};
    for (let i = 0; i < 5000; i++) {
      const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
      counts[evt.access_decision] = (counts[evt.access_decision] || 0) + 1;
    }
    expect(counts.allow / 5000).toBeGreaterThan(0.85);
    expect(counts.allow / 5000).toBeLessThan(0.97);
    expect(counts.deny).toBeGreaterThan(0);
    expect(counts.guard_review).toBeGreaterThan(0);
  });

  it('always gives a denied event a reason', () => {
    const rand = mulberry32(25);
    for (let i = 0; i < 2000; i++) {
      const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
      if (evt.access_decision === 'deny') expect(evt.deny_reason).toBeTruthy();
    }
  });

  it('attaches a confidence score to ANPR reads only', () => {
    const rand = mulberry32(26);
    for (let i = 0; i < 1000; i++) {
      const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
      if (evt.detection_method === 'anpr') {
        expect(evt.anpr_confidence).toBeGreaterThan(0);
        expect(evt.anpr_confidence).toBeLessThanOrEqual(1);
      } else {
        expect(evt.anpr_confidence).toBeNull();
      }
    }
  });

  it('resolves known vehicles to their unit and resident', () => {
    const rand = mulberry32(27);
    let matched = 0;
    for (let i = 0; i < 500; i++) {
      const evt = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });
      if (evt.matched_vehicle_id) {
        expect(evt.matched_unit_number).toBeTruthy();
        expect(evt.resident_name).toBeTruthy();
        matched++;
      }
    }
    expect(matched).toBeGreaterThan(300);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo-traffic test event`
Expected: FAIL — cannot resolve `../event.js`.

- [ ] **Step 3: Write the implementation**

```js
// services/demo-traffic/src/event.js
import { DEMO_COMMUNITY_ID } from './config.js';

/**
 * One gate event, shaped like something a real edge node would send.
 *
 * Most traffic is a resident the system already knows; the tail is what makes a
 * demo credible — the odd unreadable plate, an expired visitor pass, a guard
 * waving someone through.
 */

const DENY_REASONS = [
  'Vehicle not on whitelist',
  'Visitor pass expired',
  'Plate on blacklist',
  'Plate unreadable — manual check required',
  'Outside permitted access hours',
];

// Per-gate method weights: the service gate sees couriers and hand-entry, the
// main gate is mostly tags and camera reads.
const METHODS_BY_GATE = {
  entry:   [['rfid', 55], ['anpr', 30], ['qr', 8], ['manual', 5], ['face', 2]],
  exit:    [['rfid', 50], ['anpr', 40], ['manual', 8], ['qr', 2]],
  service: [['manual', 45], ['qr', 30], ['anpr', 20], ['rfid', 5]],
};

function weightedPick(pairs, rand) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, weight] of pairs) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

export function buildEvent({ pop, gate, at, rand }) {
  const method = weightedPick(METHODS_BY_GATE[gate.type] || METHODS_BY_GATE.entry, rand);

  // 88% of traffic is a resident vehicle the platform already knows.
  const known = rand() < 0.88;
  const vehicle = known ? pick(pop.vehicles, rand) : null;
  const unit = vehicle ? pop.units.find((u) => u.id === vehicle.unitId) : null;
  const resident = vehicle ? pop.residents.find((r) => r.id === vehicle.residentId) : null;

  const decisionRoll = rand();
  let decision;
  if (!known) {
    // Strangers are the source of most denies and reviews.
    decision = decisionRoll < 0.45 ? 'deny' : decisionRoll < 0.9 ? 'guard_review' : 'override';
  } else {
    decision = decisionRoll < 0.985 ? 'allow' : decisionRoll < 0.995 ? 'guard_review' : 'deny';
  }

  const direction = gate.type === 'exit'
    ? 'exit'
    : gate.type === 'entry'
      ? 'entry'
      : rand() < 0.5 ? 'entry' : 'exit';

  return {
    community_id: DEMO_COMMUNITY_ID,
    gate_id: gate.id,
    detection_method: method,
    raw_value: vehicle ? vehicle.plate : `UNKNOWN${Math.floor(rand() * 9000) + 1000}`,
    matched_vehicle_id: vehicle ? vehicle.id : null,
    matched_unit_id: unit ? unit.id : null,
    matched_unit_number: unit ? unit.unitNumber : null,
    resident_name: resident ? resident.name : null,
    access_decision: decision,
    direction,
    deny_reason: decision === 'deny' ? pick(DENY_REASONS, rand) : null,
    // Only the camera produces a confidence score.
    anpr_confidence: method === 'anpr'
      ? Math.round((0.72 + rand() * 0.27) * 100) / 100
      : null,
    processing_ms: 80 + Math.floor(rand() * 520),
    is_offline_event: false,
    event_ts: at.toISOString(),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter demo-traffic test event`
Expected: PASS, 7 tests. If the contract test fails on `is_offline_event`, that is expected until Task 6 — run Task 6 first and re-run.

- [ ] **Step 5: Commit**

```bash
git add services/demo-traffic/src/event.js services/demo-traffic/src/__tests__/event.test.js
git commit -m "feat(demo): realistic gate-event builder validated against the ingestion contract"
```

---

### Task 6: Let the ingestion contract carry `is_offline_event`

`routes/gates.js:206` hardcodes `is_offline_event = true`, so generated traffic would look like a permanent offline backlog and skew the edge-health and attention panels. Make the field optional, **defaulting to `true`** so real edge nodes are unaffected.

**Files:**
- Modify: `services/api-gateway/src/schemas/event-sync.js`
- Modify: `services/api-gateway/src/routes/gates.js:206-270`
- Modify: `services/gate-command-service/src/routes.js` (the mirrored schema)
- Test: `services/api-gateway/src/__tests__/event-sync-contract.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `eventSyncItemSchema` gains `is_offline_event: z.boolean().optional()`.

- [ ] **Step 1: Write the failing test**

Append to `services/api-gateway/src/__tests__/event-sync-contract.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { eventSyncItemSchema } from '../schemas/event-sync.js';

const base = {
  community_id: '00000000-0000-0000-0000-000000000043',
  gate_id: '00000000-0000-0000-0000-000000043001',
  detection_method: 'rfid',
  access_decision: 'allow',
  event_ts: '2026-07-31T10:00:00.000Z',
};

describe('is_offline_event', () => {
  it('accepts an explicit false', () => {
    const parsed = eventSyncItemSchema.safeParse({ ...base, is_offline_event: false });
    expect(parsed.success).toBe(true);
    expect(parsed.data.is_offline_event).toBe(false);
  });

  it('accepts an explicit true', () => {
    const parsed = eventSyncItemSchema.safeParse({ ...base, is_offline_event: true });
    expect(parsed.success).toBe(true);
  });

  it('stays optional so existing edge payloads still validate', () => {
    const parsed = eventSyncItemSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.data.is_offline_event).toBeUndefined();
  });

  it('rejects a non-boolean', () => {
    const parsed = eventSyncItemSchema.safeParse({ ...base, is_offline_event: 'yes' });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api-gateway test event-sync-contract`
Expected: FAIL — `is_offline_event: 'yes'` is stripped rather than rejected, and `false` does not survive parsing.

- [ ] **Step 3: Widen the schema**

In `services/api-gateway/src/schemas/event-sync.js`, add to `eventSyncItemSchema`:

```js
  // Whether this event was buffered on the edge and synced late. Optional and
  // defaulted at the handler, not here, so payloads from existing edge builds —
  // which never send it — keep their historical meaning of "synced offline".
  is_offline_event: z.boolean().optional(),
```

- [ ] **Step 4: Honour it in the handler**

In `services/api-gateway/src/routes/gates.js`, change the INSERT's hardcoded `true` to a parameter. Replace `is_offline_event, synced_at, event_ts)` / `VALUES ($1,…,$16,true,NOW(),$17)` with a `$17` placeholder for the flag and `$18` for the timestamp:

```js
         `INSERT INTO gate_events
           (id, community_id, gate_id, detection_method, raw_value,
            matched_vehicle_id, matched_pass_id, matched_unit_id,
            matched_unit_number, resident_name, access_decision,
            deny_reason, anpr_confidence, snapshot_s3_key,
            processing_ms, direction, is_offline_event, synced_at, event_ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),$18)`,
```

and in the parameter array, between `evt.direction || 'entry',` and `evt.event_ts,`:

```js
          evt.is_offline_event ?? true,
```

- [ ] **Step 5: Mirror the schema in gate-command-service**

Apply the same `is_offline_event: z.boolean().optional(),` line to the mirrored schema in `services/gate-command-service/src/routes.js`, as required by the note at the top of `schemas/event-sync.js`.

- [ ] **Step 6: Run the full api-gateway suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS, including the pre-existing contract tests.

- [ ] **Step 7: Run the Python edge-side contract test**

Run: `pytest tests/unit/test_event_sync_contract.py -v`
Expected: PASS — the edge half is unchanged and the field is optional.

- [ ] **Step 8: Commit**

```bash
git add services/api-gateway/src/schemas/event-sync.js \
        services/api-gateway/src/routes/gates.js \
        services/api-gateway/src/__tests__/event-sync-contract.test.js \
        services/gate-command-service/src/routes.js
git commit -m "feat(api): let /events/sync carry is_offline_event, defaulting to true"
```

---

### Task 7: Seed the tenant

**Files:**
- Create: `services/demo-traffic/src/seed.js`
- Create: `services/demo-traffic/src/breadth.js`
- Test: `services/demo-traffic/src/__tests__/breadth.test.js`

**Interfaces:**
- Consumes: `buildPopulation` from `../population.js`; `DEMO_COMMUNITY_ID`, `GATES`, `assertDemoCommunity` from `../config.js`.
- Produces: `buildBreadth(pop, rand, now): {passes, deliveries, incidents, notices, dues, facilities, bookings, polls, sosAlerts, pets, rfidCards, handovers}` — arrays of plain objects whose keys match the DB columns listed below; `seedAll(client): Promise<void>` in `seed.js`.

**Exact columns** (verified against the live DB — do not guess):

```
blocks            id, community_id, name
units             id, community_id, block_id, unit_number, floor, owner_name, status, wing, ownership_type
residents         id, community_id, unit_id, name, mobile, type, is_primary, is_committee
vehicles          id, community_id, unit_id, resident_id, plate, plate_display, make, model, color, type,
                  rfid_uid_hash, rfid_card_no
gates             id, community_id, name, type
visitor_passes    id, community_id, unit_id, created_by, visitor_name, visitor_mobile, otp, valid_from,
                  valid_until, max_uses, uses_count, status, visitor_vehicle
deliveries        id, community_id, gate_id, unit_id, company, note, status, logged_by, logged_by_name, created_at
incidents         id, community_id, gate_id, reported_by, reported_by_name, type, description, status, created_at
notices           id, community_id, category, title, body, author_name, author_unit, posted_by_role,
                  is_pinned, is_removed, created_at, last_activity_at
dues              id, community_id, unit_id, period, description, base_amount, penalty_amount, due_date,
                  status, created_at
facilities        id, community_id, name, sport, open_time, close_time, slot_minutes, is_active
facility_bookings id, community_id, facility_id, unit_id, resident_id, booking_date, start_time, end_time, status
polls             id, community_id, created_by, author_name, question, status, closes_at, created_at
sos_alerts        id, community_id, gate_id, raised_by, raised_by_name, type, note, status, created_at, resolved_at
pets              id, community_id, unit_id, name, species, breed, notes, is_active
rfid_cards        id, community_id, uid_hash, card_number, issued_to_unit, card_type, is_active, issued_at,
                  holder_name, access_start, access_end
shift_handovers   id, community_id, gate_id, guard_id, guard_name, note, created_at
```

- [ ] **Step 1: Write the failing test**

```js
// services/demo-traffic/src/__tests__/breadth.test.js
import { describe, it, expect } from 'vitest';
import { buildBreadth } from '../breadth.js';
import { buildPopulation } from '../population.js';
import { mulberry32 } from '../rhythm.js';

const pop = buildPopulation(2043);
const b = buildBreadth(pop, mulberry32(99), new Date('2026-07-31T12:00:00Z'));

describe('buildBreadth', () => {
  it('fills every portal section so no page is a dead end', () => {
    for (const key of ['passes', 'deliveries', 'incidents', 'notices', 'dues',
                       'facilities', 'bookings', 'polls', 'sosAlerts', 'pets',
                       'rfidCards', 'handovers']) {
      expect(b[key].length, `${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('uses courier brands a Faridabad society would actually see', () => {
    const companies = new Set(b.deliveries.map((d) => d.company));
    expect([...companies].some((c) => /Amazon|Flipkart|Blinkit|Zepto|Swiggy/.test(c)).valueOf()).toBe(true);
  });

  it('leaves some dues unpaid so the finance panel has something to show', () => {
    const statuses = new Set(b.dues.map((d) => d.status));
    expect(statuses.has('pending')).toBe(true);
  });

  it('resolves every SOS alert — an open one on a demo board looks alarming', () => {
    for (const a of b.sosAlerts) expect(a.status).toBe('resolved');
  });

  it('links every row to a real unit or gate from the population', () => {
    const unitIds = new Set(pop.units.map((u) => u.id));
    for (const d of b.dues) expect(unitIds.has(d.unit_id)).toBe(true);
    for (const p of b.pets) expect(unitIds.has(p.unit_id)).toBe(true);
  });

  it('gives staff cards a daily access window', () => {
    const staff = b.rfidCards.filter((c) => c.card_type === 'staff');
    expect(staff.length).toBeGreaterThan(0);
    for (const c of staff) {
      expect(c.access_start).toBeTruthy();
      expect(c.access_end).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo-traffic test breadth`
Expected: FAIL — cannot resolve `../breadth.js`.

- [ ] **Step 3: Write `breadth.js`**

Build each array from the population, using the column names above as object keys. Concrete requirements the tests pin:

```js
// services/demo-traffic/src/breadth.js
import { randomUUID, createHash } from 'node:crypto';
import { DEMO_COMMUNITY_ID, GATES } from './config.js';

const COURIERS = ['Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'Swiggy Instamart',
                  'Zomato', 'BigBasket', 'Delhivery', 'Blue Dart'];

const NOTICE_SEEDS = [
  ['maintenance', 'Water tanker schedule revised',
   'Tankers will now arrive at 7:00 AM and 5:30 PM daily until the HUDA supply line is restored.'],
  ['event', 'Annual General Meeting — 9 August',
   'The AGM will be held in the clubhouse at 11:00 AM. Agenda: maintenance revision, security audit, parking policy.'],
  ['security', 'Visitor entry now requires OTP verification',
   'All visitors must be approved through the resident app. Guards will not admit anyone on a phone call alone.'],
  ['event', 'Diwali celebration — cultural evening',
   'Cultural programme in the central lawn from 6 PM. Residents are requested to park in the basement.'],
  ['maintenance', 'Lift servicing in Tower C',
   'Tower C lift will be unavailable on Sunday between 10 AM and 2 PM for its annual service.'],
];

const INCIDENT_SEEDS = [
  ['tailgating', 'Two-wheeler followed a car through the boom without a tag read.'],
  ['wrong_parking', 'Visitor car parked in a resident bay in the Tower B basement.'],
  ['damage', 'Boom barrier arm clipped by a delivery tempo at the service gate.'],
  ['dispute', 'Argument between a resident and a cab driver over entry charges.'],
];

const STAFF_ROLES = [
  ['Sunita Devi', 'maid', '08:00', '18:00'],
  ['Ramesh Kumar', 'driver', '07:00', '21:00'],
  ['Kamla Bai', 'cook', '09:00', '15:00'],
  ['Shyam Lal', 'gardener', '06:00', '12:00'],
];

const FACILITY_SEEDS = [
  ['Clubhouse', 'community', '06:00', '22:00', 60],
  ['Gymnasium', 'fitness', '05:00', '23:00', 45],
  ['Swimming Pool', 'swimming', '06:00', '20:00', 60],
  ['Banquet Hall', 'events', '09:00', '23:00', 120],
  ['Tennis Court', 'tennis', '06:00', '21:00', 60],
];

// ... build and return the twelve arrays, keyed by DB column name.
export function buildBreadth(pop, rand, now) { /* see steps below */ }
```

Fill in `buildBreadth` so that:
- `passes`: 40 rows, `status` mixed `'active'`/`'expired'`, `valid_from`/`valid_until` straddling `now`, `visitor_vehicle` a plate string, `created_by` a resident id.
- `deliveries`: 60 rows across the last 3 days, `company` from `COURIERS`, `status` mixed `'pending'`/`'collected'`, `logged_by_name` a guard name.
- `incidents`: one per `INCIDENT_SEEDS` entry plus repeats to 12 rows, `status` mixed `'open'`/`'reviewed'`.
- `notices`: one per `NOTICE_SEEDS` entry, first one `is_pinned: true`, all `is_removed: false`, `posted_by_role: 'admin'`.
- `dues`: one per occupied unit for period `'2026-07'`, `base_amount` 2800–4200, ~15% `status: 'pending'` with a `penalty_amount`, rest `'paid'`.
- `facilities` / `bookings`: one per `FACILITY_SEEDS`; 30 bookings over the next 7 days, `status: 'confirmed'`.
- `polls`: 3 rows, one `'open'` and two `'closed'`.
- `sosAlerts`: 4 rows, **all** `status: 'resolved'` with a `resolved_at`.
- `pets`: 25 rows, species `'dog'`/`'cat'`, on random occupied units.
- `rfidCards`: one per tagged vehicle (`card_type: 'resident'`, no window) plus one per `STAFF_ROLES` entry (`card_type: 'staff'`, `holder_name`, `access_start`, `access_end` from the seed).
- `handovers`: 9 rows, three per day for three days, `guard_name` from `pop.guards`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter demo-traffic test breadth`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `seed.js`**

```js
// services/demo-traffic/src/seed.js
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { DEMO_COMMUNITY_ID, GATES, assertDemoCommunity, config } from './config.js';
import { buildPopulation } from './population.js';
import { buildBreadth } from './breadth.js';
import { buildHistory } from './history.js';   // added in Task 8
import { mulberry32 } from './rhythm.js';

const SEED = 2043;

// Child tables first — FK order. Every statement is scoped to the demo tenant.
const TABLES_IN_DELETE_ORDER = [
  'facility_bookings', 'facilities', 'poll_votes', 'poll_options', 'polls',
  'notice_replies', 'notices', 'due_payments', 'dues', 'pets', 'sos_alerts',
  'incidents', 'deliveries', 'shift_handovers', 'rfid_cards', 'visitor_passes',
  'gate_events', 'vehicles', 'residents', 'units', 'blocks', 'gates',
];

export async function seedAll(client) {
  assertDemoCommunity(DEMO_COMMUNITY_ID);
  await client.query('BEGIN');
  try {
    for (const table of TABLES_IN_DELETE_ORDER) {
      await client.query(`DELETE FROM ${table} WHERE community_id = $1`, [DEMO_COMMUNITY_ID]);
    }
    await client.query('DELETE FROM communities WHERE id = $1', [DEMO_COMMUNITY_ID]);

    await client.query(
      `INSERT INTO communities (id, name, city, total_units, address, contact_name, contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [DEMO_COMMUNITY_ID, 'Greenfield Faridabad Sector 43', 'Faridabad', 432,
       'Sector 43, Greenfield Colony, Faridabad, Haryana 121010',
       'RWA Office', '9812345600']
    );

    for (const gate of GATES) {
      await client.query(
        `INSERT INTO gates (id, community_id, name, type) VALUES ($1,$2,$3,$4)`,
        [gate.id, DEMO_COMMUNITY_ID, gate.name, gate.type]
      );
    }

    const pop = buildPopulation(SEED);
    // ... bulk INSERT blocks, units, residents (incl. guards), vehicles
    const breadth = buildBreadth(pop, mulberry32(SEED + 1), new Date());
    // ... bulk INSERT each breadth array

    await client.query('COMMIT');
    return pop;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { databaseUrl } = config(process.env);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const pop = await seedAll(client);
  console.log(`seeded ${pop.units.length} units, ${pop.vehicles.length} vehicles`);
  await client.end();
}
```

- [ ] **Step 6: Commit**

```bash
git add services/demo-traffic/src/seed.js services/demo-traffic/src/breadth.js \
        services/demo-traffic/src/__tests__/breadth.test.js
git commit -m "feat(demo): seed the Greenfield tenant and every portal section"
```

---

### Task 8: Backfill ten days of history

**Files:**
- Modify: `services/demo-traffic/src/seed.js`
- Create: `services/demo-traffic/src/history.js`
- Test: `services/demo-traffic/src/__tests__/history.test.js`

**Interfaces:**
- Consumes: `ratePerHour`, `mulberry32` from `../rhythm.js`; `buildEvent` from `../event.js`; `GATES` from `../config.js`.
- Produces: `buildHistory({pop, days, until, rand}): object[]` — an array of event payloads with past `event_ts` values.

- [ ] **Step 1: Write the failing test**

```js
// services/demo-traffic/src/__tests__/history.test.js
import { describe, it, expect } from 'vitest';
import { buildHistory } from '../history.js';
import { buildPopulation } from '../population.js';
import { mulberry32 } from '../rhythm.js';

const pop = buildPopulation(2043);
const until = new Date('2026-07-31T12:00:00Z');
const events = buildHistory({ pop, days: 10, until, rand: mulberry32(5) });

describe('buildHistory', () => {
  it('produces roughly ten days of traffic', () => {
    expect(events.length).toBeGreaterThan(9000);
    expect(events.length).toBeLessThan(14000);
  });

  it('never emits an event in the future', () => {
    for (const e of events) expect(new Date(e.event_ts) <= until).toBe(true);
  });

  it('covers all ten days', () => {
    const days = new Set(events.map((e) => e.event_ts.slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(10);
  });

  it('is busier at 9am than at 3am', () => {
    const at = (h) => events.filter((e) => new Date(e.event_ts).getUTCHours() === h).length;
    expect(at(9)).toBeGreaterThan(at(3));
  });

  it('spreads traffic across all three gates', () => {
    const gates = new Set(events.map((e) => e.gate_id));
    expect(gates.size).toBe(3);
  });

  it('returns events in ascending time order', () => {
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].event_ts) >= new Date(events[i - 1].event_ts)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo-traffic test history`
Expected: FAIL — cannot resolve `../history.js`.

- [ ] **Step 3: Write the implementation**

```js
// services/demo-traffic/src/history.js
import { ratePerHour } from './rhythm.js';
import { buildEvent } from './event.js';
import { GATES } from './config.js';

function pickGate(rand) {
  let roll = rand();
  for (const gate of GATES) {
    roll -= gate.share;
    if (roll <= 0) return gate;
  }
  return GATES[GATES.length - 1];
}

/**
 * Walks backwards `days` days hour by hour, emitting the number of events that
 * hour's rate calls for. Uses a per-hour count rather than the live generator's
 * Poisson gaps because the backfill only needs the right shape, not the right
 * arrival process — and a count is far cheaper for 11k rows.
 */
export function buildHistory({ pop, days, until, rand }) {
  const events = [];
  const start = new Date(until.getTime() - days * 24 * 3600 * 1000);

  for (let cursor = new Date(start); cursor <= until; cursor = new Date(cursor.getTime() + 3600 * 1000)) {
    const day = cursor.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const rate = ratePerHour(cursor.getUTCHours(), isWeekend);
    // Vary each hour by ±25% so no two days are identical.
    const count = Math.max(0, Math.round(rate * (0.75 + rand() * 0.5)));

    for (let i = 0; i < count; i++) {
      const at = new Date(cursor.getTime() + Math.floor(rand() * 3600 * 1000));
      if (at > until) continue;
      events.push(buildEvent({ pop, gate: pickGate(rand), at, rand }));
    }
  }

  events.sort((a, b) => a.event_ts.localeCompare(b.event_ts));
  return events;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter demo-traffic test history`
Expected: PASS, 6 tests.

- [ ] **Step 5: Insert the history in `seed.js`**

Add to `seedAll`, before `COMMIT`, batching inserts 500 rows at a time so a single statement doesn't blow up:

```js
  const history = buildHistory({ pop, days: 10, until: new Date(), rand: mulberry32(SEED + 2) });
  for (let i = 0; i < history.length; i += 500) {
    const batch = history.slice(i, i + 500);
    const values = [];
    const params = [];
    batch.forEach((e, n) => {
      const b = n * 14;
      values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14})`);
      params.push(
        randomUUID(), e.community_id, e.gate_id, e.detection_method, e.raw_value,
        e.matched_vehicle_id, e.matched_unit_id, e.matched_unit_number,
        e.resident_name, e.access_decision, e.deny_reason, e.anpr_confidence,
        e.processing_ms, e.event_ts
      );
    });
    await client.query(
      `INSERT INTO gate_events
         (id, community_id, gate_id, detection_method, raw_value,
          matched_vehicle_id, matched_unit_id, matched_unit_number,
          resident_name, access_decision, deny_reason, anpr_confidence,
          processing_ms, event_ts)
       VALUES ${values.join(',')}`,
      params
    );
  }
```

- [ ] **Step 6: Commit**

```bash
git add services/demo-traffic/src/history.js services/demo-traffic/src/seed.js \
        services/demo-traffic/src/__tests__/history.test.js
git commit -m "feat(demo): backfill ten days of gate history so charts are full at first login"
```

---

### Task 9: The always-on generator

**Files:**
- Create: `services/demo-traffic/src/generate.js`
- Test: `services/demo-traffic/src/__tests__/generate.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `deviceToken(gateId: string, secret: string): string` (a 24h JWT carrying `community_id` and `gate_id`), `postEvent(payload: object, opts: {apiBase, token, fetchImpl}): Promise<{ok: boolean, status: number}>`, `loadPopulation(client): Promise<{units, residents, vehicles, guards}>`.

> **Amendment (ruling, 31 Jul).** An earlier draft had this task call
> `buildPopulation(2043)` to reconstruct the society in the generator process.
> That is wrong: `population.js` mints ids with `randomUUID()`, which ignores the
> seed, so the generator would reference vehicles and units that do not exist in
> the seeded rows. `gate_events` declares `matched_vehicle_id` with no
> `REFERENCES` clause, so this fails **silently** — events insert cleanly and the
> portal shows dead links. The generator therefore **loads the real ids from the
> database** via `loadPopulation`, which also means it picks up anything edited
> in the portal.

- [ ] **Step 1: Write the failing test**

```js
// services/demo-traffic/src/__tests__/generate.test.js
import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { deviceToken, postEvent } from '../generate.js';
import { DEMO_COMMUNITY_ID, GATES } from '../config.js';

describe('deviceToken', () => {
  it('mints a token the device middleware will accept', () => {
    const token = deviceToken(GATES[0].id, 'test-secret');
    const decoded = jwt.verify(token, 'test-secret');
    expect(decoded.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(decoded.gate_id).toBe(GATES[0].id);
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('will not verify under a different secret', () => {
    const token = deviceToken(GATES[0].id, 'test-secret');
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});

describe('postEvent', () => {
  it('posts a single-event batch with the device header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const payload = { community_id: DEMO_COMMUNITY_ID, gate_id: GATES[0].id };

    const result = await postEvent(payload, {
      apiBase: 'http://api/api/v1', token: 'tok', fetchImpl,
    });

    expect(result.ok).toBe(true);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api/api/v1/events/sync');
    expect(options.headers['X-Device-Token']).toBe('tok');
    expect(JSON.parse(options.body)).toEqual({ events: [payload] });
  });

  it('reports failure without throwing, so one bad post cannot kill the loop', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await postEvent({}, { apiBase: 'http://api/api/v1', token: 't', fetchImpl });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo-traffic test generate`
Expected: FAIL — cannot resolve `../generate.js`.

- [ ] **Step 3: Write the implementation**

```js
// services/demo-traffic/src/generate.js
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { DEMO_COMMUNITY_ID, GATES, assertDemoCommunity, config } from './config.js';
import { buildEvent } from './event.js';
import { ratePerHour, nextGapMs, mulberry32 } from './rhythm.js';

const TOKEN_TTL_SECONDS = 24 * 3600;
const TOKEN_REFRESH_MS = 12 * 3600 * 1000;

/**
 * Read the seeded society back out of the database.
 *
 * The generator must reference the ids that actually exist in the rows, so it
 * queries them rather than regenerating a population whose ids would differ.
 * Shape matches what buildEvent expects from buildPopulation().
 */
export async function loadPopulation(client) {
  const { rows: units } = await client.query(
    `SELECT id, unit_number AS "unitNumber" FROM units WHERE community_id = $1`,
    [DEMO_COMMUNITY_ID]
  );
  const { rows: residents } = await client.query(
    `SELECT id, unit_id AS "unitId", name, type, is_primary AS "isPrimary"
       FROM residents WHERE community_id = $1`,
    [DEMO_COMMUNITY_ID]
  );
  const { rows: vehicles } = await client.query(
    `SELECT id, unit_id AS "unitId", resident_id AS "residentId", plate
       FROM vehicles WHERE community_id = $1 AND is_active = true`,
    [DEMO_COMMUNITY_ID]
  );
  return {
    units,
    residents: residents.filter((r) => r.type !== 'guard'),
    vehicles,
    guards: residents.filter((r) => r.type === 'guard'),
  };
}

export function deviceToken(gateId, secret) {
  return jwt.sign(
    { community_id: DEMO_COMMUNITY_ID, gate_id: gateId },
    secret,
    { expiresIn: TOKEN_TTL_SECONDS }
  );
}

export async function postEvent(payload, { apiBase, token, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${apiBase}/events/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
      body: JSON.stringify({ events: [payload] }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    // Never throw: the API restarting must not take the generator with it.
    console.error('[demo-traffic] post failed:', err.message);
    return { ok: false, status: 0 };
  }
}

function pickGate(rand) {
  let roll = rand();
  for (const gate of GATES) {
    roll -= gate.share;
    if (roll <= 0) return gate;
  }
  return GATES[GATES.length - 1];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { apiBase, jwtSecret, databaseUrl, dryRun } = config(process.env);
  assertDemoCommunity(DEMO_COMMUNITY_ID);

  // Load the society from the database, NOT from buildPopulation(): ids are
  // minted per-run, so a rebuilt population would reference rows that were
  // never inserted. See the amendment note in this task.
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const pop = await loadPopulation(db);
  if (!pop.vehicles.length) {
    throw new Error('no vehicles found for the demo community — run src/seed.js first');
  }
  const rand = mulberry32(Date.now() % 2 ** 31);

  let tokens = Object.fromEntries(GATES.map((g) => [g.id, deviceToken(g.id, jwtSecret)]));
  let tokensMintedAt = Date.now();

  console.log(`[demo-traffic] started — ${dryRun ? 'DRY RUN' : apiBase}`);

  for (;;) {
    if (Date.now() - tokensMintedAt > TOKEN_REFRESH_MS) {
      tokens = Object.fromEntries(GATES.map((g) => [g.id, deviceToken(g.id, jwtSecret)]));
      tokensMintedAt = Date.now();
    }

    const now = new Date();
    const day = now.getDay();
    const rate = ratePerHour(now.getHours(), day === 0 || day === 6);
    const gate = pickGate(rand);
    const payload = buildEvent({ pop, gate, at: now, rand });

    if (dryRun) {
      console.log(JSON.stringify(payload));
    } else {
      await postEvent(payload, { apiBase, token: tokens[gate.id] });
    }

    await sleep(nextGapMs(rate, rand));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[demo-traffic] fatal:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter demo-traffic test`
Expected: PASS — the whole package suite.

- [ ] **Step 5: Eyeball a dry run**

Run: `cd services/demo-traffic && JWT_SECRET=x DRY_RUN=true node src/generate.js`
Expected: a JSON event every few seconds, with plausible plates, units and decisions. Stop with Ctrl-C after ~20 events and read them — this is the realism check no test can make for you.

- [ ] **Step 6: Commit**

```bash
git add services/demo-traffic/src/generate.js services/demo-traffic/src/__tests__/generate.test.js
git commit -m "feat(demo): always-on generator posting through the real ingestion API"
```

---

### Task 9b: Keep deliveries and visitors moving too

Spec §5 requires that the Deliveries and Visitors pages aren't frozen snapshots. Gate events alone don't touch those tables, so the generator writes them directly — a few per hour, which is the real-world rate.

**Files:**
- Create: `services/demo-traffic/src/trickle.js`
- Modify: `services/demo-traffic/src/generate.js`
- Test: `services/demo-traffic/src/__tests__/trickle.test.js`

**Interfaces:**
- Consumes: population from `../population.js`; `DEMO_COMMUNITY_ID`, `GATES` from `../config.js`.
- Produces: `newDelivery(pop, rand, now): object` and `newPass(pop, rand, now): object`, each keyed by DB column name; `insertTrickle(client, row, table): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```js
// services/demo-traffic/src/__tests__/trickle.test.js
import { describe, it, expect } from 'vitest';
import { newDelivery, newPass } from '../trickle.js';
import { buildPopulation } from '../population.js';
import { mulberry32 } from '../rhythm.js';
import { DEMO_COMMUNITY_ID } from '../config.js';

const pop = buildPopulation(2043);
const now = new Date('2026-07-31T12:00:00Z');

describe('newDelivery', () => {
  it('is scoped to the demo community and a real unit', () => {
    const d = newDelivery(pop, mulberry32(1), now);
    expect(d.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(pop.units.some((u) => u.id === d.unit_id)).toBe(true);
    expect(d.company).toBeTruthy();
    expect(d.status).toBe('pending');
  });
});

describe('newPass', () => {
  it('creates a currently-valid visitor pass', () => {
    const p = newPass(pop, mulberry32(2), now);
    expect(p.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(new Date(p.valid_from) <= now).toBe(true);
    expect(new Date(p.valid_until) > now).toBe(true);
    expect(p.status).toBe('active');
    expect(p.otp).toMatch(/^\d{6}$/);
  });

  it('attributes the pass to a resident of the unit it targets', () => {
    const p = newPass(pop, mulberry32(3), now);
    const creator = pop.residents.find((r) => r.id === p.created_by);
    expect(creator).toBeTruthy();
    expect(creator.unitId).toBe(p.unit_id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo-traffic test trickle`
Expected: FAIL — cannot resolve `../trickle.js`.

- [ ] **Step 3: Write the implementation**

```js
// services/demo-traffic/src/trickle.js
import { randomUUID } from 'node:crypto';
import { DEMO_COMMUNITY_ID, GATES } from './config.js';

const COURIERS = ['Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'Swiggy Instamart',
                  'Zomato', 'BigBasket', 'Delhivery', 'Blue Dart'];

const VISITOR_NAMES = ['Ravi Kumar', 'Sandeep Singh', 'Anita Rani', 'Mohit Garg',
                       'Kiran Bala', 'Ajay Thakur', 'Poonam Devi', 'Sagar Mehta'];

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

function occupiedUnit(pop, rand) {
  const occupied = pop.units.filter((u) => u.status !== 'vacant');
  return pick(occupied, rand);
}

export function newDelivery(pop, rand, now) {
  const unit = occupiedUnit(pop, rand);
  const guard = pick(pop.guards, rand);
  const serviceGate = GATES.find((g) => g.type === 'service') || GATES[0];
  return {
    id: randomUUID(),
    community_id: DEMO_COMMUNITY_ID,
    gate_id: serviceGate.id,
    unit_id: unit.id,
    company: pick(COURIERS, rand),
    note: `Parcel held at gate for ${unit.unitNumber}`,
    status: 'pending',
    logged_by: guard.id,
    logged_by_name: guard.name,
    created_at: now.toISOString(),
  };
}

export function newPass(pop, rand, now) {
  const unit = occupiedUnit(pop, rand);
  const host = pop.residents.find((r) => r.unitId === unit.id && r.isPrimary);
  const otp = String(Math.floor(rand() * 900000) + 100000);
  return {
    id: randomUUID(),
    community_id: DEMO_COMMUNITY_ID,
    unit_id: unit.id,
    created_by: host.id,
    visitor_name: pick(VISITOR_NAMES, rand),
    visitor_mobile: `9${Math.floor(rand() * 900000000) + 100000000}`,
    otp,
    valid_from: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
    valid_until: new Date(now.getTime() + 4 * 3600 * 1000).toISOString(),
    max_uses: 1,
    uses_count: 0,
    status: 'active',
    visitor_vehicle: null,
  };
}

export async function insertTrickle(client, row, table) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    columns.map((c) => row[c])
  );
}
```

- [ ] **Step 4: Wire it into the loop**

In `generate.js`, open a `pg.Client` when `databaseUrl` is set, and inside the main loop add — after the event post:

```js
    // A few parcels and visitor passes an hour, independent of gate traffic.
    if (db && rand() < 0.03) {
      await insertTrickle(db, newDelivery(pop, rand, now), 'deliveries').catch((e) =>
        console.error('[demo-traffic] delivery insert failed:', e.message));
    }
    if (db && rand() < 0.02) {
      await insertTrickle(db, newPass(pop, rand, now), 'visitor_passes').catch((e) =>
        console.error('[demo-traffic] pass insert failed:', e.message));
    }
```

Add `DATABASE_URL` to the systemd unit in Task 10 so `db` is non-null in production.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter demo-traffic test`
Expected: PASS — whole suite.

- [ ] **Step 6: Commit**

```bash
git add services/demo-traffic/src/trickle.js services/demo-traffic/src/generate.js \
        services/demo-traffic/src/__tests__/trickle.test.js
git commit -m "feat(demo): trickle new deliveries and visitor passes alongside gate traffic"
```

---

### Task 10: Deploy to EC2

**Files:**
- Create: `deploy/dwaarai-demo-traffic.service`

**Interfaces:**
- Consumes: the whole package.
- Produces: a running systemd service.

- [ ] **Step 1: Write the unit file**

```ini
# deploy/dwaarai-demo-traffic.service
[Unit]
Description=Greenfield demo traffic generator
After=network.target communitygate-api.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/communitygate/services/demo-traffic
Environment=API_BASE=http://127.0.0.1:3000/api/v1
Environment=JWT_SECRET=dev-secret-key-change-me
Environment=DATABASE_URL=postgres://cguser:<password>@127.0.0.1:5432/communitygate
ExecStart=/usr/bin/node src/generate.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> `JWT_SECRET` must match `communitygate-api.service`'s value or every post returns 401. Read the current value with
> `sudo grep JWT_SECRET /etc/systemd/system/communitygate-api.service` and copy it rather than assuming.

- [ ] **Step 2: Deploy the code**

```bash
tar czf /tmp/demo-traffic.tar.gz services/demo-traffic deploy/dwaarai-demo-traffic.service
scp -i communitygate-test.pem /tmp/demo-traffic.tar.gz ec2-user@54.235.41.163:/tmp/
ssh -i communitygate-test.pem ec2-user@54.235.41.163 \
  "cd /opt/communitygate && tar xzf /tmp/demo-traffic.tar.gz && cd services/demo-traffic && npm install --omit=dev"
```

- [ ] **Step 3: Seed the tenant**

```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 \
  "cd /opt/communitygate/services/demo-traffic && \
   DATABASE_URL='postgres://cguser:<password>@127.0.0.1:5432/communitygate' JWT_SECRET=x node src/seed.js"
```

Read the password from the api-gateway unit (`sudo grep DATABASE_URL /etc/systemd/system/communitygate-api.service`).
Expected: `seeded 432 units, ~590 vehicles`.

- [ ] **Step 4: Verify the seed landed**

```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 \
  "docker exec communitygate-postgres-1 psql -U cguser -d communitygate -t -A \
   -c \"SELECT count(*) FROM units WHERE community_id='00000000-0000-0000-0000-000000000043';\" \
   -c \"SELECT count(*) FROM gate_events WHERE community_id='00000000-0000-0000-0000-000000000043';\" \
   -c \"SELECT count(*) FROM communities;\""
```

Expected: `432`, ~`11000`, and **3** communities (Palm Meadows and Sriram untouched).

- [ ] **Step 5: Start the generator**

```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 \
  "sudo cp /opt/communitygate/deploy/dwaarai-demo-traffic.service /etc/systemd/system/ && \
   sudo systemctl daemon-reload && sudo systemctl enable --now dwaarai-demo-traffic && \
   sleep 5 && systemctl is-active dwaarai-demo-traffic"
```

Expected: `active`.

- [ ] **Step 6: Verify events are landing**

```bash
ssh -i communitygate-test.pem ec2-user@54.235.41.163 \
  "sudo journalctl -u dwaarai-demo-traffic -n 20 --no-pager; \
   docker exec communitygate-postgres-1 psql -U cguser -d communitygate -t -A \
   -c \"SELECT count(*) FROM gate_events WHERE community_id='00000000-0000-0000-0000-000000000043' AND event_ts > NOW() - INTERVAL '5 minutes';\""
```

Expected: no `post failed` lines, and a non-zero count that grows between runs. A count of zero with 401s in the log means the `JWT_SECRET` does not match.

- [ ] **Step 7: Verify the demo end to end**

Open `https://dwaarai.in/admin`, sign in as `superadmin` / `admin123`, select **Greenfield Faridabad Sector 43**, and confirm: KPI tiles are non-zero, the hourly chart shows a shaped curve rather than a flat line, the live feed advances without a refresh, and Vehicles / Visitors / Deliveries / Notices / Incidents / Dues / Facilities all show rows.

- [ ] **Step 8: Commit**

```bash
git add deploy/dwaarai-demo-traffic.service
git commit -m "feat(demo): systemd unit for the Greenfield traffic generator"
```

---

## Rollback

```bash
sudo systemctl disable --now dwaarai-demo-traffic
docker exec communitygate-postgres-1 psql -U cguser -d communitygate \
  -c "DELETE FROM gate_events WHERE community_id='00000000-0000-0000-0000-000000000043';"
# ...then the remaining tables in TABLES_IN_DELETE_ORDER, then the community row.
```

No other tenant is touched at any point.
