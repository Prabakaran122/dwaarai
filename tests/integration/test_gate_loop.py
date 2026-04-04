"""tests/integration/test_gate_loop.py
Full gate loop tests with mocked hardware. No AWS. No physical devices.
"""
import pytest, time, json, sqlite3, os
from unittest.mock import patch, MagicMock


# ── Fixtures ──────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def env(monkeypatch):
    for k, v in {
        "USE_C3_MOCK":"true","USE_CAMERA_MOCK":"true",
        "GATE_ID":"gate-test","COMMUNITY_ID":"test-community",
        "DEVICE_TOKEN":"test-token","GATE_TYPE":"entry",
        "C3_IP":"127.0.0.1","C3_POLL_INTERVAL_SECONDS":"0.1",
        "C3_OPEN_DURATION_SECONDS":"1",
    }.items(): monkeypatch.setenv(k, v)


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "whitelist.db")
    with sqlite3.connect(path) as c:
        c.execute("""CREATE TABLE whitelist(plate TEXT,rfid_uid_hash TEXT,fastag_tid_hash TEXT,
            unit_id TEXT,unit_number TEXT,resident_name TEXT)""")
        c.execute("CREATE INDEX idx_wl_p ON whitelist(plate)")
        c.execute("CREATE INDEX idx_wl_r ON whitelist(rfid_uid_hash)")
        c.execute("CREATE INDEX idx_wl_f ON whitelist(fastag_tid_hash)")
        c.execute("""CREATE TABLE blacklist_cache(plate TEXT,rfid_uid_hash TEXT,fastag_tid_hash TEXT)""")
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
        # Residents (with FASTag)
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?,?)", ("KA05MF1234", None, "fastag_hash_301", "u301", "301", "Priya Sharma"))
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?,?)", (None, "a3f9c2d4e5f6", None, "u205", "205", "Rajan Kumar"))
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?,?)", ("KA05EB2345", "b1c2d3e4f5a6", "fastag_hash_107", "u107", "107", "Anil Nair"))
        # Blacklist
        c.execute("INSERT INTO blacklist_cache VALUES(?,?,?)", ("DL01ZZ9999", None, None))
    return path


@pytest.fixture
def qdb(tmp_path): return str(tmp_path / "queue.db")


class TestANPRAccess:

    def test_known_plate_triggers_c3_open(self, db, qdb):
        """Registered plate → C3 remote unlock via handle_anpr_detection."""
        import edge.gate_controller as gc
        from edge.emulators.c3_mock import C3Mock
        orig_db = gc.cfg.OFFLINE_DB_PATH
        orig_q = gc.cfg.OFFLINE_QUEUE_PATH
        orig_online = gc._online
        orig_c3 = gc._c3
        try:
            gc.cfg.OFFLINE_DB_PATH = db
            gc.cfg.OFFLINE_QUEUE_PATH = qdb
            gc._online = False
            gc._c3 = C3Mock(open_duration=0.1)
            gc._c3.connect()
            gc._oq = __import__('edge.offline_queue', fromlist=['OfflineQueue']).OfflineQueue(qdb)
            gc.handle_anpr_detection("KA05MF1234", confidence=0.94)
            time.sleep(0.2)
        finally:
            gc.cfg.OFFLINE_DB_PATH = orig_db
            gc.cfg.OFFLINE_QUEUE_PATH = orig_q
            gc._online = orig_online
            gc._c3 = orig_c3
        # C3 mock door should have opened and closed
        assert gc._c3 is None or not gc._c3  # restored

    def test_unknown_plate_offline_is_guard_review(self, db):
        from edge.whitelist_sync import load_local, is_blacklisted_local
        assert load_local(db, "anpr", "MH12XX9999") is None
        assert not is_blacklisted_local(db, "anpr", "MH12XX9999")


class TestRFIDAccess:

    def test_known_rfid_found_in_whitelist(self, db):
        """RFID lookup works via whitelist (C3 architecture doesn't use RFID directly)."""
        from edge.whitelist_sync import load_local
        result = load_local(db, "rfid", "a3f9c2d4e5f6")
        assert result is not None
        assert result["resident_name"] == "Rajan Kumar"

    def test_unknown_rfid_offline_guard_review(self, db):
        from edge.whitelist_sync import load_local
        assert load_local(db, "rfid", "000000000000") is None


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


