"""tests/integration/test_gate_realworld.py

Real-world gate scenarios that exercise the edge decision engine end-to-end:
the FASTag->ANPR correlation flow, the duplicate-read dedup window, offline
event tagging, offline-queue idempotency/failure-resilience, and the
card-sync block path.

Complements test_gate_loop.py (which covers the simpler lookups). Hardware (the
real C3 TCP link + RT-log parsing) is still only validated at Level 2.
No AWS, no physical devices — C3Mock stands in for the panel.
"""
import json
import sqlite3
import time

import pytest
from unittest.mock import patch, MagicMock


# ── Fixtures ──────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def env(monkeypatch):
    for k, v in {
        "USE_C3_MOCK": "true", "USE_CAMERA_MOCK": "true",
        "GATE_ID": "gate-test", "COMMUNITY_ID": "test-community",
        "DEVICE_TOKEN": "test-token", "GATE_TYPE": "entry",
        "C3_IP": "127.0.0.1", "C3_POLL_INTERVAL_SECONDS": "0.1",
        "C3_OPEN_DURATION_SECONDS": "1",
    }.items():
        monkeypatch.setenv(k, v)


@pytest.fixture
def db(tmp_path):
    """Whitelist/blacklist/rfid SQLite DB with the production schema."""
    path = str(tmp_path / "whitelist.db")
    with sqlite3.connect(path) as c:
        c.execute("""CREATE TABLE whitelist(plate TEXT,rfid_uid_hash TEXT,fastag_tid_hash TEXT,
            unit_id TEXT,unit_number TEXT,resident_name TEXT)""")
        c.execute("CREATE INDEX idx_wl_p ON whitelist(plate)")
        c.execute("CREATE INDEX idx_wl_f ON whitelist(fastag_tid_hash)")
        c.execute("CREATE TABLE blacklist_cache(plate TEXT,rfid_uid_hash TEXT,fastag_tid_hash TEXT)")
        c.execute("CREATE TABLE sync_meta(id INT PRIMARY KEY,last_sync REAL)")
        c.execute("INSERT INTO sync_meta VALUES(1,?)", (time.time(),))
        c.execute("""CREATE TABLE rfid_cards_cache(uid_hash TEXT, card_type TEXT,
            unit_id TEXT, unit_number TEXT, expires_at REAL)""")
    return path


@pytest.fixture
def qdb(tmp_path):
    return str(tmp_path / "queue.db")


@pytest.fixture
def gate(db, qdb):
    """Configure gate_controller globals against the temp DBs + a mock C3,
    then restore everything afterwards so tests stay isolated."""
    import edge.gate_controller as gc
    from edge.offline_queue import OfflineQueue
    from edge.emulators.c3_mock import C3Mock

    saved = (gc.cfg.OFFLINE_DB_PATH, gc.cfg.OFFLINE_QUEUE_PATH,
             gc._online, gc._c3, gc._oq)
    gc.cfg.OFFLINE_DB_PATH = db
    gc.cfg.OFFLINE_QUEUE_PATH = qdb
    gc._c3 = C3Mock(open_duration=0.1)
    gc._c3.connect()
    gc._oq = OfflineQueue(qdb)
    gc._pending_unknown.clear()
    gc._last_read.clear()
    gc._seen_ids.clear()
    try:
        yield gc
    finally:
        (gc.cfg.OFFLINE_DB_PATH, gc.cfg.OFFLINE_QUEUE_PATH,
         gc._online, gc._c3, gc._oq) = saved
        gc._pending_unknown.clear()
        gc._last_read.clear()
        gc._seen_ids.clear()


# ── Helpers ────────────────────────────────────────────────────────────
def _add_vehicle(db, plate=None, fastag=None, unit="A-101", name="Asha"):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?,?)",
                  (plate, None, fastag, "u1", unit, name))


def _add_blacklist(db, plate=None, fastag=None):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO blacklist_cache VALUES(?,?,?)", (plate, None, fastag))


def _last_event(qdb):
    with sqlite3.connect(qdb) as c:
        row = c.execute("SELECT payload FROM pending_events ORDER BY created_at DESC LIMIT 1").fetchone()
    return json.loads(row[0]) if row else None


def _cloud_resp(decision, **extra):
    """A MagicMock usable as a requests.post return value for both
    /access/check (reads .json()['data']) and /auto-pair (reads .status_code)."""
    m = MagicMock()
    m.status_code = 200
    m.json.return_value = {"data": {"decision": decision, **extra}}
    return m


