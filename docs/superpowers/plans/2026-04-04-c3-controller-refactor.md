# C3-100 Controller Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Raspberry Pi GPIO architecture with ZKTeco C3-100 TCP/IP controller. C3 decides locally for known cards, CommunityGate server manages card sync, event polling, ANPR correlation, and remote unlock.

**Architecture:** C3-100 holds the FASTag whitelist locally and opens relay for known cards (~30ms). CommunityGate polls C3 for events every 500ms, handles unknown cards via ANPR correlation, and sends remote unlock commands. No Pi, no GPIO, no serial — pure TCP/IP.

**Tech Stack:** Python 3.11+, pyzkaccess (ZKTeco C3 SDK), existing ANPR service, existing API gateway

---

## File Structure

**New files:**
- `edge/c3_controller.py` — C3 SDK wrapper (connect, sync cards, poll events, open door)
- `edge/emulators/c3_mock.py` — Mock C3 for development/testing
- `tests/unit/test_c3_controller.py` — C3 controller + mock unit tests

**Modified files:**
- `edge/config.py` — Replace GPIO/UHF/RFID config with C3 TCP/IP config
- `edge/gate_controller.py` — Rewrite: C3 event poller + ANPR correlation
- `edge/whitelist_sync.py` — After cloud sync, push cards to C3

**Unchanged:**
- `edge/anpr_client.py`, `edge/offline_queue.py`, `edge/emulators/camera_mock.py`
- All API gateway code, Guard App, Admin Portal

---

### Task 1: C3 Mock Emulator

**Files:**
- Create: `edge/emulators/c3_mock.py`
- Create: `tests/unit/test_c3_controller.py`

- [ ] **Step 1: Create C3 mock**

Create `edge/emulators/c3_mock.py`:

```python
"""Mock ZKTeco C3-100 controller for development/testing."""
import time, logging, threading
log = logging.getLogger("c3_mock")


class C3Mock:
    """In-memory simulation of C3-100. Same interface as C3Controller."""

    def __init__(self, ip="127.0.0.1", port=4370, serial_number="",
                 door_number=1, open_duration=5):
        self.ip = ip
        self.port = port
        self.serial_number = serial_number
        self.door_number = door_number
        self.open_duration = open_duration
        self._cards: set[str] = set()
        self._blocked: set[str] = set()
        self._events: list[dict] = []
        self._poll_cursor = 0
        self._connected = False
        self._door_open = False
        self._scenario_thread = None

    def connect(self) -> bool:
        self._connected = True
        log.info(f"[C3 MOCK] Connected to {self.ip}:{self.port}")
        return True

    def disconnect(self):
        self._connected = False
        log.info("[C3 MOCK] Disconnected")

    def is_connected(self) -> bool:
        return self._connected

    def sync_cards(self, cards: list[str]) -> int:
        self._cards = set(cards)
        log.info(f"[C3 MOCK] Synced {len(cards)} cards")
        return len(cards)

    def clear_cards(self) -> bool:
        self._cards.clear()
        return True

    def add_card(self, card_number: str) -> bool:
        self._cards.add(card_number)
        log.info(f"[C3 MOCK] Added card {card_number[:12]}...")
        return True

    def remove_card(self, card_number: str) -> bool:
        self._cards.discard(card_number)
        return True

    def block_card(self, card_number: str) -> bool:
        self._blocked.add(card_number)
        return True

    def poll_events(self) -> list[dict]:
        new_events = self._events[self._poll_cursor:]
        self._poll_cursor = len(self._events)
        return new_events

    def open_door(self) -> bool:
        self._door_open = True
        log.info(f"[C3 MOCK] Door {self.door_number} OPENED ({self.open_duration}s)")

        def _close():
            time.sleep(self.open_duration)
            self._door_open = False
            log.info(f"[C3 MOCK] Door {self.door_number} CLOSED")
        threading.Thread(target=_close, daemon=True).start()
        return True

    def get_status(self) -> dict:
        return {
            "connected": self._connected,
            "ip": self.ip,
            "card_count": len(self._cards),
            "blocked_count": len(self._blocked),
            "door_open": self._door_open,
        }

    # ── Mock helpers (not in real C3Controller) ──────────────────────
    def simulate_card_tap(self, card_number: str):
        """Simulate a card being tapped on the Wiegand reader."""
        if card_number in self._blocked:
            event_type = "deny"
        elif card_number in self._cards:
            event_type = "allow"
            self.open_door()
        else:
            event_type = "deny"
        self._events.append({
            "card_number": card_number,
            "event_type": event_type,
            "door": self.door_number,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
        log.info(f"[C3 MOCK] Card tap: {card_number[:12]}... → {event_type}")

    def run_scenario(self, steps: list[dict], loop=False):
        """steps = [{"card": "abc123...", "delay": 5.0}, ...]"""
        def _go():
            while True:
                for s in steps:
                    time.sleep(s.get("delay", 3.0))
                    self.simulate_card_tap(s["card"])
                if not loop:
                    break
        self._scenario_thread = threading.Thread(target=_go, daemon=True)
        self._scenario_thread.start()
```

