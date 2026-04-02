# FASTag Auto-Pairing Access System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MFRC522 RFID with UHF FASTag reader, implement 3-tier access (FASTag-first, ANPR-async, guard review), and auto-pair FASTag TIDs to vehicles via ANPR on first drive-through.

**Architecture:** UHF reader detects FASTag instantly and opens gate for known TIDs. ANPR runs async for audit and auto-pairing unknown FASTag TIDs to registered plates. Guard App handles manual approval + registration for completely unknown vehicles. Exit gates are always-open with camera audit only.

**Tech Stack:** Node.js/Express (API), Python (edge), PostgreSQL (migrations), React Native/Expo (Guard App), SQLite (edge cache), Vitest (API tests), pytest (edge tests)

---

## File Structure

**New files:**
- `services/api-gateway/migrations/008_fastag.sql` — DB migration
- `edge/uhf_reader.py` — UHF RFID reader driver
- `edge/emulators/uhf_mock.py` — UHF reader mock/emulator
- `tests/unit/test_uhf_reader.py` — UHF reader unit tests

**Modified files:**
- `services/api-gateway/src/routes/vehicles.js` — access check + auto-pair + register-at-gate + whitelist sync
- `edge/config.py` — new UHF and gate type config
- `edge/gate_controller.py` — FASTag-first flow, correlation logic, exit gate mode
- `edge/whitelist_sync.py` — fastag_tid_hash in whitelist + local lookup
- `services/api-gateway/src/__tests__/gateway.test.js` — API tests
- `tests/integration/test_gate_loop.py` — edge integration tests

---

### Task 1: Database Migration

**Files:**
- Create: `services/api-gateway/migrations/008_fastag.sql`

- [ ] **Step 1: Create migration file**

Create `services/api-gateway/migrations/008_fastag.sql`:

```sql
-- FASTag auto-pairing: add fastag_tid_hash to vehicles, extend gate_events

-- Vehicles: add FASTag TID hash column
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fastag_tid_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_vehicles_fastag ON vehicles(community_id, fastag_tid_hash) WHERE fastag_tid_hash IS NOT NULL;

-- Gate events: add FASTag + correlation fields
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS fastag_tid_hash VARCHAR(64);
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS auto_paired BOOLEAN DEFAULT FALSE;
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'entry';
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS correlation_id UUID;

-- Blacklist: add FASTag TID hash support
ALTER TABLE blacklist ADD COLUMN IF NOT EXISTS fastag_tid_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_bl_fastag ON blacklist(community_id, fastag_tid_hash) WHERE is_active=TRUE AND fastag_tid_hash IS NOT NULL;
```

- [ ] **Step 2: Run migration against local DB**

Run: `cd C:/Users/calblr2734/Desktop/gateopener && docker compose -f docker-compose.dev.yml exec postgres psql -U cguser -d communitygate -f /dev/stdin < services/api-gateway/migrations/008_fastag.sql`

Expected: no errors, all ALTER TABLE and CREATE INDEX succeed (IF NOT EXISTS makes it idempotent).

- [ ] **Step 3: Verify columns exist**

Run: `docker compose -f docker-compose.dev.yml exec postgres psql -U cguser -d communitygate -c "\d vehicles" | grep fastag`

Expected: `fastag_tid_hash | character varying(64)`

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/migrations/008_fastag.sql
git commit -m "feat: add fastag_tid_hash migration for vehicles, gate_events, blacklist"
```

---

### Task 2: UHF Reader Driver + Mock

**Files:**
- Create: `edge/uhf_reader.py`
- Create: `edge/emulators/uhf_mock.py`
- Create: `tests/unit/test_uhf_reader.py`

- [ ] **Step 1: Write UHF mock emulator**

Create `edge/emulators/uhf_mock.py`:

```python
"""Simulates UHF RFID reader for FASTag. Modes: scenario, random, inventory."""
import threading, time, hashlib, logging, random
log = logging.getLogger("uhf_mock")

# Test FASTag TIDs — matches seed data
TEST_TAGS = {
    "RESIDENT_301":  {"tid": "E200001234560001", "desc": "Priya Sharma — Flat 301"},
    "RESIDENT_205":  {"tid": "E200001234560002", "desc": "Rajan Kumar — Flat 205"},
    "RESIDENT_BIKE": {"tid": "E200001234560003", "desc": "Anil Nair — Bike"},
    "VISITOR":       {"tid": "E200009999990001", "desc": "Visitor — no registration"},
    "UNKNOWN":       {"tid": "E200008888880001", "desc": "Unknown vehicle"},
}

def tid_to_hash(tid: str) -> str:
    """SHA-256 hash of TID string, 64 hex chars."""
    return hashlib.sha256(tid.encode()).hexdigest()

class UHFMock:
    def __init__(self, on_tag_callback):
        self.cb = on_tag_callback
        self._running = False

    def read_tag(self, key: str = "RESIDENT_301"):
        tag = TEST_TAGS.get(key, TEST_TAGS["UNKNOWN"])
        event = {
            "tid_hash": tid_to_hash(tag["tid"]),
            "rssi": -35.0,
            "timestamp": time.time(),
        }
        log.info(f"[UHF MOCK] Tag: {tag['desc']}")
        self.cb(event)

    def run_scenario(self, steps: list[dict], loop=False):
        """steps = [{"tag": "RESIDENT_301", "delay": 5.0}, ...]"""
        def _go():
            while True:
                for s in steps:
                    time.sleep(s.get("delay", 3.0))
                    self.read_tag(s.get("tag", "RESIDENT_301"))
                if not loop:
                    break
        threading.Thread(target=_go, daemon=True).start()

    def run_random(self, interval=8.0, pool=None):
        pool = pool or list(TEST_TAGS)
        self._running = True
        def _go():
            while self._running:
                self.read_tag(random.choice(pool))
                time.sleep(interval)
        threading.Thread(target=_go, daemon=True).start()

    def stop(self):
        self._running = False

    def start(self, on_detection=None):
        """Compatibility with gate_controller start pattern."""
        pass
