# CommunityGate Phase 1 — Foundation + Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core gate access system — repo scaffold, database, edge firmware with hardware emulators, ANPR service, and gate controller — all testable locally with zero physical hardware.

**Architecture:** Monorepo (pnpm workspaces, ESM) with Python edge firmware using mock-flag hardware abstraction. SQLite provides offline whitelist cache and event queue on edge. ANPR runs as a separate FastAPI service. Docker Compose provides Postgres, Redis, and Mosquitto for local dev.

**Tech Stack:** Node.js 20, Python 3.11+, pnpm, PostgreSQL 15, Redis 7, Mosquitto MQTT, FastAPI, EasyOCR, pytest, Docker Compose

**Spec:** `spec_extracted.txt` (root) — all file paths, variable names, schemas, and code must match exactly.

**Important Implementation Notes:**
1. **Python import paths:** The spec's edge code uses bare imports (`from config import cfg`). For tests to import as `edge.gate_controller`, all edge internal imports must be package-relative: `from edge.config import cfg`, `from edge.emulators.gpio_mock import ...`, etc. Apply this adjustment consistently.
2. **Hyphenated directory:** `services/anpr-service/` cannot be imported as a Python package due to the hyphen. Normalizer tests should use `sys.path.insert` or a `conftest.py` to handle this.
3. **DB partitions:** Create all 16 partitions from `gate_events_y2025m01` through `gate_events_y2026m04` exactly as in the spec.

---

### Task 1: Initialize Git Repo and Monorepo Scaffold

**Files:**
- Create: `package.json` (root workspace scripts only)
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `CLAUDE.md`

- [ ] **Step 1: Initialize git repo**

```bash
cd /c/Users/calblr2734/Desktop/gateopener
git init
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "communitygate",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "packageManager": "pnpm@10.32.1",
  "scripts": {
    "dev": "docker compose -f docker-compose.dev.yml up",
    "db:migrate": "for f in services/api-gateway/migrations/*.sql; do psql $DATABASE_URL -f \"$f\"; done",
    "test": "pnpm --recursive test",
    "test:python": "pytest tests/ -v --tb=short"
  }
}
```

- [ ] **Step 3: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "services/*"
  - "infra/cdk"
```

- [ ] **Step 4: Create .gitignore**

Standard Node + Python ignores: `node_modules/`, `.env`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `dist/`, `build/`, `.next/`, `pgdata/`, `*.db`, `.venv/`, `venv/`, `spec_extracted.txt`

- [ ] **Step 5: Create .env.example**

Copy exact content from spec Section 3 — every env var with descriptions as comments.

- [ ] **Step 6: Create CLAUDE.md**

Brief project summary + build step checklist (Steps 1-20) with checkboxes to track progress.

- [ ] **Step 7: Run pnpm install to initialize lockfile**

```bash
npx pnpm install
```

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore .env.example CLAUDE.md pnpm-lock.yaml
git commit -m "feat: initialize monorepo scaffold with pnpm workspaces"
```

---

### Task 2: Docker Compose Local Dev Stack

**Files:**
- Create: `docker-compose.dev.yml`
- Create: `infra/docker/mosquitto.conf`

- [ ] **Step 1: Create infra/docker/mosquitto.conf**

```
listener 1883
allow_anonymous true
listener 9001
protocol websockets
```

- [ ] **Step 2: Create docker-compose.dev.yml**

Exact content from spec Section 11.3 — postgres, redis, mosquitto services only for now (other services added in later tasks). Use `healthcheck` for postgres.

- [ ] **Step 3: Test — bring up infrastructure containers**

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis mosquitto
```

Wait for healthy, then verify:
```bash
docker compose -f docker-compose.dev.yml ps
```
Expected: all 3 containers running/healthy.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.dev.yml infra/docker/mosquitto.conf
git commit -m "feat: add docker-compose dev stack with postgres, redis, mosquitto"
```

---

### Task 3: Database Migrations

**Files:**
- Create: `services/api-gateway/migrations/001_core.sql`
- Create: `services/api-gateway/migrations/002_gates_events.sql`
- Create: `services/api-gateway/migrations/003_passes_blacklist.sql`
- Create: `services/api-gateway/migrations/004_indexes.sql`
- Create: `services/api-gateway/migrations/005_seed.sql`