- [ ] **Step 2: Write unit tests**

Create `tests/unit/test_c3_controller.py`:

```python
"""Tests for C3 controller mock."""
import pytest, time
from edge.emulators.c3_mock import C3Mock


class TestC3MockConnection:
    def test_connect_and_disconnect(self):
        c3 = C3Mock()
        assert not c3.is_connected()
        assert c3.connect()
        assert c3.is_connected()
        c3.disconnect()
        assert not c3.is_connected()

    def test_get_status(self):
        c3 = C3Mock(ip="10.0.0.1")
        c3.connect()
        status = c3.get_status()
        assert status["connected"] is True
        assert status["ip"] == "10.0.0.1"
        assert status["card_count"] == 0


class TestC3MockCards:
    def test_sync_cards(self):
        c3 = C3Mock()
        c3.connect()
        count = c3.sync_cards(["card_a", "card_b", "card_c"])
        assert count == 3
        assert c3.get_status()["card_count"] == 3

    def test_add_and_remove_card(self):
        c3 = C3Mock()
        c3.connect()
        c3.add_card("card_x")
        assert c3.get_status()["card_count"] == 1
        c3.remove_card("card_x")
        assert c3.get_status()["card_count"] == 0

    def test_clear_cards(self):
        c3 = C3Mock()
        c3.connect()
        c3.sync_cards(["a", "b", "c"])
        c3.clear_cards()
        assert c3.get_status()["card_count"] == 0

    def test_block_card(self):
        c3 = C3Mock()
        c3.connect()
        c3.block_card("bad_card")
        assert c3.get_status()["blocked_count"] == 1


class TestC3MockEvents:
    def test_known_card_tap_generates_allow(self):
        c3 = C3Mock()
        c3.connect()
        c3.sync_cards(["known_card_hash"])
        c3.simulate_card_tap("known_card_hash")
        events = c3.poll_events()
        assert len(events) == 1
        assert events[0]["card_number"] == "known_card_hash"
        assert events[0]["event_type"] == "allow"

    def test_unknown_card_tap_generates_deny(self):
        c3 = C3Mock()
        c3.connect()
        c3.simulate_card_tap("unknown_card_hash")
        events = c3.poll_events()
        assert len(events) == 1
        assert events[0]["event_type"] == "deny"

    def test_blocked_card_generates_deny(self):
        c3 = C3Mock()
        c3.connect()
        c3.sync_cards(["blocked_card"])
        c3.block_card("blocked_card")
        c3.simulate_card_tap("blocked_card")
        events = c3.poll_events()
        assert len(events) == 1
        assert events[0]["event_type"] == "deny"

    def test_poll_returns_only_new_events(self):
        c3 = C3Mock()
        c3.connect()
        c3.simulate_card_tap("card_1")
        events1 = c3.poll_events()
        assert len(events1) == 1
        c3.simulate_card_tap("card_2")
        events2 = c3.poll_events()
        assert len(events2) == 1
        assert events2[0]["card_number"] == "card_2"

    def test_open_door(self):
        c3 = C3Mock(open_duration=0.1)
        c3.connect()
        assert c3.open_door()
        assert c3.get_status()["door_open"] is True
        time.sleep(0.3)
        assert c3.get_status()["door_open"] is False

    def test_scenario_playback(self):
        c3 = C3Mock()
        c3.connect()
        c3.sync_cards(["known"])
        c3.run_scenario([
            {"card": "known", "delay": 0.1},
            {"card": "unknown", "delay": 0.1},
        ], loop=False)
        time.sleep(0.5)
        events = c3.poll_events()
        assert len(events) == 2
        assert events[0]["event_type"] == "allow"
        assert events[1]["event_type"] == "deny"
```

- [ ] **Step 3: Run tests**

Run: `cd C:/Users/calblr2734/Desktop/gateopener && python -m pytest tests/unit/test_c3_controller.py -v`
Expected: All 12 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add edge/emulators/c3_mock.py tests/unit/test_c3_controller.py
git commit -m "feat: add C3-100 mock emulator with card sync, events, and door control"
```

---

### Task 2: C3 Controller SDK Wrapper

**Files:**
- Create: `edge/c3_controller.py`

- [ ] **Step 1: Create C3 controller**

Create `edge/c3_controller.py`:

```python
"""ZKTeco C3-100 controller wrapper using pyzkaccess SDK.

Provides: card sync, event polling, remote door unlock.
All communication over TCP/IP to the C3's Ethernet port.

Install: pip install pyzkaccess
"""
import time, logging
log = logging.getLogger("c3_controller")