```

- [ ] **Step 2: Write UHF reader driver**

Create `edge/uhf_reader.py`:

```python
"""UHF RFID reader for FASTag TID detection via serial/USB.

Supports readers with a serial command protocol (e.g., ThingMagic M6e Nano,
Chafon CF-RU5102). Reads all tags in range, filters by RSSI, hashes TID.

Install: pip install pyserial
"""
import hashlib, time, logging, threading
log = logging.getLogger("uhf_reader")

try:
    import serial
    _HAS_SERIAL = True
except ImportError:
    _HAS_SERIAL = False
    log.warning("pyserial not installed — UHF reader unavailable")


def tid_to_hash(tid: str) -> str:
    """SHA-256 hash of TID string, 64 hex chars."""
    return hashlib.sha256(tid.encode()).hexdigest()


class UHFReader:
    def __init__(self, on_tag_callback, port: str = "/dev/ttyUSB0",
                 baud: int = 115200, debounce: float = 8.0,
                 rssi_threshold: float = -60.0):
        if not _HAS_SERIAL:
            raise ImportError("pyserial required. Install with: pip install pyserial")
        self.cb = on_tag_callback
        self.port = port
        self.baud = baud
        self.debounce = debounce
        self.rssi_threshold = rssi_threshold
        self._last_tid = None
        self._last_time = 0.0
        self._running = False
        self._serial = None
        log.info(f"UHF reader initialized (port={port}, debounce={debounce}s, rssi>={rssi_threshold})")

    def _connect(self):
        self._serial = serial.Serial(self.port, self.baud, timeout=1.0)
        log.info(f"UHF serial connected: {self.port}")

    def _read_inventory(self) -> list[dict]:
        """Read tags from reader. Returns list of {tid, rssi}.

        This is a placeholder for the actual reader protocol.
        Real implementation depends on the specific UHF reader model.
        Override this method or replace with reader-specific protocol.
        """
        # Generic serial read — real protocol is reader-specific
        if self._serial and self._serial.in_waiting:
            raw = self._serial.readline().decode(errors="ignore").strip()
            if raw:
                # Expected format: TID,RSSI (e.g., "E200001234560001,-35.2")
                parts = raw.split(",")
                if len(parts) >= 2:
                    try:
                        return [{"tid": parts[0].strip(), "rssi": float(parts[1].strip())}]
                    except ValueError:
                        pass
        return []

    def run(self):
        """Blocking polling loop — runs in its own thread."""
        self._running = True
        self._connect()
        log.info("UHF reader polling started")
        try:
            while self._running:
                try:
                    tags = self._read_inventory()
                    for tag in tags:
                        if tag["rssi"] < self.rssi_threshold:
                            continue

                        tid = tag["tid"]
                        now = time.time()

                        if tid == self._last_tid and (now - self._last_time) < self.debounce:
                            continue

                        self._last_tid = tid
                        self._last_time = now
                        tid_hash = tid_to_hash(tid)

                        log.info(f"FASTag detected: TID={tid[:12]}... RSSI={tag['rssi']} hash={tid_hash[:12]}...")
                        self.cb({
                            "tid_hash": tid_hash,
                            "rssi": tag["rssi"],
                            "timestamp": now,
                        })
                except Exception as e:
                    log.error(f"UHF read error: {e}")
                    time.sleep(0.5)

                time.sleep(0.1)
        finally:
            if self._serial:
                self._serial.close()
            log.info("UHF reader stopped")

    def stop(self):
        self._running = False
```

- [ ] **Step 3: Write unit tests**

Create `tests/unit/test_uhf_reader.py`:

```python
"""Tests for UHF reader mock and hashing."""
import pytest, time
from edge.emulators.uhf_mock import UHFMock, tid_to_hash, TEST_TAGS


class TestTidHash:
    def test_hash_is_64_hex_chars(self):
        h = tid_to_hash("E200001234560001")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_is_deterministic(self):
        h1 = tid_to_hash("E200001234560001")
        h2 = tid_to_hash("E200001234560001")
        assert h1 == h2

    def test_different_tids_produce_different_hashes(self):
        h1 = tid_to_hash("E200001234560001")
        h2 = tid_to_hash("E200001234560002")
        assert h1 != h2


class TestUHFMock:
    def test_read_tag_calls_callback(self):
        events = []
        mock = UHFMock(on_tag_callback=lambda e: events.append(e))
        mock.read_tag("RESIDENT_301")
        assert len(events) == 1
        assert events[0]["tid_hash"] == tid_to_hash(TEST_TAGS["RESIDENT_301"]["tid"])
        assert events[0]["rssi"] == -35.0
        assert "timestamp" in events[0]

    def test_read_unknown_tag(self):
        events = []
        mock = UHFMock(on_tag_callback=lambda e: events.append(e))
        mock.read_tag("UNKNOWN")
        assert len(events) == 1
        assert events[0]["tid_hash"] == tid_to_hash(TEST_TAGS["UNKNOWN"]["tid"])

    def test_scenario_playback(self):
        events = []
        mock = UHFMock(on_tag_callback=lambda e: events.append(e))
        mock.run_scenario([
            {"tag": "RESIDENT_301", "delay": 0.1},
            {"tag": "VISITOR", "delay": 0.1},
        ], loop=False)
        time.sleep(0.5)
        assert len(events) == 2

    def test_all_test_tags_have_unique_hashes(self):
        hashes = set()
        for tag in TEST_TAGS.values():
            h = tid_to_hash(tag["tid"])
            assert h not in hashes, f"Duplicate hash for {tag['tid']}"
            hashes.add(h)