- [ ] **Step 1: Create 001_core.sql**

Exact SQL from spec Section 4 — communities, blocks, units, residents, vehicles tables. Uses `uuid-ossp` and `pg_trgm` extensions. All PKs are UUID via `uuid_generate_v4()`.

- [ ] **Step 2: Create 002_gates_events.sql**

Exact SQL from spec — gates table + partitioned gate_events table with all 16 monthly partitions: `gate_events_y2025m01` through `gate_events_y2025m12` and `gate_events_y2026m01` through `gate_events_y2026m04`. Indexes on community_id+event_ts, gate_id+event_ts, raw_value+event_ts.

- [ ] **Step 3: Create 003_passes_blacklist.sql**

Exact SQL from spec — visitor_passes, rfid_cards, blacklist tables with partial indexes.

- [ ] **Step 4: Create 004_indexes.sql**

Any additional indexes not already created in previous migrations. If none needed, create as empty file with comment.

- [ ] **Step 5: Create 005_seed.sql**

Seed data for testing: 1 community (Bangalore), 2 blocks, 5 units, 5 residents, 5 vehicles (matching the RFID mock test cards), 1 gate, 2 blacklist entries. Use specific UUIDs for test reproducibility.

- [ ] **Step 6: Test — run migrations against postgres**

```bash
docker compose -f docker-compose.dev.yml exec -T postgres psql -U cguser -d communitygate -f /dev/stdin < services/api-gateway/migrations/001_core.sql
```
Repeat for each migration file. Verify:
```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U cguser -d communitygate -c "\dt"
```
Expected: all tables listed.

- [ ] **Step 7: Create scripts/seed_db.sql**

A convenience copy/symlink of `005_seed.sql` at `scripts/seed_db.sql` as listed in the spec repo structure. Same content as `005_seed.sql`.

- [ ] **Step 8: Commit**

```bash
git add services/api-gateway/migrations/ scripts/seed_db.sql
git commit -m "feat: add database migrations with schema, partitions, and seed data"
```

---

### Task 4: Edge Emulators

**Files:**
- Create: `edge/__init__.py`
- Create: `edge/emulators/__init__.py`
- Create: `edge/emulators/gpio_mock.py`
- Create: `edge/emulators/rfid_mock.py`
- Create: `edge/emulators/camera_mock.py`
- Create: `tests/__init__.py`
- Create: `tests/unit/__init__.py`
- Create: `tests/unit/test_emulators.py`

- [ ] **Step 1: Create edge/__init__.py and edge/emulators/__init__.py**

Empty `__init__.py` files to make Python packages.

- [ ] **Step 2: Write failing tests for GPIO mock**

```python
# tests/unit/test_emulators.py
import pytest

class TestGPIOMock:
    def test_setup_and_output_high(self):
        from edge.emulators import gpio_mock as GPIO
        GPIO._pins.clear()
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(17, GPIO.OUT, initial=GPIO.LOW)
        assert GPIO.pin_state(17) == GPIO.LOW
        GPIO.output(17, GPIO.HIGH)
        assert GPIO.pin_state(17) == GPIO.HIGH

    def test_cleanup_clears_pins(self):
        from edge.emulators import gpio_mock as GPIO
        GPIO.setup(17, GPIO.OUT)
        GPIO.cleanup()
        assert GPIO.all_pins() == {}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /c/Users/calblr2734/Desktop/gateopener
python -m pytest tests/unit/test_emulators.py::TestGPIOMock -v
```
Expected: FAIL (module not found)

- [ ] **Step 4: Create edge/emulators/gpio_mock.py**

Exact code from spec Section 7.1.

- [ ] **Step 5: Run test to verify it passes**

```bash
python -m pytest tests/unit/test_emulators.py::TestGPIOMock -v
```
Expected: PASS

- [ ] **Step 6: Write failing tests for RFID mock**

