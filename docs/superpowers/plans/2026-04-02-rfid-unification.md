# RFID Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the two disconnected RFID paths so `/access/check` falls back to `rfid_cards` table when no vehicle match is found, with expiry enforcement and offline support.

**Architecture:** Vehicles table remains the fast lane for car+RFID combos. When no vehicle match, the `rfid_cards` table is checked (with `is_active` and `expires_at` filtering). Edge nodes cache rfid_cards locally for offline fallback.

**Tech Stack:** Node.js/Express (vehicles.js), Python (whitelist_sync.py), SQLite (edge cache), Vitest (API tests), pytest (edge tests)

---

### Task 1: Add RFID card fallback to `/access/check`

**Files:**
- Modify: `services/api-gateway/src/routes/vehicles.js:426-489`

- [ ] **Step 1: Add rfid_cards lookup after vehicle RFID miss**

In `services/api-gateway/src/routes/vehicles.js`, after the `} else if (method === 'rfid') {` vehicle lookup block (line 426-434), and before the `if (vehicle)` check (line 470), add the rfid_cards fallback. Replace the block from line 468 (`}`) through line 489 (end of `if (vehicle)` block) with:

```javascript
    // -- RFID card fallback (standalone cards not linked to vehicles) ----------
    let rfidCard = null;
    if (!vehicle && method === 'rfid') {
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

    if (vehicle) {
      const processingMs = Date.now() - startMs;
      await query(
        `INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, matched_vehicle_id, matched_unit_id, matched_unit_number, resident_name, access_decision, anpr_confidence, processing_ms, event_ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [eventId, community_id, gate_id, method, lookupValue, vehicle.id, vehicle.unit_id, vehicle.unit_number, vehicle.resident_name, 'allow', confidence || null, processingMs, eventTs]
      );
      const allowResult = {
        decision: 'allow',
        method,
        unit_id: vehicle.unit_id,
        unit_number: vehicle.unit_number,
        resident_name: vehicle.resident_name,
        vehicle_id: vehicle.id,
        message: 'Vehicle recognized',
      };
      await setCache(cacheKey, allowResult, 300);
      return success(res, { ...allowResult, event_id: eventId });
    }

    if (rfidCard) {
      const processingMs = Date.now() - startMs;
      await query(
        `INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, matched_unit_id, matched_unit_number, resident_name, access_decision, processing_ms, event_ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [eventId, community_id, gate_id, method, lookupValue, rfidCard.unit_id, rfidCard.unit_number, rfidCard.resident_name, 'allow', processingMs, eventTs]
      );
      const allowResult = {
        decision: 'allow',
        method,
        unit_id: rfidCard.unit_id,
        unit_number: rfidCard.unit_number,
        resident_name: rfidCard.resident_name,
        vehicle_id: null,
        card_type: rfidCard.card_type,
        message: 'RFID card recognized',
      };
      await setCache(cacheKey, allowResult, 300);
      return success(res, { ...allowResult, event_id: eventId });
    }
```

The existing guard_review block that follows remains unchanged.

- [ ] **Step 2: Verify the API starts without errors**

Run: `cd services/api-gateway && node -e "import('./src/index.js').then(() => { console.log('OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/src/routes/vehicles.js
git commit -m "feat: add rfid_cards fallback to /access/check endpoint"
```

---

### Task 2: Add rfid_cards to whitelist sync endpoint

**Files:**
- Modify: `services/api-gateway/src/routes/vehicles.js:320-344`

- [ ] **Step 1: Add rfid_cards query to /whitelist/sync**

In `services/api-gateway/src/routes/vehicles.js`, inside the `/whitelist/sync` handler, after the `blacklisted` query (line 334-336) and before the `return success` (line 339), add the rfid_cards query. Replace line 339:

```javascript
    // Active, non-expired RFID cards for offline cache
    const rfidCards = await queryRows(
      `SELECT rc.uid_hash, rc.card_type, rc.issued_to_unit AS unit_id,
              u.unit_number, rc.expires_at
       FROM rfid_cards rc
       LEFT JOIN units u ON rc.issued_to_unit = u.id
       WHERE rc.community_id = $1 AND rc.is_active = true
         AND (rc.expires_at IS NULL OR rc.expires_at > NOW())`,
      [community_id]
    );

    return success(res, { vehicles, blacklist: blacklisted, rfid_cards: rfidCards });
```

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/routes/vehicles.js
git commit -m "feat: include rfid_cards in whitelist sync response"
```

---

### Task 3: Add rfid_cards_cache to edge whitelist sync

**Files:**
- Modify: `edge/whitelist_sync.py`

- [ ] **Step 1: Add rfid_cards_cache table to `_init_db`**

In `edge/whitelist_sync.py`, inside `_init_db()`, after the `sync_meta` table creation (line 15), add:

```python
        c.execute("""CREATE TABLE IF NOT EXISTS rfid_cards_cache(
            uid_hash TEXT, card_type TEXT, unit_id TEXT,
            unit_number TEXT, expires_at REAL)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_rcc_uid ON rfid_cards_cache(uid_hash)")
```

- [ ] **Step 2: Store rfid_cards in `sync_from_cloud`**

In `edge/whitelist_sync.py`, inside `sync_from_cloud()`, after the blacklist insert (line 30) and before the `sync_meta` update (line 31), add:

```python
            c.execute("DELETE FROM rfid_cards_cache")
            for card in d.get("rfid_cards", []):
                exp = card.get("expires_at")
                exp_ts = None
                if exp:
                    from datetime import datetime, timezone
                    exp_ts = datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp()
                c.execute("INSERT INTO rfid_cards_cache VALUES(?,?,?,?,?)",
                    (card["uid_hash"], card.get("card_type"),
                     card.get("unit_id"), card.get("unit_number"), exp_ts))
```

Update the log line (line 32) to include rfid_cards count:

```python
        log.info(f"Synced {len(d['vehicles'])} vehicles, {len(d.get('blacklist',[]))} blacklisted, {len(d.get('rfid_cards',[]))} rfid cards")
```

- [ ] **Step 3: Add rfid_cards fallback to `load_local`**

In `edge/whitelist_sync.py`, modify `load_local()` to check rfid_cards_cache as fallback for RFID lookups. Replace the entire function:

```python
def load_local(db, method, value):
    col = "plate" if method=="anpr" else "rfid_uid_hash"
    with sqlite3.connect(db) as c:
        row = c.execute(f"SELECT unit_id,unit_number,resident_name FROM whitelist WHERE {col}=?",(value,)).fetchone()
    if row: return {"unit_id":row[0],"unit_number":row[1],"resident_name":row[2]}
    # Fallback: check rfid_cards_cache for standalone RFID cards
    if method == "rfid":
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

- [ ] **Step 4: Commit**

```bash
git add edge/whitelist_sync.py
git commit -m "feat: edge rfid_cards_cache with sync and local fallback lookup"
```

---

### Task 4: API tests for RFID card fallback

**Files:**
- Modify: `services/api-gateway/src/__tests__/gateway.test.js`

- [ ] **Step 1: Import queryOne mock**

At line 21 of `gateway.test.js`, add `queryOne` to the import:

```javascript
const { queryRows, queryOne } = await import('../db/queries.js');
```

(Replace the existing line 21 which only imports `queryRows`.)

- [ ] **Step 2: Add RFID card fallback test — card-only allow**

Add this test inside the `describe('API Gateway', ...)` block:

```javascript
  it('POST /api/v1/access/check RFID with card-only (no vehicle) returns allow', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    // First queryOne call: blacklist check → null
    // Second queryOne call: vehicle lookup → null
    // Third queryOne call: rfid_cards lookup → found
    // Fourth queryOne call: gate_events insert (via query mock)
    queryOne
      .mockResolvedValueOnce(null)  // blacklist
      .mockResolvedValueOnce(null)  // vehicle
      .mockResolvedValueOnce({      // rfid_card
        id: 'card-1',
        unit_id: 'unit-staff-1',
        unit_number: 'S-01',
        card_type: 'staff',
        resident_name: 'S-01',
      });
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'rfid',
        value: 'a'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('allow');
    expect(json.data.card_type).toBe('staff');
    expect(json.data.vehicle_id).toBeNull();
  });
```

- [ ] **Step 3: Add RFID expired card test — guard_review**

```javascript
  it('POST /api/v1/access/check RFID with expired card returns guard_review', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    // blacklist → null, vehicle → null, rfid_card → null (expired cards filtered by SQL)
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'rfid',
        value: 'b'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('guard_review');
  });
```

- [ ] **Step 4: Add RFID vehicle-linked test — allow (existing path still works)**

```javascript
  it('POST /api/v1/access/check RFID with vehicle-linked RFID returns allow', async () => {
    const deviceToken = generateTestToken({ gate_id: 'gate-01', community_id: 'c1' });
    // blacklist → null, vehicle → found
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'v-1',
        unit_id: 'unit-301',
        unit_number: '301',
        resident_name: 'Priya Sharma',
      });
    const { status, json } = await request('POST', '/api/v1/access/check', {
      headers: { 'x-device-token': deviceToken },
      body: {
        community_id: '00000000-0000-0000-0000-000000000000',
        gate_id: '00000000-0000-0000-0000-000000000001',
        method: 'rfid',
        value: 'c'.repeat(64),
      },
    });
    expect(status).toBe(200);
    expect(json.data.decision).toBe('allow');
    expect(json.data.vehicle_id).toBe('v-1');
    expect(json.data.resident_name).toBe('Priya Sharma');
  });
```

- [ ] **Step 5: Run tests**

Run: `cd services/api-gateway && npx vitest run --reporter=verbose`
Expected: All tests PASS including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add services/api-gateway/src/__tests__/gateway.test.js
git commit -m "test: add RFID card fallback access check tests"
```

---

### Task 5: Edge integration tests for rfid_cards_cache fallback

**Files:**
- Modify: `tests/integration/test_gate_loop.py`

- [ ] **Step 1: Update `db` fixture to include rfid_cards_cache**

In `tests/integration/test_gate_loop.py`, inside the `db` fixture, after the `sync_meta` insert (line 26), add:

```python
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
```

- [ ] **Step 2: Add test — valid rfid card fallback allows access**

Add a new test class after `TestRFIDAccess`:

```python
class TestRFIDCardFallback:

    def test_standalone_rfid_card_found_in_cache(self, db):
        from edge.whitelist_sync import load_local
        result = load_local(db, "rfid", "staff_card_hash_64chars_padded_000000000000000000000000000000")
        assert result is not None
        assert result["unit_number"] == "S-01"
        assert result["card_type"] == "staff"

    def test_expired_rfid_card_not_found(self, db):
        from edge.whitelist_sync import load_local
        result = load_local(db, "rfid", "expired_card_hash_64chars_padded_0000000000000000000000000000")
        assert result is None

    def test_vehicle_rfid_takes_priority_over_card(self, db):
        """Vehicle whitelist match should return vehicle info, not card info."""
        from edge.whitelist_sync import load_local
        result = load_local(db, "rfid", "a3f9c2d4e5f6")
        assert result is not None
        assert result["resident_name"] == "Rajan Kumar"
        # Should NOT have card_type — it came from vehicle whitelist
        assert "card_type" not in result
```

- [ ] **Step 3: Run tests**

Run: `cd C:/Users/calblr2734/Desktop/gateopener && python -m pytest tests/integration/test_gate_loop.py -v`
Expected: All tests PASS including the 3 new `TestRFIDCardFallback` tests.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_gate_loop.py
git commit -m "test: add edge rfid_cards_cache fallback integration tests"
```

---

### Task 6: Whitelist sync test for rfid_cards

**Files:**
- Modify: `tests/integration/test_gate_loop.py`

- [ ] **Step 1: Add sync test that includes rfid_cards**

Add to the existing `TestWhitelistSync` class:

```python
    def test_whitelist_sync_populates_rfid_cards_cache(self, db):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data":{
            "vehicles": [],
            "blacklist": [],
            "rfid_cards": [
                {"uid_hash": "sync_test_hash_padded_0000000000000000000000000000000000000000",
                 "card_type": "staff", "unit_id": "u-s1", "unit_number": "S-10",
                 "expires_at": "2027-12-31T00:00:00Z"}
            ]
        }}
        with patch("requests.get", return_value=mock_resp):
            from edge.whitelist_sync import sync_from_cloud
            with patch("edge.whitelist_sync.cfg") as mock_cfg:
                mock_cfg.OFFLINE_DB_PATH = db
                mock_cfg.CLOUD_API_URL = "http://localhost:3000/api/v1"
                mock_cfg.DEVICE_TOKEN = "test-token"
                mock_cfg.COMMUNITY_ID = "test-community"
                sync_from_cloud()
        from edge.whitelist_sync import load_local
        result = load_local(db, "rfid", "sync_test_hash_padded_0000000000000000000000000000000000000000")
        assert result is not None
        assert result["unit_number"] == "S-10"
        assert result["card_type"] == "staff"
```

- [ ] **Step 2: Run all tests**

Run: `cd C:/Users/calblr2734/Desktop/gateopener && python -m pytest tests/integration/test_gate_loop.py -v`
Expected: All tests PASS.

- [ ] **Step 3: Run API tests too**

Run: `cd services/api-gateway && npx vitest run --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 4: Commit all**

```bash
git add tests/integration/test_gate_loop.py
git commit -m "test: add whitelist sync rfid_cards_cache population test"
```