try:
    from pyzkaccess import ZKAccess
    _HAS_SDK = True
except ImportError:
    _HAS_SDK = False
    log.warning("pyzkaccess not installed — C3 controller unavailable. Install: pip install pyzkaccess")


class C3Controller:
    """Wrapper around pyzkaccess for ZKTeco C3-100 Plus."""

    def __init__(self, ip: str = "192.168.1.201", port: int = 4370,
                 serial_number: str = "", door_number: int = 1,
                 open_duration: int = 5):
        if not _HAS_SDK:
            raise ImportError("pyzkaccess required. Install: pip install pyzkaccess")
        self.ip = ip
        self.port = port
        self.serial_number = serial_number
        self.door_number = door_number
        self.open_duration = open_duration
        self._zk: ZKAccess | None = None
        self._last_event_index = 0

    def connect(self) -> bool:
        try:
            connstr = f"protocol=TCP,ipaddress={self.ip},port={self.port}"
            self._zk = ZKAccess(connstr=connstr)
            log.info(f"C3 connected: {self.ip}:{self.port}")
            return True
        except Exception as e:
            log.error(f"C3 connect failed: {e}")
            self._zk = None
            return False

    def disconnect(self):
        if self._zk:
            try:
                self._zk = None
            except Exception:
                pass
        log.info("C3 disconnected")

    def is_connected(self) -> bool:
        return self._zk is not None

    def sync_cards(self, cards: list[str]) -> int:
        """Replace all cards on the C3 with the given list."""
        if not self._zk:
            return 0
        try:
            # Clear existing cards
            self._zk.table("user").clear()
            # Add new cards
            for card in cards:
                self._zk.table("user").upsert([{
                    "CardNo": card,
                    "Pin": card[:10],
                    "Doors": str(self.door_number),
                }])
            log.info(f"C3 synced {len(cards)} cards")
            return len(cards)
        except Exception as e:
            log.error(f"C3 card sync failed: {e}")
            return 0

    def clear_cards(self) -> bool:
        if not self._zk:
            return False
        try:
            self._zk.table("user").clear()
            return True
        except Exception as e:
            log.error(f"C3 clear cards failed: {e}")
            return False

    def add_card(self, card_number: str) -> bool:
        if not self._zk:
            return False
        try:
            self._zk.table("user").upsert([{
                "CardNo": card_number,
                "Pin": card_number[:10],
                "Doors": str(self.door_number),
            }])
            log.info(f"C3 added card {card_number[:12]}...")
            return True
        except Exception as e:
            log.error(f"C3 add card failed: {e}")
            return False

    def remove_card(self, card_number: str) -> bool:
        if not self._zk:
            return False
        try:
            self._zk.table("user").delete(CardNo=card_number)
            return True
        except Exception as e:
            log.error(f"C3 remove card failed: {e}")
            return False

    def block_card(self, card_number: str) -> bool:
        """Remove the card so C3 denies it."""
        return self.remove_card(card_number)

    def poll_events(self) -> list[dict]:
        """Get new card events since last poll."""
        if not self._zk:
            return []
        try:
            raw_events = self._zk.table("transaction").select()
            new_events = []
            for evt in raw_events[self._last_event_index:]:
                new_events.append({
                    "card_number": evt.get("CardNo", ""),
                    "event_type": "allow" if evt.get("Verified") else "deny",
                    "door": int(evt.get("Door", self.door_number)),
                    "timestamp": evt.get("TimeStamp", time.strftime("%Y-%m-%dT%H:%M:%S")),
                })
            self._last_event_index = len(raw_events)
            return new_events
        except Exception as e:
            log.error(f"C3 poll events failed: {e}")
            return []

    def open_door(self) -> bool:
        """Remote unlock: trigger relay for configured duration."""
        if not self._zk:
            return False
        try:
            self._zk.door(self.door_number).open(self.open_duration)
            log.info(f"C3 door {self.door_number} opened ({self.open_duration}s)")
            return True
        except Exception as e:
            log.error(f"C3 open door failed: {e}")
            return False

    def get_status(self) -> dict:
        return {
            "connected": self.is_connected(),
            "ip": self.ip,
            "door_number": self.door_number,
        }