```python
class TestRFIDMock:
    def test_tap_calls_callback_with_uid_hash(self):
        from edge.emulators.rfid_mock import RFIDMock, _hash, TEST_CARDS
        events = []
        mock = RFIDMock(on_tap_callback=lambda e: events.append(e))
        mock.tap("RESIDENT_301")
        assert len(events) == 1
        assert events[0]["uid_hash"] == _hash(TEST_CARDS["RESIDENT_301"]["uid"])

    def test_unknown_card_key_exists(self):
        from edge.emulators.rfid_mock import TEST_CARDS
        assert "UNKNOWN" in TEST_CARDS
        assert "BLACKLISTED" in TEST_CARDS
```

- [ ] **Step 7: Run test to verify it fails, then create edge/emulators/rfid_mock.py**

Exact code from spec Section 7.2.

- [ ] **Step 8: Run test to verify it passes**

```bash
python -m pytest tests/unit/test_emulators.py::TestRFIDMock -v
```
Expected: PASS

- [ ] **Step 9: Write failing tests for camera mock**

```python
class TestCameraMock:
    def test_init_loads_images(self, tmp_path):
        # Create a fake plate image
        img_path = tmp_path / "KA05MF1234.jpg"
        img_path.write_bytes(b'\xff\xd8\xff\xe0' + b'\x00' * 100)  # minimal JPEG header
        from edge.emulators.camera_mock import CameraMock
        cam = CameraMock(anpr_url="http://localhost:8001",
                         plates_dir=str(tmp_path), interval=1.0)
        assert len(cam._images) == 1

    def test_init_no_images_raises(self, tmp_path):
        from edge.emulators.camera_mock import CameraMock
        with pytest.raises(FileNotFoundError):
            CameraMock(anpr_url="http://localhost:8001",
                       plates_dir=str(tmp_path), interval=1.0)
```

- [ ] **Step 10: Create edge/emulators/camera_mock.py**

Exact code from spec Section 7.3.

- [ ] **Step 11: Run all emulator tests**

```bash
python -m pytest tests/unit/test_emulators.py -v
```
Expected: All PASS

- [ ] **Step 12: Commit**

```bash
git add edge/ tests/
git commit -m "feat: add edge hardware emulators (GPIO, RFID, camera mocks)"
```

---

### Task 5: Edge Config

**Files:**
- Create: `edge/config.py`
- Create: `edge/requirements.txt`

- [ ] **Step 1: Create edge/requirements.txt**

```
paho-mqtt==1.6.1
requests==2.31.0
schedule==1.2.1
```

- [ ] **Step 2: Install edge Python dependencies**

```bash
pip install -r edge/requirements.txt
```

- [ ] **Step 3: Create edge/config.py**

Exact code from spec Section 8.1 — dataclass with all env vars, `cfg = Config()` singleton.

- [ ] **Step 4: Test — verify config loads with mock env vars**

```bash
GATE_ID=gate-test COMMUNITY_ID=test-community DEVICE_TOKEN=test-token python -c "from edge.config import cfg; print(f'gate={cfg.GATE_ID} mock={cfg.USE_GPIO_MOCK}')"
```
Expected: `gate=gate-test mock=True`

- [ ] **Step 5: Commit**

```bash
git add edge/config.py edge/requirements.txt
git commit -m "feat: add edge config dataclass with env var loading"
```

---

### Task 6: Offline Queue

**Files:**
- Create: `edge/offline_queue.py`
- Create: `tests/unit/test_offline_queue.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/unit/test_offline_queue.py
import pytest, time
from unittest.mock import patch

class TestOfflineQueue:
    def test_enqueue_and_count(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        oq.enqueue({"detection_method": "anpr", "raw_value": "KA05MF1234", "event_ts": time.time()})
        assert oq.pending_count() == 1

    def test_sync_clears_queue(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        oq.enqueue({"detection_method": "anpr", "raw_value": "KA05MF1234", "event_ts": time.time()})
        with patch("requests.post") as mp:
            mp.return_value.status_code = 200
            synced = oq.sync("http://localhost:3000/api/v1", "test-token")
        assert synced == 1
        assert oq.pending_count() == 0

    def test_sync_failure_keeps_queue(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        oq.enqueue({"detection_method": "anpr", "raw_value": "KA05MF1234", "event_ts": time.time()})
        with patch("requests.post", side_effect=Exception("network error")):
            synced = oq.sync("http://localhost:3000/api/v1", "test-token")
        assert synced == 0
        assert oq.pending_count() == 1
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/unit/test_offline_queue.py -v
```
Expected: FAIL