```

- [ ] **Step 4: Run tests**

Run: `cd C:/Users/calblr2734/Desktop/gateopener && python -m pytest tests/unit/test_uhf_reader.py -v`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add edge/uhf_reader.py edge/emulators/uhf_mock.py tests/unit/test_uhf_reader.py
git commit -m "feat: add UHF RFID reader driver and mock for FASTag detection"
```

---

### Task 3: Edge Config Updates

**Files:**
- Modify: `edge/config.py`

- [ ] **Step 1: Add UHF and gate type config**

In `edge/config.py`, after the existing RFID config block (lines 22-24) and before the OFFLINE config block (line 26), add:

```python
    GATE_TYPE:       str   = os.getenv("GATE_TYPE", "entry")
    UHF_READER_PORT: str   = os.getenv("UHF_READER_PORT", "/dev/ttyUSB0")
    UHF_READER_BAUD: int   = int(os.getenv("UHF_READER_BAUD", "115200"))
    UHF_DEBOUNCE:    float = float(os.getenv("UHF_DEBOUNCE_SECONDS", "8"))
    UHF_RSSI_THRESHOLD: float = float(os.getenv("UHF_RSSI_THRESHOLD", "-60"))
    USE_UHF_MOCK:    bool  = os.getenv("USE_UHF_MOCK", "true").lower()=="true"
    FASTAG_CORRELATION_WINDOW: float = float(os.getenv("FASTAG_CORRELATION_WINDOW_SECONDS", "5"))
    EXIT_PRESENCE_PIN: int = int(os.getenv("EXIT_PRESENCE_GPIO_PIN", "27"))
```

- [ ] **Step 2: Commit**

```bash
git add edge/config.py
git commit -m "feat: add UHF reader and gate type config to edge config"
```

---

### Task 4: API — FASTag Access Check + Auto-Pair + Register

**Files:**
- Modify: `services/api-gateway/src/routes/vehicles.js`

- [ ] **Step 1: Update accessCheckSchema to accept "fastag" method**

In `services/api-gateway/src/routes/vehicles.js`, find the `accessCheckSchema` (around line 40):

```javascript
const accessCheckSchema = z.object({
  community_id: z.string().uuid(),
  gate_id: z.string().uuid(),
  method: z.enum(['anpr', 'rfid', 'otp']),
```

Replace the method line with:

```javascript
  method: z.enum(['anpr', 'rfid', 'fastag', 'otp']),
```

And add these optional fields after `ts`:

```javascript
  correlation_id: z.string().uuid().optional(),
  direction: z.enum(['entry', 'exit']).default('entry'),
```

- [ ] **Step 2: Add FASTag lookup in access check handler**

In the `/access/check` handler, find the blacklist check block for RFID (around line 391-396):

```javascript
    } else if (method === 'rfid') {
      blacklisted = await queryOne(
        'SELECT id FROM blacklist WHERE community_id = $1 AND rfid_uid_hash = $2 AND is_active = true',
        [community_id, lookupValue]
      );
    }
```

Replace with:

```javascript
    } else if (method === 'rfid' || method === 'fastag') {
      const col = method === 'fastag' ? 'fastag_tid_hash' : 'rfid_uid_hash';
      blacklisted = await queryOne(
        `SELECT id FROM blacklist WHERE community_id = $1 AND ${col} = $2 AND is_active = true`,
        [community_id, lookupValue]
      );
    }
```

Then find the vehicle RFID lookup block (around line 426-434):

```javascript
    } else if (method === 'rfid') {
      vehicle = await queryOne(
        `SELECT v.id, v.unit_id, u.unit_number, r.name AS resident_name
         FROM vehicles v
         JOIN units u ON v.unit_id = u.id
         LEFT JOIN residents r ON v.resident_id = r.id
         WHERE v.community_id = $1 AND v.rfid_uid_hash = $2 AND v.is_active = true`,
        [community_id, lookupValue]
      );
    }
```

Replace with:

```javascript
    } else if (method === 'rfid' || method === 'fastag') {
      const col = method === 'fastag' ? 'fastag_tid_hash' : 'rfid_uid_hash';
      vehicle = await queryOne(
        `SELECT v.id, v.unit_id, u.unit_number, r.name AS resident_name
         FROM vehicles v
         JOIN units u ON v.unit_id = u.id
         LEFT JOIN residents r ON v.resident_id = r.id
         WHERE v.community_id = $1 AND v.${col} = $2 AND v.is_active = true`,
        [community_id, lookupValue]
      );
    }
```

Also update the rfidCard fallback block (around line 483) — change:

```javascript
    if (!vehicle && method === 'rfid') {
```

To:

```javascript
    if (!vehicle && (method === 'rfid' || method === 'fastag')) {
```

And update the rfid_cards query to also check `fastag_tid_hash` when method is `fastag`:

```javascript
    if (!vehicle && (method === 'rfid' || method === 'fastag')) {
      const cardCol = method === 'fastag' ? 'uid_hash' : 'uid_hash';
      rfidCard = await queryOne(
        `SELECT rc.id, rc.issued_to_unit AS unit_id, u.unit_number, rc.card_type,
                COALESCE(u.unit_number, 'N/A') AS resident_name
         FROM rfid_cards rc
         LEFT JOIN units u ON rc.issued_to_unit = u.id
         WHERE rc.community_id = $1 AND rc.uid_hash = $2
           AND rc.is_active = true
           AND (rc.expires_at IS NULL OR rc.expires_at > NOW())`,
        [community_id, lookupValue]
      );
    }
```