```

- [ ] **Step 2: Commit**

```bash
git add edge/c3_controller.py
git commit -m "feat: add C3-100 controller SDK wrapper with pyzkaccess"
```

---

### Task 3: Config Updates

**Files:**
- Modify: `edge/config.py`

- [ ] **Step 1: Replace GPIO/UHF/RFID config with C3 config**

Replace the entire content of `edge/config.py` with:

```python
import os
from dataclasses import dataclass

@dataclass
class Config:
    GATE_ID:       str  = os.environ["GATE_ID"]
    COMMUNITY_ID:  str  = os.environ["COMMUNITY_ID"]
    DEVICE_TOKEN:  str  = os.environ["DEVICE_TOKEN"]
    CLOUD_API_URL: str  = os.getenv("CLOUD_API_URL", "http://localhost:3000/api/v1")

    GATE_TYPE:     str  = os.getenv("GATE_TYPE", "entry")
    COMMAND_TTL:   int  = int(os.getenv("MQTT_COMMAND_TTL_SECONDS", "30"))

    # ZKTeco C3-100 controller
    C3_IP:           str   = os.getenv("C3_IP", "192.168.1.201")
    C3_PORT:         int   = int(os.getenv("C3_PORT", "4370"))
    C3_SERIAL:       str   = os.getenv("C3_SERIAL", "")
    C3_POLL_INTERVAL:    float = float(os.getenv("C3_POLL_INTERVAL_SECONDS", "0.5"))
    C3_CARD_SYNC_INTERVAL: int = int(os.getenv("C3_CARD_SYNC_INTERVAL_SECONDS", "300"))
    C3_DOOR_NUMBER:  int   = int(os.getenv("C3_DOOR_NUMBER", "1"))
    C3_OPEN_DURATION: int  = int(os.getenv("C3_OPEN_DURATION_SECONDS", "5"))
    USE_C3_MOCK:     bool  = os.getenv("USE_C3_MOCK", "true").lower()=="true"

    # MQTT
    MQTT_BROKER:    str  = os.getenv("MQTT_BROKER", "localhost")
    MQTT_PORT:      int  = int(os.getenv("MQTT_PORT", "1883"))
    MQTT_USE_TLS:   bool = os.getenv("MQTT_USE_TLS","false").lower()=="true"
    MQTT_CERT_PATH: str  = os.getenv("MQTT_CERT_PATH", "")
    MQTT_KEY_PATH:  str  = os.getenv("MQTT_KEY_PATH", "")
    MQTT_CA_PATH:   str  = os.getenv("MQTT_CA_PATH", "")

    # Offline storage
    OFFLINE_DB_PATH:    str = os.getenv("OFFLINE_DB_PATH",    "/tmp/whitelist.db")
    OFFLINE_QUEUE_PATH: str = os.getenv("OFFLINE_QUEUE_PATH", "/tmp/event_queue.db")
    WHITELIST_SYNC_INTERVAL: int = int(os.getenv("WHITELIST_SYNC_INTERVAL_SECONDS","300"))
    HEARTBEAT_INTERVAL: int = int(os.getenv("HEARTBEAT_INTERVAL_SECONDS","60"))

    # ANPR
    ANPR_SERVICE_URL: str   = os.getenv("ANPR_SERVICE_URL", "http://localhost:8001")
    ANPR_THRESHOLD:   float = float(os.getenv("ANPR_CONFIDENCE_THRESHOLD","0.75"))
    ANPR_CAPTURE_INTERVAL: float = float(os.getenv("ANPR_CAPTURE_INTERVAL_SECONDS", "1.0"))
    ANPR_MOTION_THRESHOLD: float = float(os.getenv("ANPR_MOTION_THRESHOLD", "5000"))
    ANPR_COOLDOWN:    float = float(os.getenv("ANPR_COOLDOWN_SECONDS", "8"))

    # ANPR correlation
    FASTAG_CORRELATION_WINDOW: float = float(os.getenv("FASTAG_CORRELATION_WINDOW_SECONDS", "5"))

    # Camera mock
    USE_CAMERA_MOCK: bool = os.getenv("USE_CAMERA_MOCK", "true").lower()=="true"
    MOCK_CAMERA_INTERVAL: float = float(os.getenv("MOCK_CAMERA_INTERVAL_SECONDS","4"))
    MOCK_CAMERA_PLATE_DIR: str  = os.getenv("MOCK_CAMERA_PLATE_DIR","scripts/test_plates")