- [ ] **Step 3: Create edge/offline_queue.py**

Exact code from spec Section 8.3.

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/unit/test_offline_queue.py -v
```
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add edge/offline_queue.py tests/unit/test_offline_queue.py
git commit -m "feat: add SQLite offline event queue with sync capability"
```

---

### Task 7: Whitelist Sync

**Files:**
- Create: `edge/whitelist_sync.py`
- Create: `tests/unit/test_whitelist_sync.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/unit/test_whitelist_sync.py
import pytest, time, sqlite3, os
from unittest.mock import patch, MagicMock

@pytest.fixture
def wl_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "whitelist.db")
    monkeypatch.setenv("GATE_ID", "gate-test")
    monkeypatch.setenv("COMMUNITY_ID", "test-community")
    monkeypatch.setenv("DEVICE_TOKEN", "test-token")
    monkeypatch.setenv("OFFLINE_DB_PATH", db_path)
    return db_path

class TestWhitelistSync:
    def test_init_creates_tables(self, wl_db):
        from edge.whitelist_sync import _init_db
        with patch("edge.whitelist_sync.cfg") as mock_cfg:
            mock_cfg.OFFLINE_DB_PATH = wl_db
            _init_db()
        with sqlite3.connect(wl_db) as c:
            tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        assert "whitelist" in tables
        assert "blacklist_cache" in tables

    def test_load_local_finds_plate(self, wl_db):
        from edge.whitelist_sync import _init_db, load_local
        with patch("edge.whitelist_sync.cfg") as mock_cfg:
            mock_cfg.OFFLINE_DB_PATH = wl_db
            _init_db()
        with sqlite3.connect(wl_db) as c:
            c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?)",
                      ("KA05MF1234", None, "u301", "301", "Priya Sharma"))
        result = load_local(wl_db, "anpr", "KA05MF1234")
        assert result is not None
        assert result["unit_number"] == "301"

    def test_is_blacklisted_local(self, wl_db):
        from edge.whitelist_sync import _init_db, is_blacklisted_local
        with patch("edge.whitelist_sync.cfg") as mock_cfg:
            mock_cfg.OFFLINE_DB_PATH = wl_db
            _init_db()
        with sqlite3.connect(wl_db) as c:
            c.execute("INSERT INTO blacklist_cache VALUES(?,?)", ("DL01ZZ9999", None))
        assert is_blacklisted_local(wl_db, "anpr", "DL01ZZ9999") is True
        assert is_blacklisted_local(wl_db, "anpr", "KA05MF1234") is False

    def test_sync_from_cloud_populates_db(self, wl_db):
        from edge.whitelist_sync import _init_db, sync_from_cloud, load_local
        with patch("edge.whitelist_sync.cfg") as mock_cfg:
            mock_cfg.OFFLINE_DB_PATH = wl_db
            mock_cfg.CLOUD_API_URL = "http://localhost:3000/api/v1"
            mock_cfg.DEVICE_TOKEN = "test-token"
            mock_cfg.COMMUNITY_ID = "test-community"
            _init_db()
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"data": {"vehicles": [
                {"plate": "TN22AB1234", "rfid_uid_hash": None, "unit_id": "u999",
                 "unit_number": "999", "resident_name": "Test User"}
            ], "blacklist": []}}
            with patch("requests.get", return_value=mock_resp):
                sync_from_cloud()
        assert load_local(wl_db, "anpr", "TN22AB1234") is not None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/unit/test_whitelist_sync.py -v
```
Expected: FAIL

- [ ] **Step 3: Create edge/whitelist_sync.py**

Exact code from spec Section 8.4.

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/unit/test_whitelist_sync.py -v
```
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add edge/whitelist_sync.py tests/unit/test_whitelist_sync.py
git commit -m "feat: add whitelist sync with SQLite cache and blacklist check"
```

---

### Task 8: ANPR Service