- [ ] **Step 3: Add auto-pair endpoint**

After the blacklist routes (after the `DELETE /blacklist/:id` handler), add:

```javascript
// -- FASTag Auto-Pair (device token) -----------------------------------------

router.post('/vehicles/auto-pair', authenticateDevice, async (req, res) => {
  try {
    const autoPairSchema = z.object({
      community_id: z.string().uuid(),
      plate: z.string().min(1).max(20),
      fastag_tid_hash: z.string().length(64),
    });
    const parsed = autoPairSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id, plate, fastag_tid_hash } = parsed.data;
    const normalizedPlate = normalizePlate(plate);

    // Find vehicle by plate
    const vehicle = await queryOne(
      'SELECT id, fastag_tid_hash FROM vehicles WHERE community_id = $1 AND plate = $2 AND is_active = true',
      [community_id, normalizedPlate]
    );
    if (!vehicle) {
      return error(res, 'Vehicle not found for plate', 404);
    }

    // Check if this FASTag TID is already linked to another vehicle
    const existing = await queryOne(
      'SELECT id, plate FROM vehicles WHERE community_id = $1 AND fastag_tid_hash = $2 AND is_active = true AND id != $3',
      [community_id, fastag_tid_hash, vehicle.id]
    );
    if (existing) {
      return error(res, `FASTag already linked to vehicle ${existing.plate}`, 409);
    }

    // Update vehicle with FASTag TID
    const updated = await queryOne(
      'UPDATE vehicles SET fastag_tid_hash = $1 WHERE id = $2 RETURNING *',
      [fastag_tid_hash, vehicle.id]
    );

    // Invalidate access cache
    await delCachePattern(`access:*:fastag:${fastag_tid_hash}`);
    await delCachePattern(`access:*:anpr:${normalizedPlate}`);

    console.log(`FASTag auto-paired: ${normalizedPlate} -> ${fastag_tid_hash.slice(0, 12)}...`);
    return success(res, { vehicle: updated, auto_paired: true });
  } catch (err) {
    console.error('POST /vehicles/auto-pair error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 4: Add register-at-gate endpoint**

After the auto-pair endpoint, add:

```javascript
// -- Register Vehicle at Gate (guard JWT) ------------------------------------