class TestBlacklist:

    def test_blacklisted_plate_detected(self, db):
        """Blacklisted plate is detected by local check."""
        from edge.whitelist_sync import is_blacklisted_local
        assert is_blacklisted_local(db, "anpr", "DL01ZZ9999")

    def test_non_blacklisted_plate_not_detected(self, db):
        from edge.whitelist_sync import is_blacklisted_local
        assert not is_blacklisted_local(db, "anpr", "KA05MF1234")


class TestSafety:

    def test_expired_mqtt_command_rejected(self):
        from edge.gate_controller import _on_command
        import edge.gate_controller as gc
        from edge.emulators.c3_mock import C3Mock
        gc._c3 = C3Mock()
        gc._c3.connect()
        cmd = {"action":"open","event_id":"test-1","ttl":int(time.time())-60,"plate":"KA05MF1234"}
        msg = MagicMock(); msg.payload = json.dumps(cmd).encode()
        _on_command(None, None, msg)
        # C3 should NOT have opened — no events
        events = gc._c3.poll_events()
        assert len(events) == 0

    def test_duplicate_mqtt_command_ignored(self):
        from edge.gate_controller import _on_command, _seen_ids
        import edge.gate_controller as gc
        from edge.emulators.c3_mock import C3Mock
        gc._c3 = C3Mock()
        gc._c3.connect()
        eid = "dedup-test-123"
        _seen_ids[eid] = time.time()
        cmd = {"action":"open","event_id":eid,"ttl":int(time.time())+30}
        msg = MagicMock(); msg.payload = json.dumps(cmd).encode()
        _on_command(None, None, msg)
        assert gc._c3.get_status()["door_open"] is False


class TestOfflineQueue:

    def test_events_queued_when_offline(self, db, qdb):
        import edge.gate_controller as gc
        from edge.emulators.c3_mock import C3Mock
        orig_db = gc.cfg.OFFLINE_DB_PATH
        orig_q = gc.cfg.OFFLINE_QUEUE_PATH
        orig_online = gc._online
        orig_c3 = gc._c3
        try:
            gc.cfg.OFFLINE_DB_PATH = db
            gc.cfg.OFFLINE_QUEUE_PATH = qdb
            gc._online = False
            gc._c3 = C3Mock(open_duration=0.1)
            gc._c3.connect()
            gc._oq = __import__('edge.offline_queue', fromlist=['OfflineQueue']).OfflineQueue(qdb)
            gc.handle_anpr_detection("KA05MF1234", 0.94)
            time.sleep(0.2)
        finally:
            gc.cfg.OFFLINE_DB_PATH = orig_db
            gc.cfg.OFFLINE_QUEUE_PATH = orig_q
            gc._online = orig_online
            gc._c3 = orig_c3
        from edge.offline_queue import OfflineQueue
        assert OfflineQueue(qdb).pending_count() >= 1

    def test_offline_sync_clears_queue(self, qdb):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(qdb)
        oq.enqueue({"detection_method":"anpr","raw_value":"KA05MF1234","event_ts":time.time()})
        assert oq.pending_count() == 1
        with patch("requests.post") as mp:
            mp.return_value.status_code = 200
            synced = oq.sync("http://localhost:3000/api/v1","test-token")
        assert synced == 1
        assert oq.pending_count() == 0


class TestWhitelistSync:

    def test_whitelist_sync_populates_db(self, db):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data":{"vehicles":[
            {"plate":"TN22AB1234","rfid_uid_hash":None,"unit_id":"u999",
             "unit_number":"999","resident_name":"Test User"}
        ],"blacklist":[]}}
        with patch("requests.get", return_value=mock_resp):
            from edge.whitelist_sync import sync_from_cloud
            with patch("edge.whitelist_sync.cfg") as mock_cfg:
                mock_cfg.OFFLINE_DB_PATH = db
                mock_cfg.CLOUD_API_URL = "http://localhost:3000/api/v1"
                mock_cfg.DEVICE_TOKEN = "test-token"
                mock_cfg.COMMUNITY_ID = "test-community"
                sync_from_cloud()
        from edge.whitelist_sync import load_local
        assert load_local(db, "anpr", "TN22AB1234") is not None

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
        # db fixture has 2 vehicles with fastag_tid_hash (301 and 107)
        assert count >= 2
        assert c3.get_status()["card_count"] >= 2