**Files:**
- Create: `services/anpr-service/main.py`
- Create: `services/anpr-service/normalizer.py`
- Create: `services/anpr-service/requirements.txt`
- Create: `services/anpr-service/Dockerfile`
- Create: `scripts/test_anpr_accuracy.py`
- Create: `scripts/test_plates/` (placeholder images)

- [ ] **Step 1: Create services/anpr-service/requirements.txt**

Exact from spec Section 9.2.

- [ ] **Step 2: Create services/anpr-service/normalizer.py**

Extract the `normalize_plate` function from the spec into its own module:

```python
import re

def normalize_plate(raw: str) -> str | None:
    """Normalize Indian number plates to compact format."""
    s = re.sub(r"[^A-Z0-9]", "", raw.upper())
    if re.match(r"^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$", s): return s
    if re.match(r"^\d{2}BH\d{4}[A-Z]{2}$", s): return s
    return None
```

- [ ] **Step 3: Write normalizer tests**

Note: `services/anpr-service/` has a hyphen so can't be imported as a Python package. Use `sys.path` in a conftest or inline:

```python
# tests/unit/test_normalizer.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'services', 'anpr-service'))
from normalizer import normalize_plate

class TestNormalizePlate:
    def test_standard_plate(self):
        assert normalize_plate("KA 05 MF 1234") == "KA05MF1234"

    def test_already_normalized(self):
        assert normalize_plate("KA05MF1234") == "KA05MF1234"

    def test_bh_series(self):
        assert normalize_plate("24BH1234AA") == "24BH1234AA"

    def test_invalid_plate(self):
        assert normalize_plate("HELLO") is None

    def test_lowercase_normalized(self):
        assert normalize_plate("ka05mf1234") == "KA05MF1234"
```

- [ ] **Step 4: Run normalizer tests**

```bash
python -m pytest tests/unit/test_normalizer.py -v
```
Expected: All PASS

- [ ] **Step 5: Create services/anpr-service/main.py**

Exact code from spec Section 9.1, importing `normalize_plate` from `normalizer`.

- [ ] **Step 6: Create services/anpr-service/Dockerfile**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

- [ ] **Step 7: Create scripts/test_plates/ directory with at least 1 test plate image**

Create the directory. For real accuracy testing, actual Indian plate images are needed. Create a placeholder README explaining the expected format.

- [ ] **Step 8: Create scripts/test_anpr_accuracy.py**

Exact code from spec Section 9.3.

- [ ] **Step 9: Commit**

```bash
git add services/anpr-service/ scripts/ tests/unit/test_normalizer.py
git commit -m "feat: add ANPR service with FastAPI, EasyOCR, and plate normalizer"
```

---

### Task 9: Gate Controller + Integration Tests

**Files:**
- Create: `edge/gate_controller.py`
- Create: `edge/rfid_reader.py` (stub for real hardware)
- Create: `edge/anpr_client.py` (stub for real hardware)
- Create: `tests/integration/__init__.py`
- Create: `tests/integration/test_gate_loop.py`

- [ ] **Step 1: Create edge/rfid_reader.py stub**

```python
"""Real MFRC522 RFID reader. Used when USE_RFID_MOCK=false."""
import logging
log = logging.getLogger("rfid_reader")

class RFIDReader:
    def __init__(self, on_tap_callback):
        self.cb = on_tap_callback
        log.info("Real RFID reader initialized")

    def run(self):
        """Blocking SPI polling loop — runs in its own thread."""
        raise NotImplementedError("Real RFID reader requires RPi hardware")
```

- [ ] **Step 2: Create edge/anpr_client.py stub**

```python
"""Real ANPR client for RTSP camera. Used when USE_CAMERA_MOCK=false."""
import logging
log = logging.getLogger("anpr_client")

class ANPRClient:
    def __init__(self, rtsp_url: str):
        self.rtsp_url = rtsp_url
        log.info(f"Real ANPR client initialized: {rtsp_url}")

    def start(self, on_detection=None):
        raise NotImplementedError("Real ANPR client requires RTSP camera")

    def stop(self):
        pass
```

- [ ] **Step 3: Create edge/gate_controller.py**