cfg = Config()
```

- [ ] **Step 2: Commit**

```bash
git add edge/config.py
git commit -m "refactor: replace GPIO/UHF/RFID config with C3-100 TCP/IP config"
```

---

### Task 4: Gate Controller Rewrite

**Files:**
- Modify: `edge/gate_controller.py`

- [ ] **Step 1: Rewrite gate controller for C3 architecture**

Replace the entire content of `edge/gate_controller.py` with:

```python
#!/usr/bin/env python3
"""Main gate controller — C3-100 architecture.

Entry gate: C3 handles known FASTag cards locally. This service polls C3 for
events, handles unknown cards via ANPR correlation, and manages card sync.

Exit gate: Camera audit only, no C3.
"""
import os, time, json, threading, logging
from edge.config import cfg

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[logging.StreamHandler()])
log = logging.getLogger("gate")

# ── C3 controller: mock or real ──────────────────────────────────────
if cfg.USE_C3_MOCK:
    from edge.emulators.c3_mock import C3Mock as C3Impl
    log.warning("C3 MOCK active")
else:
    from edge.c3_controller import C3Controller as C3Impl

# ── Camera: mock or real ─────────────────────────────────────────────
if cfg.USE_CAMERA_MOCK:
    from edge.emulators.camera_mock import CameraMock as CameraImpl
    log.warning("CAMERA MOCK active")
else:
    from edge.anpr_client import ANPRClient as CameraImpl

import paho.mqtt.client as mqtt
import requests
from edge.offline_queue import OfflineQueue
from edge.whitelist_sync import load_local, is_blacklisted_local, start_sync

# ── Shared state ──────────────────────────────────────────────────────
_lock        = threading.Lock()
_online      = False
_seen_ids:   dict[str, float] = {}
_oq          = OfflineQueue(cfg.OFFLINE_QUEUE_PATH)
_mqtt_client = None
_c3          = None
_pending_unknown: dict[str, dict] = {}  # card_number → {ts, event}

# ── Cloud helpers ─────────────────────────────────────────────────────
def _cloud_check(method, value, conf=None):
    try:
        r = requests.post(f"{cfg.CLOUD_API_URL}/access/check",
                          json={"community_id":cfg.COMMUNITY_ID,"gate_id":cfg.GATE_ID,
                                "method":method,"value":value,"confidence":conf,"ts":time.time()},
                          headers={"X-Device-Token":cfg.DEVICE_TOKEN}, timeout=2.0)
        return r.json()["data"]
    except Exception as e:
        log.warning(f"Cloud check failed: {e}")
        return None

def _local_check(method, value):
    if is_blacklisted_local(cfg.OFFLINE_DB_PATH, method, value):
        return {"decision":"deny","source":"local","reason":"blacklisted"}
    row = load_local(cfg.OFFLINE_DB_PATH, method, value)
    if row:
        return {"decision":"allow","source":"local",**row}
    return {"decision":"guard_review","source":"local","reason":"unknown_offline"}

def _try_auto_pair(tid_hash: str, plate: str):
    try:
        r = requests.post(f"{cfg.CLOUD_API_URL}/vehicles/auto-pair",
                          json={"community_id": cfg.COMMUNITY_ID,
                                "plate": plate, "fastag_tid_hash": tid_hash},
                          headers={"X-Device-Token": cfg.DEVICE_TOKEN}, timeout=3.0)
        if r.status_code == 200:
            log.info(f"AUTO-PAIRED: {plate} → {tid_hash[:12]}...")
            # Push newly paired card to C3 immediately
            if _c3 and _c3.is_connected():
                _c3.add_card(tid_hash)
        else:
            log.warning(f"Auto-pair failed ({r.status_code}): {r.text[:200]}")
    except Exception as e:
        log.warning(f"Auto-pair error: {e}")

# ── C3 event poller ──────────────────────────────────────────────────
def _process_c3_event(event: dict):
    """Handle a single event from C3 polling."""
    card = event["card_number"]
    etype = event["event_type"]

    if etype == "allow":
        log.info(f"C3 ALLOWED (local): {card[:12]}...")
        _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                      "detection_method": "fastag", "raw_value": card,
                      "access_decision": "allow", "is_offline_event": not _online,
                      "event_ts": time.time()})
    elif etype == "deny":
        log.info(f"C3 DENIED (unknown card): {card[:12]}... — queuing for ANPR correlation")
        _pending_unknown[card] = {"ts": time.time(), "event": event}
        # Clean old pending entries
        now = time.time()
        for k in [k for k, v in _pending_unknown.items() if now - v["ts"] > 30]:
            del _pending_unknown[k]

def _c3_poll_loop():
    """Continuously poll C3 for new events."""
    while True:
        try:
            if _c3 and _c3.is_connected():
                events = _c3.poll_events()
                for event in events:
                    _process_c3_event(event)
        except Exception as e:
            log.error(f"C3 poll error: {e}")
        time.sleep(cfg.C3_POLL_INTERVAL)