# ══════════════════════════════════════════════════════════════════════
class TestOfflineQueueRobustness:
    """Store-and-forward must never lose events and must be idempotent."""

    def test_duplicate_event_id_is_idempotent(self, qdb):
        from edge.offline_queue import OfflineQueue
        q = OfflineQueue(qdb)
        q.enqueue({"event_id": "dup-1", "raw_value": "X"})
        q.enqueue({"event_id": "dup-1", "raw_value": "X"})
        assert q.pending_count() == 1

    def test_failed_sync_keeps_events_pending(self, qdb):
        from edge.offline_queue import OfflineQueue
        q = OfflineQueue(qdb)
        q.enqueue({"event_id": "e1"})
        with patch("requests.post") as mp:
            mp.return_value.status_code = 500  # cloud rejects
            synced = q.sync("http://localhost:3000/api/v1", "test-token")
        assert synced == 0
        assert q.pending_count() == 1  # not lost


class TestC3LocalAllowAndDedup:
    """C3 grants known FASTags locally; we log them and suppress double reads."""

    def test_local_allow_is_queued_and_tagged_offline(self, gate, qdb):
        gate._online = False
        gate._process_c3_event({"card_number": "FT_RES", "event_type": "allow", "door": 1})
        evt = _last_event(qdb)
        assert evt is not None
        assert evt["access_decision"] == "allow"
        assert evt["detection_method"] == "fastag"
        assert evt["is_offline_event"] is True

    def test_double_tap_within_window_deduped(self, gate, qdb):
        gate._online = False
        gate._process_c3_event({"card_number": "FT_RES", "event_type": "allow", "door": 1})
        gate._process_c3_event({"card_number": "FT_RES", "event_type": "allow", "door": 1})
        assert gate._oq.pending_count() == 1


class TestFastagAnprCorrelation:
    """The headline edge feature: an unknown FASTag is parked, then resolved
    when the ANPR camera reports a plate within the correlation window."""

    def test_unknown_fastag_then_allowed_plate_opens_and_autopairs(self, gate, qdb):
        gate._online = True
        gate._process_c3_event({"card_number": "FT_NEW", "event_type": "deny", "door": 1})
        assert "FT_NEW" in gate._pending_unknown

        with patch("requests.post", return_value=_cloud_resp("allow", unit_number="A-101")) as mp:
            gate.handle_anpr_detection("TN22CD4321", confidence=0.93)
            # door opens synchronously; assert before the 0.1s auto-close fires
            assert gate._c3.get_status()["door_open"] is True
            time.sleep(0.2)  # let the background auto-pair thread run

        assert "FT_NEW" not in gate._pending_unknown
        assert _last_event(qdb)["access_decision"] == "allow"
        assert any("auto-pair" in str(call.args[0]) for call in mp.call_args_list)

    def test_unknown_fastag_then_blacklisted_plate_denied(self, gate, qdb):
        gate._online = True
        _add_blacklist(gate.cfg.OFFLINE_DB_PATH, plate="TN00BAD000")
        gate._process_c3_event({"card_number": "FT_X", "event_type": "deny", "door": 1})

        # cloud WOULD allow, but local blacklist must win and short-circuit
        with patch("requests.post", return_value=_cloud_resp("allow")):
            gate.handle_anpr_detection("TN00BAD000", confidence=0.9)

        assert gate._c3.get_status()["door_open"] is False
        assert _last_event(qdb)["access_decision"] == "deny"
        assert "FT_X" not in gate._pending_unknown

    def test_unknown_fastag_then_unknown_plate_is_guard_review(self, gate, qdb):
        gate._online = False  # offline -> only local cache, plate not present
        gate._process_c3_event({"card_number": "FT_Y", "event_type": "deny", "door": 1})
        gate.handle_anpr_detection("UNKNOWNPLATE", confidence=0.6)
        assert gate._c3.get_status()["door_open"] is False
        assert _last_event(qdb)["access_decision"] == "guard_review"


class TestCardSyncBlocklist:
    """push_cards_to_c3 must push the whitelist AND register blocked cards."""

    def test_blocked_cards_pushed_and_denied(self, db):
        from edge.emulators.c3_mock import C3Mock
        from edge.whitelist_sync import push_cards_to_c3
        _add_vehicle(db, plate="P1", fastag="FT_A")
        _add_vehicle(db, plate="P2", fastag=None)        # no FASTag -> not pushed
        _add_blacklist(db, fastag="FT_BAD")

        c3 = C3Mock()
        c3.connect()
        pushed = push_cards_to_c3(db, c3)
        assert pushed == 1                               # only FT_A
        assert c3.get_status()["blocked_count"] == 1     # FT_BAD registered

        c3.simulate_card_tap("FT_BAD")
        assert c3.get_status()["door_open"] is False      # blocked card denied