Exact code from spec Section 8.2. This is the main process that orchestrates GPIO, RFID, camera, MQTT, and access decisions.

- [ ] **Step 4: Create tests/integration/__init__.py**

Empty file.

- [ ] **Step 5: Create tests/integration/test_gate_loop.py**

Based on spec Section 10 with the following fix — the spec's `db` fixture has a bug where `c.execute` passes values as positional args instead of a tuple. The corrected fixture:

```python
@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "whitelist.db")
    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE whitelist(plate TEXT,rfid_uid_hash TEXT,unit_id TEXT,unit_number TEXT,resident_name TEXT)")
        c.execute("CREATE TABLE blacklist_cache(plate TEXT,rfid_uid_hash TEXT)")
        c.execute("CREATE TABLE sync_meta(id INT PRIMARY KEY,last_sync REAL)")
        c.execute("INSERT INTO sync_meta VALUES(1,?)", (time.time(),))
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?)", ("KA05MF1234", None, "u301", "301", "Priya Sharma"))
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?)", (None, "a3f9c2d4e5f6", "u205", "205", "Rajan Kumar"))
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?)", ("KA05EB2345", "b1c2d3e4f5a6", "u107", "107", "Anil Nair"))
        c.execute("INSERT INTO blacklist_cache VALUES(?,?)", ("DL01ZZ9999", None))
    return path
```

Also, all edge imports in tests must use package-relative paths (`from edge.gate_controller import handle_detection`, etc.) and gate_controller.py itself must use `from edge.config import cfg`, `from edge.offline_queue import OfflineQueue`, etc.

The test file covers:
- `TestANPRAccess`: known plate opens gate, unknown plate is guard_review, low confidence doesn't open
- `TestRFIDAccess`: known RFID opens gate, unknown RFID is guard_review
- `TestBlacklist`: blacklisted plate never opens
- `TestSafety`: duplicate open ignored, expired MQTT rejected, duplicate MQTT ignored
- `TestOfflineQueue`: events queued when offline, sync clears queue
- `TestWhitelistSync`: sync populates db

- [ ] **Step 6: Run integration tests**

```bash
GATE_ID=gate-test COMMUNITY_ID=test-community DEVICE_TOKEN=test-token USE_GPIO_MOCK=true USE_RFID_MOCK=true USE_CAMERA_MOCK=true python -m pytest tests/integration/test_gate_loop.py -v --tb=short
```
Expected: All tests PASS

- [ ] **Step 7: Run full test suite**

```bash
GATE_ID=gate-test COMMUNITY_ID=test-community DEVICE_TOKEN=test-token USE_GPIO_MOCK=true USE_RFID_MOCK=true USE_CAMERA_MOCK=true python -m pytest tests/ -v --tb=short
```
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add edge/gate_controller.py edge/rfid_reader.py edge/anpr_client.py tests/integration/
git commit -m "feat: add gate controller with MQTT, access decisions, and integration tests"
```

---

### Task 10: Docker Compose Edge Emulator + Final Verification

**Files:**
- Modify: `docker-compose.dev.yml` (add anpr-service and edge-emulator services)

- [ ] **Step 1: Update docker-compose.dev.yml**

Add `anpr-service` and `edge-emulator` services from spec Section 11.3.

- [ ] **Step 2: Create edge/Dockerfile.dev**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "gate_controller.py"]
```

- [ ] **Step 3: Verify full docker compose stack builds**

```bash
docker compose -f docker-compose.dev.yml build anpr-service edge-emulator
```
Expected: Both images build successfully.

- [ ] **Step 4: Run all tests one final time**

```bash
GATE_ID=gate-test COMMUNITY_ID=test-community DEVICE_TOKEN=test-token USE_GPIO_MOCK=true USE_RFID_MOCK=true USE_CAMERA_MOCK=true python -m pytest tests/ -v
```
Expected: All PASS

- [ ] **Step 5: Update CLAUDE.md — mark Steps 1-8 as complete**

- [ ] **Step 6: Commit**

```bash
git add docker-compose.dev.yml edge/Dockerfile.dev CLAUDE.md
git commit -m "feat: complete Phase 1 — edge emulator docker setup and final verification"
```