# ── ANPR handler (correlates with pending unknown FASTag) ─────────────
def handle_anpr_detection(plate: str, confidence: float = None):
    if not plate:
        return
    log.info(f"ANPR detection: plate={plate} conf={confidence}")
    now = time.time()

    # Check for pending unknown FASTag within correlation window
    for card_number, pending in list(_pending_unknown.items()):
        if (now - pending["ts"]) < cfg.FASTAG_CORRELATION_WINDOW:
            # Correlate: unknown FASTag + ANPR result
            if is_blacklisted_local(cfg.OFFLINE_DB_PATH, "anpr", plate):
                log.info(f"DENIED (plate blacklisted during correlation)")
                _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                              "detection_method": "anpr", "raw_value": plate,
                              "access_decision": "deny", "deny_reason": "blacklisted",
                              "anpr_confidence": confidence, "is_offline_event": not _online,
                              "event_ts": time.time()})
                del _pending_unknown[card_number]
                return

            plate_result = None
            if _online:
                plate_result = _cloud_check("anpr", plate, confidence)
            if not plate_result or plate_result.get("decision") != "allow":
                plate_result = _local_check("anpr", plate)

            if plate_result and plate_result["decision"] == "allow":
                # Remote unlock C3
                if _c3 and _c3.is_connected():
                    _c3.open_door()
                log.info(f"GRANTED (ANPR correlated) → {plate_result.get('unit_number')}")
                # Auto-pair in background
                if _online:
                    threading.Thread(target=_try_auto_pair,
                                     args=(card_number, plate), daemon=True).start()
                _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                              "detection_method": "anpr", "raw_value": plate,
                              "access_decision": "allow", "anpr_confidence": confidence,
                              "is_offline_event": not _online, "event_ts": time.time()})
                del _pending_unknown[card_number]
                return
            else:
                log.info(f"GUARD REVIEW — unknown FASTag + unknown plate {plate}")
                _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                              "detection_method": "anpr", "raw_value": plate,
                              "access_decision": "guard_review", "deny_reason": "not_recognized",
                              "anpr_confidence": confidence, "is_offline_event": not _online,
                              "event_ts": time.time()})
                del _pending_unknown[card_number]
                return

    # No pending FASTag — standard ANPR-only access check
    if is_blacklisted_local(cfg.OFFLINE_DB_PATH, "anpr", plate):
        result = {"decision": "deny", "reason": "blacklisted"}
    elif _online:
        result = _cloud_check("anpr", plate, confidence) or _local_check("anpr", plate)
    else:
        result = _local_check("anpr", plate)

    decision = result["decision"]
    if decision == "allow":
        if _c3 and _c3.is_connected():
            _c3.open_door()
        log.info(f"GRANTED (ANPR) → {result.get('unit_number')} ({result.get('resident_name')})")
    else:
        log.info(f"DENIED (ANPR) — {result.get('reason')}")

    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                 "detection_method": "anpr", "raw_value": plate,
                 "access_decision": decision, "deny_reason": result.get("reason"),
                 "anpr_confidence": confidence, "is_offline_event": not _online,
                 "event_ts": time.time()})

# ── MQTT (gate commands from admin portal) ────────────────────────────
def _on_command(client, userdata, msg):
    try:
        cmd = json.loads(msg.payload)
        eid = cmd.get("event_id","")
        ttl = cmd.get("ttl")
        if ttl is not None and ttl < time.time():
            log.warning(f"TTL expired — command {eid} rejected"); return
        now = time.time()
        if _seen_ids.get(eid,0) > now-60:
            log.warning(f"Duplicate command {eid} ignored"); return
        _seen_ids[eid] = now
        for k in [k for k,v in _seen_ids.items() if v < now-60]: del _seen_ids[k]
        if cmd.get("action") == "open":
            if _c3 and _c3.is_connected():
                _c3.open_door()
            if client:
                client.publish(f"cg/{cfg.COMMUNITY_ID}/gates/{cfg.GATE_ID}/ack",
                               json.dumps({"event_id":eid,"status":"opened",
                                           "gate_id":cfg.GATE_ID,"ts":time.time()}), qos=1)
    except Exception as e:
        log.error(f"Command error: {e}")