router.post('/vehicles/register-at-gate', authenticateJWT(['guard', 'admin']), async (req, res) => {
  try {
    const registerSchema = z.object({
      community_id: z.string().uuid(),
      plate: z.string().min(1).max(20),
      fastag_tid_hash: z.string().length(64).optional(),
      unit_number: z.string().min(1).max(30),
    });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id, plate, fastag_tid_hash, unit_number } = parsed.data;
    const normalizedPlate = normalizePlate(plate);

    // Find unit
    const unit = await queryOne(
      'SELECT id FROM units WHERE community_id = $1 AND unit_number = $2',
      [community_id, unit_number]
    );
    if (!unit) {
      return error(res, `Unit ${unit_number} not found`, 404);
    }

    // Check if vehicle already exists
    const existing = await queryOne(
      'SELECT id FROM vehicles WHERE community_id = $1 AND plate = $2 AND is_active = true',
      [community_id, normalizedPlate]
    );
    if (existing) {
      // Update existing vehicle with FASTag
      if (fastag_tid_hash) {
        const updated = await queryOne(
          'UPDATE vehicles SET fastag_tid_hash = $1 WHERE id = $2 RETURNING *',
          [fastag_tid_hash, existing.id]
        );
        await delCachePattern(`access:*:fastag:${fastag_tid_hash}`);
        return success(res, { vehicle: updated, created: false });
      }
      return error(res, 'Vehicle already registered', 409);
    }

    // Create new vehicle
    const vehicle = await queryOne(
      `INSERT INTO vehicles (community_id, unit_id, plate, plate_display, fastag_tid_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [community_id, unit.id, normalizedPlate, plate.trim(), fastag_tid_hash || null]
    );

    // Invalidate caches
    await delCachePattern(`access:*:anpr:${normalizedPlate}`);
    if (fastag_tid_hash) {
      await delCachePattern(`access:*:fastag:${fastag_tid_hash}`);
    }

    return success(res, { vehicle, created: true }, 201);
  } catch (err) {
    console.error('POST /vehicles/register-at-gate error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 5: Update whitelist sync to include fastag_tid_hash**

In the `/whitelist/sync` handler, find the vehicles query (around line 326):

```javascript
    const vehicles = await queryRows(
      `SELECT v.plate, v.rfid_uid_hash, v.unit_id, u.unit_number, r.name AS resident_name
```

Replace with:

```javascript
    const vehicles = await queryRows(
      `SELECT v.plate, v.rfid_uid_hash, v.fastag_tid_hash, v.unit_id, u.unit_number, r.name AS resident_name
```

- [ ] **Step 6: Commit**

```bash
git add services/api-gateway/src/routes/vehicles.js
git commit -m "feat: add FASTag access check, auto-pair, and register-at-gate endpoints"
```

---

### Task 5: Edge Whitelist Sync — FASTag Support

**Files:**
- Modify: `edge/whitelist_sync.py`

- [ ] **Step 1: Add fastag_tid_hash to whitelist table**

In `edge/whitelist_sync.py`, update the whitelist table creation in `_init_db()`. Find:

```python
        c.execute("""CREATE TABLE IF NOT EXISTS whitelist(
            plate TEXT, rfid_uid_hash TEXT,
            unit_id TEXT, unit_number TEXT, resident_name TEXT)""")
```

Replace with:

```python
        c.execute("""CREATE TABLE IF NOT EXISTS whitelist(
            plate TEXT, rfid_uid_hash TEXT, fastag_tid_hash TEXT,
            unit_id TEXT, unit_number TEXT, resident_name TEXT)""")
```

Add index after the existing rfid index line:

```python
        c.execute("CREATE INDEX IF NOT EXISTS idx_wl_f ON whitelist(fastag_tid_hash)")
```

- [ ] **Step 2: Update sync_from_cloud to store fastag_tid_hash**

In `sync_from_cloud()`, find the whitelist insert:

```python
            c.executemany("INSERT INTO whitelist VALUES(?,?,?,?,?)",
                [(v["plate"],v.get("rfid_uid_hash"),v["unit_id"],
                  v["unit_number"],v["resident_name"]) for v in d["vehicles"]])
```

Replace with:

```python
            c.executemany("INSERT INTO whitelist VALUES(?,?,?,?,?,?)",
                [(v["plate"],v.get("rfid_uid_hash"),v.get("fastag_tid_hash"),
                  v["unit_id"],v["unit_number"],v["resident_name"]) for v in d["vehicles"]])
```

- [ ] **Step 3: Update load_local to support fastag method**

Replace the `load_local` function:

```python
def load_local(db, method, value):
    if method == "anpr":
        col = "plate"
    elif method == "fastag":
        col = "fastag_tid_hash"
    else:
        col = "rfid_uid_hash"
    with sqlite3.connect(db) as c:
        row = c.execute(f"SELECT unit_id,unit_number,resident_name FROM whitelist WHERE {col}=?",(value,)).fetchone()
    if row: return {"unit_id":row[0],"unit_number":row[1],"resident_name":row[2]}
    # Fallback: check rfid_cards_cache for standalone RFID/FASTag cards
    if method in ("rfid", "fastag"):
        import time as _time
        with sqlite3.connect(db) as c:
            card = c.execute(
                "SELECT unit_id,unit_number,card_type,expires_at FROM rfid_cards_cache WHERE uid_hash=?",
                (value,)).fetchone()
        if card:
            expires_at = card[3]
            if expires_at is None or expires_at > _time.time():
                return {"unit_id":card[0],"unit_number":card[1],"resident_name":card[1] or "Card holder","card_type":card[2]}
    return None
```

- [ ] **Step 4: Update is_blacklisted_local to support fastag**

Replace the `is_blacklisted_local` function:

```python
def is_blacklisted_local(db, method, value) -> bool:
    if method == "anpr":
        col = "plate"
    elif method == "fastag":
        col = "fastag_tid_hash"
    else:
        col = "rfid_uid_hash"
    with sqlite3.connect(db) as c:
        return c.execute(f"SELECT 1 FROM blacklist_cache WHERE {col}=?",(value,)).fetchone() is not None
```

- [ ] **Step 5: Update blacklist_cache table for fastag**

In `_init_db()`, find:

```python
        c.execute("""CREATE TABLE IF NOT EXISTS blacklist_cache(
            plate TEXT, rfid_uid_hash TEXT)""")
```

Replace with:

```python
        c.execute("""CREATE TABLE IF NOT EXISTS blacklist_cache(
            plate TEXT, rfid_uid_hash TEXT, fastag_tid_hash TEXT)""")
```

In `sync_from_cloud()`, find:

```python
            c.executemany("INSERT INTO blacklist_cache VALUES(?,?)",
                [(b.get("plate"),b.get("rfid_uid_hash")) for b in d.get("blacklist",[])])
```

Replace with:

```python
            c.executemany("INSERT INTO blacklist_cache VALUES(?,?,?)",
                [(b.get("plate"),b.get("rfid_uid_hash"),b.get("fastag_tid_hash")) for b in d.get("blacklist",[])])
```

- [ ] **Step 6: Commit**

```bash
git add edge/whitelist_sync.py
git commit -m "feat: edge whitelist sync supports fastag_tid_hash lookup and blacklist"
```

---

### Task 6: Edge Gate Controller — FASTag-First + Correlation

**Files:**
- Modify: `edge/gate_controller.py`

- [ ] **Step 1: Update imports for UHF reader**

In `edge/gate_controller.py`, find the RFID import block (lines 18-22):

```python
if cfg.USE_RFID_MOCK:
    from edge.emulators.rfid_mock import RFIDMock as RFIDImpl
    log.warning("RFID MOCK active")
else:
    from edge.rfid_reader import RFIDReader as RFIDImpl
```

Replace with:

```python
if cfg.USE_UHF_MOCK:
    from edge.emulators.uhf_mock import UHFMock as UHFImpl
    log.warning("UHF MOCK active")
else:
    from edge.uhf_reader import UHFReader as UHFImpl
```

- [ ] **Step 2: Add correlation state**

After the `_oq` and `_mqtt_client` declarations (around line 44), add:

```python
_recent_fastag: dict[str, dict] = {}  # tid_hash → {ts, decision}
_recent_anpr:   dict[str, dict] = {}  # plate → {ts, confidence}
```

- [ ] **Step 3: Add auto-pair helper**

After the `_close_gate` function, add:

```python
# ── Auto-pair helper ─────────────────────────────────────────────────
def _try_auto_pair(tid_hash: str, plate: str):
    """Attempt to auto-pair an unknown FASTag TID with a known plate."""
    try:
        r = requests.post(f"{cfg.CLOUD_API_URL}/vehicles/auto-pair",
                          json={"community_id": cfg.COMMUNITY_ID,
                                "plate": plate,
                                "fastag_tid_hash": tid_hash},
                          headers={"X-Device-Token": cfg.DEVICE_TOKEN}, timeout=3.0)
        if r.status_code == 200:
            log.info(f"AUTO-PAIRED: {plate} → {tid_hash[:12]}...")
        else:
            log.warning(f"Auto-pair failed ({r.status_code}): {r.text[:200]}")
    except Exception as e:
        log.warning(f"Auto-pair error: {e}")
```

- [ ] **Step 4: Add FASTag detection handler**

After the auto-pair helper, add:

```python
# ── FASTag detection (Tier 1 — instant) ──────────────────────────────
def handle_fastag(event: dict):
    tid_hash = event["tid_hash"]
    if not tid_hash:
        return
    log.info(f"FASTag detected: {tid_hash[:12]}... RSSI={event.get('rssi')}")

    # Store for correlation with ANPR
    _recent_fastag[tid_hash] = {"ts": time.time(), "decision": None}
    # Clean old entries
    now = time.time()
    for k in [k for k, v in _recent_fastag.items() if now - v["ts"] > 30]:
        del _recent_fastag[k]

    # Immediate lookup
    if is_blacklisted_local(cfg.OFFLINE_DB_PATH, "fastag", tid_hash):
        _recent_fastag[tid_hash]["decision"] = "deny"
        log.info(f"DENIED (blacklisted FASTag)")
        _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                      "detection_method": "fastag", "raw_value": tid_hash,
                      "access_decision": "deny", "deny_reason": "blacklisted",
                      "is_offline_event": not _online, "event_ts": time.time()})
        return

    if _online:
        result = _cloud_check("fastag", tid_hash)
        if result and result["decision"] == "allow":
            _recent_fastag[tid_hash]["decision"] = "allow"
            threading.Thread(target=open_gate, daemon=True).start()
            log.info(f"GRANTED (FASTag) → {result.get('unit_number')} ({result.get('resident_name')})")
            _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                          "detection_method": "fastag", "raw_value": tid_hash,
                          "access_decision": "allow", "is_offline_event": False,
                          "event_ts": time.time()})
            return

    # Offline or cloud miss — try local
    local = load_local(cfg.OFFLINE_DB_PATH, "fastag", tid_hash)
    if local:
        _recent_fastag[tid_hash]["decision"] = "allow"
        threading.Thread(target=open_gate, daemon=True).start()
        log.info(f"GRANTED (FASTag local) → {local.get('unit_number')}")
        _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                      "detection_method": "fastag", "raw_value": tid_hash,
                      "access_decision": "allow", "is_offline_event": not _online,
                      "event_ts": time.time()})
        return

    # Unknown FASTag — wait for ANPR correlation
    _recent_fastag[tid_hash]["decision"] = "pending"
    log.info(f"Unknown FASTag {tid_hash[:12]}... — waiting for ANPR correlation")