def start_mqtt():
    global _mqtt_client, _online
    c = mqtt.Client(client_id=f"gate-{cfg.GATE_ID}", clean_session=False)
    if cfg.MQTT_USE_TLS:
        import ssl
        c.tls_set(cfg.MQTT_CA_PATH, cfg.MQTT_CERT_PATH, cfg.MQTT_KEY_PATH,
                  tls_version=ssl.PROTOCOL_TLSv1_2)
    def on_connect(c,u,f,rc):
        global _online
        if rc==0:
            _online = True; log.info("MQTT connected — online mode")
            c.subscribe(f"cg/{cfg.COMMUNITY_ID}/gates/{cfg.GATE_ID}/commands", qos=1)
            c.subscribe(f"cg/{cfg.COMMUNITY_ID}/admin/broadcast", qos=1)
    def on_disconnect(c,u,rc):
        global _online; _online=False
        log.warning(f"MQTT disconnected rc={rc} — offline mode")
    c.on_connect=on_connect; c.on_disconnect=on_disconnect
    c.message_callback_add(f"cg/{cfg.COMMUNITY_ID}/gates/{cfg.GATE_ID}/commands",_on_command)
    c.connect_async(cfg.MQTT_BROKER, cfg.MQTT_PORT, keepalive=30)
    c.loop_start(); _mqtt_client = c

# ── Entry point ───────────────────────────────────────────────────────
def main():
    global _c3
    log.info(f"CommunityGate starting — gate={cfg.GATE_ID} type={cfg.GATE_TYPE}")
    start_sync()
    start_mqtt()

    if cfg.GATE_TYPE == "exit":
        log.info("EXIT gate mode — camera audit only")
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
                         "access_decision": "allow", "anpr_confidence": r.get("confidence"),
                         "is_offline_event": not _online, "event_ts": time.time()})
            if r.get("plate") else None)
    else:
        # Entry gate: C3 controller + ANPR
        _c3 = C3Impl(ip=cfg.C3_IP, port=cfg.C3_PORT,
                      serial_number=cfg.C3_SERIAL,
                      door_number=cfg.C3_DOOR_NUMBER,
                      open_duration=cfg.C3_OPEN_DURATION)
        if not _c3.connect():
            log.error("C3 connection failed — running in degraded mode (ANPR only)")

        # Start C3 event poller thread
        threading.Thread(target=_c3_poll_loop, daemon=True).start()
        log.info(f"C3 event poller started (interval={cfg.C3_POLL_INTERVAL}s)")

        # Start ANPR camera (async)
        if cfg.USE_CAMERA_MOCK:
            cam = CameraImpl(anpr_url=cfg.ANPR_SERVICE_URL,
                             plates_dir=cfg.MOCK_CAMERA_PLATE_DIR,
                             interval=cfg.MOCK_CAMERA_INTERVAL)
        else:
            cam = CameraImpl(rtsp_url=os.environ["RTSP_CAMERA_URL"],
                             anpr_url=cfg.ANPR_SERVICE_URL)
        cam.start(on_detection=lambda r:
            handle_anpr_detection(r["plate"], r.get("confidence"))
            if r.get("plate") and r.get("confidence", 0) >= cfg.ANPR_THRESHOLD else None)

    log.info("Gate controller running. CTRL+C to stop.")
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        if 'cam' in dir(): cam.stop()
        if _c3: _c3.disconnect()
        if _mqtt_client: _mqtt_client.loop_stop()

if __name__ == "__main__": main()
```

- [ ] **Step 2: Commit**

```bash
git add edge/gate_controller.py
git commit -m "refactor: rewrite gate controller for C3-100 architecture

- C3 handles known FASTag cards locally via Wiegand
- Event poller catches allow/deny events every 500ms
- Unknown cards correlated with ANPR for auto-pairing
- Remote unlock via C3 SDK for ANPR matches and admin commands
- No GPIO, no UHF serial, no Pi dependencies"
```

---

### Task 5: Whitelist Sync — Push Cards to C3

**Files:**
- Modify: `edge/whitelist_sync.py`

- [ ] **Step 1: Add C3 card push after cloud sync**

In `edge/whitelist_sync.py`, add a function to push FASTag cards to C3 and call it after cloud sync. Add after the `is_blacklisted_local` function:

```python
def push_cards_to_c3(db, c3):
    """Push all FASTag TID hashes from whitelist to C3 controller."""
    if not c3 or not c3.is_connected():
        log.warning("C3 not connected — skipping card push")
        return 0
    with sqlite3.connect(db) as c:
        rows = c.execute("SELECT fastag_tid_hash FROM whitelist WHERE fastag_tid_hash IS NOT NULL AND fastag_tid_hash != ''").fetchall()
    cards = [r[0] for r in rows]
    count = c3.sync_cards(cards)
    # Also push blocked cards
    with sqlite3.connect(db) as c:
        blocked = c.execute("SELECT fastag_tid_hash FROM blacklist_cache WHERE fastag_tid_hash IS NOT NULL AND fastag_tid_hash != ''").fetchall()
    for b in blocked:
        c3.block_card(b[0])
    log.info(f"Pushed {count} cards + {len(blocked)} blocked to C3")
    return count
```

- [ ] **Step 2: Update start_sync to accept optional c3 parameter**

Replace the `start_sync` function:

```python
_c3_ref = None

def start_sync(c3=None):
    global _c3_ref
    _c3_ref = c3
    _init_db(); sync_from_cloud()
    if _c3_ref:
        push_cards_to_c3(cfg.OFFLINE_DB_PATH, _c3_ref)
    schedule.every(cfg.WHITELIST_SYNC_INTERVAL).seconds.do(_sync_and_push)
    def _loop():
        while True: schedule.run_pending(); time.sleep(10)
    threading.Thread(target=_loop, daemon=True).start()

def _sync_and_push():
    sync_from_cloud()
    if _c3_ref:
        push_cards_to_c3(cfg.OFFLINE_DB_PATH, _c3_ref)
```

- [ ] **Step 3: Update gate_controller.py to pass c3 to start_sync**

In `edge/gate_controller.py`, in the `main()` function, find:

```python
    start_sync()
```

Replace with:

```python
    start_sync(c3=_c3 if cfg.GATE_TYPE != "exit" else None)
```

But wait — `_c3` is initialized later in the entry gate block. Move `start_sync` after C3 is created. In the `main()` function, restructure:

For entry gates, change the order so C3 is created first, then `start_sync` is called with it. Find:

```python
    start_sync()
    start_mqtt()
```

Replace with:

```python
    start_mqtt()
```

Then in the entry gate block, after `_c3.connect()`, add:

```python
        start_sync(c3=_c3)
```

And in the exit gate block, before camera setup, add:

```python
        start_sync()
```

- [ ] **Step 4: Commit**

```bash
git add edge/whitelist_sync.py edge/gate_controller.py
git commit -m "feat: push FASTag whitelist to C3 after each cloud sync"
```

---

### Task 6: Integration Tests

**Files:**
- Modify: `tests/integration/test_gate_loop.py`

- [ ] **Step 1: Update env fixture for C3 config**

In the `env` fixture, replace the env vars:

```python
@pytest.fixture(autouse=True)
def env(monkeypatch):
    for k, v in {
        "USE_C3_MOCK":"true","USE_CAMERA_MOCK":"true",
        "GATE_ID":"gate-test","COMMUNITY_ID":"test-community",
        "DEVICE_TOKEN":"test-token","GATE_TYPE":"entry",
        "C3_IP":"127.0.0.1","C3_POLL_INTERVAL_SECONDS":"0.1",
        "C3_OPEN_DURATION_SECONDS":"1",
    }.items(): monkeypatch.setenv(k, v)
```

- [ ] **Step 2: Add C3 integration tests**

Add new test class:

```python
class TestC3Integration:

    def test_known_card_in_c3_generates_allow_event(self):
        from edge.emulators.c3_mock import C3Mock
        c3 = C3Mock(open_duration=0.1)
        c3.connect()
        c3.sync_cards(["known_fastag_hash"])
        c3.simulate_card_tap("known_fastag_hash")
        events = c3.poll_events()
        assert len(events) == 1
        assert events[0]["event_type"] == "allow"
        assert events[0]["card_number"] == "known_fastag_hash"

    def test_unknown_card_generates_deny_event(self):
        from edge.emulators.c3_mock import C3Mock
        c3 = C3Mock()
        c3.connect()
        c3.simulate_card_tap("unknown_hash")
        events = c3.poll_events()
        assert len(events) == 1
        assert events[0]["event_type"] == "deny"

    def test_remote_unlock_opens_door(self):
        from edge.emulators.c3_mock import C3Mock
        c3 = C3Mock(open_duration=0.1)
        c3.connect()
        assert c3.open_door()
        assert c3.get_status()["door_open"] is True
        time.sleep(0.2)
        assert c3.get_status()["door_open"] is False

    def test_push_cards_to_c3(self, db):
        from edge.emulators.c3_mock import C3Mock
        from edge.whitelist_sync import push_cards_to_c3
        c3 = C3Mock()
        c3.connect()
        count = push_cards_to_c3(db, c3)
        # db fixture has 2 vehicles with fastag_tid_hash
        assert count >= 2
        assert c3.get_status()["card_count"] >= 2
```

- [ ] **Step 3: Run all tests**

Run: `cd C:/Users/calblr2734/Desktop/gateopener && python -m pytest tests/ -v`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_gate_loop.py
git commit -m "test: add C3-100 integration tests for card sync, events, and remote unlock"
```