```

- [ ] **Step 5: Update ANPR detection to correlate with FASTag**

Replace the existing `handle_detection` function with an updated version that does correlation:

```python
def handle_detection(method: str, value: str, confidence: float = None):
    if not value: return
    log.info(f"Detection method={method} value={value} conf={confidence}")

    # For ANPR: check correlation with recent unknown FASTag
    if method == "anpr":
        _recent_anpr[value] = {"ts": time.time(), "confidence": confidence}
        # Clean old ANPR entries
        now = time.time()
        for k in [k for k, v in _recent_anpr.items() if now - v["ts"] > 30]:
            del _recent_anpr[k]

        # Try to correlate with pending FASTag
        for tid_hash, ftag in list(_recent_fastag.items()):
            if ftag["decision"] == "pending" and (now - ftag["ts"]) < cfg.FASTAG_CORRELATION_WINDOW:
                # We have an unknown FASTag + ANPR result — check if plate is known
                if is_blacklisted_local(cfg.OFFLINE_DB_PATH, "anpr", value):
                    ftag["decision"] = "deny"
                    log.info(f"DENIED (plate blacklisted during FASTag correlation)")
                    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                                  "detection_method": "anpr", "raw_value": value,
                                  "access_decision": "deny", "deny_reason": "blacklisted",
                                  "anpr_confidence": confidence, "is_offline_event": not _online,
                                  "event_ts": time.time()})
                    return

                plate_result = None
                if _online:
                    plate_result = _cloud_check("anpr", value, confidence)
                if not plate_result:
                    plate_result = _local_check("anpr", value)

                if plate_result and plate_result["decision"] == "allow":
                    ftag["decision"] = "allow"
                    threading.Thread(target=open_gate, daemon=True).start()
                    log.info(f"GRANTED (ANPR correlated) → {plate_result.get('unit_number')}")
                    # Auto-pair in background
                    if _online:
                        threading.Thread(target=_try_auto_pair, args=(tid_hash, value), daemon=True).start()
                    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                                  "detection_method": "anpr", "raw_value": value,
                                  "access_decision": "allow", "anpr_confidence": confidence,
                                  "is_offline_event": not _online, "event_ts": time.time()})
                    return
                else:
                    ftag["decision"] = "guard_review"
                    log.info(f"GUARD REVIEW — unknown FASTag + unknown plate {value}")
                    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                                  "detection_method": "anpr", "raw_value": value,
                                  "access_decision": "guard_review", "deny_reason": "not_recognized",
                                  "anpr_confidence": confidence, "is_offline_event": not _online,
                                  "event_ts": time.time()})
                    return

    # Standard (non-correlated) access check — for ANPR without pending FASTag
    if is_blacklisted_local(cfg.OFFLINE_DB_PATH, method, value):
        result = {"decision": "deny", "reason": "blacklisted"}
    elif _online:
        result = _cloud_check(method, value, confidence) or _local_check(method, value)
    else:
        result = _local_check(method, value)
    decision = result["decision"]
    if decision == "allow":
        threading.Thread(target=open_gate, daemon=True).start()
        log.info(f"GRANTED → {result.get('unit_number')} ({result.get('resident_name')})")
    else:
        log.info(f"DENIED — {result.get('reason')}")
    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                 "detection_method": method, "raw_value": value,
                 "access_decision": decision, "deny_reason": result.get("reason"),
                 "anpr_confidence": confidence, "is_offline_event": not _online,
                 "event_ts": time.time()})
```

- [ ] **Step 6: Update main() for UHF reader and exit gate mode**

Replace the `main()` function:

```python
def main():
    log.info(f"CommunityGate starting — gate={cfg.GATE_ID} type={cfg.GATE_TYPE}")
    start_sync()   # whitelist sync scheduler
    start_mqtt()

    if cfg.GATE_TYPE == "exit":
        # Exit gate: auto-open on presence, camera for audit only
        log.info("EXIT gate mode — auto-open, camera audit only")
        if cfg.USE_CAMERA_MOCK:
            cam = CameraImpl(anpr_url=cfg.ANPR_SERVICE_URL,
                             plates_dir=cfg.MOCK_CAMERA_PLATE_DIR,
                             interval=cfg.MOCK_CAMERA_INTERVAL)
        else:
            cam = CameraImpl(rtsp_url=os.environ["RTSP_CAMERA_URL"],
                             anpr_url=cfg.ANPR_SERVICE_URL)
        cam.start(on_detection=lambda r:
            _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                         "detection_method": "anpr", "raw_value": r.get("plate", ""),
                         "access_decision": "allow", "deny_reason": None,
                         "anpr_confidence": r.get("confidence"),
                         "is_offline_event": not _online, "event_ts": time.time()})
            if r.get("plate") else None)
    else:
        # Entry gate: UHF FASTag + ANPR
        # UHF reader
        if cfg.USE_UHF_MOCK:
            uhf = UHFImpl(on_tag_callback=handle_fastag)
            uhf.run_scenario([{"tag": "RESIDENT_301", "delay": 8},
                              {"tag": "VISITOR", "delay": 12},
                              {"tag": "UNKNOWN", "delay": 15}], loop=True)
        else:
            uhf = UHFImpl(on_tag_callback=handle_fastag,
                          port=cfg.UHF_READER_PORT, baud=cfg.UHF_READER_BAUD,
                          debounce=cfg.UHF_DEBOUNCE, rssi_threshold=cfg.UHF_RSSI_THRESHOLD)
            threading.Thread(target=uhf.run, daemon=True).start()

        # Camera / ANPR (async)
        if cfg.USE_CAMERA_MOCK:
            cam = CameraImpl(anpr_url=cfg.ANPR_SERVICE_URL,
                             plates_dir=cfg.MOCK_CAMERA_PLATE_DIR,
                             interval=cfg.MOCK_CAMERA_INTERVAL)
        else:
            cam = CameraImpl(rtsp_url=os.environ["RTSP_CAMERA_URL"],
                             anpr_url=cfg.ANPR_SERVICE_URL)
        cam.start(on_detection=lambda r:
            handle_detection("anpr", r["plate"], r.get("confidence"))
            if r.get("plate") and r.get("confidence", 0) >= cfg.ANPR_THRESHOLD else None)

    log.info("Gate controller running. CTRL+C to stop.")
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        if 'cam' in dir(): cam.stop()
        GPIO.cleanup()
        if _mqtt_client: _mqtt_client.loop_stop()

if __name__ == "__main__": main()
```

- [ ] **Step 7: Commit**

```bash
git add edge/gate_controller.py
git commit -m "feat: FASTag-first gate controller with ANPR correlation and exit gate mode"
```

---

### Task 7: API Tests

**Files:**
- Modify: `services/api-gateway/src/__tests__/gateway.test.js`

- [ ] **Step 1: Add FASTag access check test**

Add inside `describe('API Gateway', ...)`:

```javascript
  it('POST /api/v1/access/check FASTag with known TID returns allow', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce(null)  // blacklist
      .mockResolvedValueOnce({      // vehicle by fastag_tid_hash
        id: 'v-fastag-1',
        unit_id: 'unit-301',
        unit_number: '301',
        resident_name: 'Priya Sharma',
      });
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'fastag',
        value: 'd'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('allow');
    expect(json.data.vehicle_id).toBe('v-fastag-1');
  });

  it('POST /api/v1/access/check FASTag unknown TID returns guard_review', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce(null)   // blacklist
      .mockResolvedValueOnce(null)   // vehicle
      .mockResolvedValueOnce(null);  // rfid_cards
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'fastag',
        value: 'e'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('guard_review');
  });
```

- [ ] **Step 2: Add auto-pair test**

```javascript
  it('POST /api/v1/vehicles/auto-pair links FASTag to vehicle', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce({ id: 'v-1', fastag_tid_hash: null })  // find vehicle by plate
      .mockResolvedValueOnce(null)                                     // check existing FASTag
      .mockResolvedValueOnce({ id: 'v-1', plate: 'KA05MF1234', fastag_tid_hash: 'f'.repeat(64) }); // update
    const { status, json } = await request('POST', '/api/v1/vehicles/auto-pair', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        plate: 'KA05MF1234',
        fastag_tid_hash: 'f'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.auto_paired).toBe(true);
  });
```

- [ ] **Step 3: Add register-at-gate test**

```javascript
  it('POST /api/v1/vehicles/register-at-gate creates vehicle with FASTag', async () => {
    const guardToken = generateTestToken({ sub: 'g1', role: 'guard', community_id: 'c1' });
    queryOne
      .mockResolvedValueOnce({ id: 'unit-301' })   // find unit
      .mockResolvedValueOnce(null)                    // no existing vehicle
      .mockResolvedValueOnce({                        // insert vehicle
        id: 'v-new',
        plate: 'KA05MF1234',
        fastag_tid_hash: 'g'.repeat(64),
        community_id: '00000000-0000-0000-0000-000000000000',
      });
    const { status, json } = await request('POST', '/api/v1/vehicles/register-at-gate', {
      headers: { Authorization: `Bearer ${guardToken}` },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        plate: 'KA05MF1234',
        fastag_tid_hash: 'g'.repeat(64),
        unit_number: '301',
      },
    });
    expect(status).toBe(201);
    expect(json.data.created).toBe(true);
  });
```

- [ ] **Step 4: Run tests**

Run: `cd C:/Users/calblr2734/Desktop/gateopener/services/api-gateway && npx vitest run --reporter=verbose`
Expected: All tests PASS including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add services/api-gateway/src/__tests__/gateway.test.js
git commit -m "test: add FASTag access check, auto-pair, and register-at-gate tests"
```

---

### Task 8: Edge Integration Tests

**Files:**
- Modify: `tests/integration/test_gate_loop.py`

- [ ] **Step 1: Update db fixture for FASTag support**

In the `db` fixture, replace the whitelist table creation and inserts:

```python
        c.execute("""CREATE TABLE whitelist(plate TEXT,rfid_uid_hash TEXT,fastag_tid_hash TEXT,
            unit_id TEXT,unit_number TEXT,resident_name TEXT)""")
        c.execute("CREATE TABLE blacklist_cache(plate TEXT,rfid_uid_hash TEXT,fastag_tid_hash TEXT)")
        c.execute("CREATE TABLE sync_meta(id INT PRIMARY KEY,last_sync REAL)")
        c.execute("INSERT INTO sync_meta VALUES(1,?)", (time.time(),))
        c.execute("""CREATE TABLE rfid_cards_cache(
            uid_hash TEXT, card_type TEXT, unit_id TEXT,
            unit_number TEXT, expires_at REAL)""")
        c.execute("CREATE INDEX idx_rcc_uid ON rfid_cards_cache(uid_hash)")
        # Staff card — no vehicle, no expiry
        c.execute("INSERT INTO rfid_cards_cache VALUES(?,?,?,?,?)",
                  ("staff_card_hash_64chars_padded_000000000000000000000000000000", "staff", "u-staff", "S-01", None))
        # Expired visitor card
        c.execute("INSERT INTO rfid_cards_cache VALUES(?,?,?,?,?)",
                  ("expired_card_hash_64chars_padded_0000000000000000000000000000", "visitor", "u-vis", "V-01", 1000000000.0))
        # Residents
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?,?)", ("KA05MF1234", None, "fastag_hash_301", "u301", "301", "Priya Sharma"))
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?,?)", (None, "a3f9c2d4e5f6", None, "u205", "205", "Rajan Kumar"))
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?,?)", ("KA05EB2345", "b1c2d3e4f5a6", "fastag_hash_107", "u107", "107", "Anil Nair"))
        # Blacklist
        c.execute("INSERT INTO blacklist_cache VALUES(?,?,?)", ("DL01ZZ9999", None, None))
```

- [ ] **Step 2: Add FASTag access tests**

Add a new test class:

```python
class TestFASTagAccess:

    def test_known_fastag_found_locally(self, db):
        from edge.whitelist_sync import load_local
        result = load_local(db, "fastag", "fastag_hash_301")
        assert result is not None
        assert result["unit_number"] == "301"
        assert result["resident_name"] == "Priya Sharma"

    def test_unknown_fastag_not_found(self, db):
        from edge.whitelist_sync import load_local
        result = load_local(db, "fastag", "unknown_fastag_hash")
        assert result is None

    def test_blacklisted_fastag(self, db):
        """Add a blacklisted FASTag and verify it's detected."""
        with sqlite3.connect(db) as c:
            c.execute("INSERT INTO blacklist_cache VALUES(?,?,?)", (None, None, "blacklisted_fastag"))
        from edge.whitelist_sync import is_blacklisted_local
        assert is_blacklisted_local(db, "fastag", "blacklisted_fastag")
        assert not is_blacklisted_local(db, "fastag", "fastag_hash_301")

    def test_existing_anpr_and_rfid_still_work(self, db):
        from edge.whitelist_sync import load_local
        assert load_local(db, "anpr", "KA05MF1234") is not None
        assert load_local(db, "rfid", "a3f9c2d4e5f6") is not None
```

- [ ] **Step 3: Run tests**

Run: `cd C:/Users/calblr2734/Desktop/gateopener && python -m pytest tests/integration/test_gate_loop.py -v`
Expected: All tests PASS including the new `TestFASTagAccess` tests.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_gate_loop.py
git commit -m "test: add FASTag edge integration tests with whitelist and blacklist"
```

---

### Task 9: Update Seed Data

**Files:**
- Modify: `services/api-gateway/migrations/005_seed.sql`

- [ ] **Step 1: Add FASTag TID hashes to seed vehicles**

In `services/api-gateway/migrations/005_seed.sql`, find the vehicles INSERT and add `fastag_tid_hash` values to the first few vehicles so the dev environment has testable auto-paired vehicles.

Find the INSERT INTO vehicles line and update it to include `fastag_tid_hash` in the column list and values. The exact edit depends on the current seed data format — read the file and add a FASTag hash value (e.g., SHA-256 of "E200001234560001") to 2-3 test vehicles.

Use the hash values from `edge/emulators/uhf_mock.py` TEST_TAGS so the mock UHF reader produces matching hashes.

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/migrations/005_seed.sql
git commit -m "feat: add FASTag TID hashes to seed vehicle data"
```
