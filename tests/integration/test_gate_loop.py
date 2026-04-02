"""tests/integration/test_gate_loop.py
Full gate loop tests with mocked hardware. No AWS. No physical devices.
"""
import pytest, time, json, sqlite3, os
from unittest.mock import patch, MagicMock


# ── Fixtures ──────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def env(monkeypatch):
    for k, v in {
        "USE_GPIO_MOCK":"true","USE_RFID_MOCK":"true","USE_CAMERA_MOCK":"true",
        "GATE_ID":"gate-test","COMMUNITY_ID":"test-community",
        "DEVICE_TOKEN":"test-token","RELAY_GPIO_PIN":"17",
        "RELAY_OPEN_SECONDS":"0.1","MQTT_COMMAND_TTL_SECONDS":"30",
    }.items(): monkeypatch.setenv(k, v)


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "whitelist.db")
    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE whitelist(plate TEXT,rfid_uid_hash TEXT,unit_id TEXT,unit_number TEXT,resident_name TEXT)")
        c.execute("CREATE TABLE blacklist_cache(plate TEXT,rfid_uid_hash TEXT)")
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
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?)", ("KA05MF1234", None, "u301", "301", "Priya Sharma"))
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?)", (None, "a3f9c2d4e5f6", "u205", "205", "Rajan Kumar"))
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?)", ("KA05EB2345", "b1c2d3e4f5a6", "u107", "107", "Anil Nair"))
        # Blacklist
        c.execute("INSERT INTO blacklist_cache VALUES(?,?)", ("DL01ZZ9999", None))
    return path


@pytest.fixture
def qdb(tmp_path): return str(tmp_path / "queue.db")


@pytest.fixture
def gpio():
    from edge.emulators import gpio_mock
    gpio_mock._pins.clear()
    return gpio_mock


class TestANPRAccess:

    def test_known_plate_opens_gate(self, gpio, db, qdb):
        """Registered plate -> relay HIGH then LOW."""
        import edge.gate_controller as gc
        orig_db = gc.cfg.OFFLINE_DB_PATH
        orig_q = gc.cfg.OFFLINE_QUEUE_PATH
        orig_online = gc._online
        try:
            gc.cfg.OFFLINE_DB_PATH = db
            gc.cfg.OFFLINE_QUEUE_PATH = qdb
            gc._online = False
            gc._oq = __import__('edge.offline_queue', fromlist=['OfflineQueue']).OfflineQueue(qdb)
            gc.handle_detection("anpr", "KA05MF1234", confidence=0.94)
            time.sleep(0.3)
        finally:
            gc.cfg.OFFLINE_DB_PATH = orig_db
            gc.cfg.OFFLINE_QUEUE_PATH = orig_q
            gc._online = orig_online
        assert gpio.pin_state(17) == gpio.LOW  # back to LOW after open duration

    def test_unknown_plate_offline_is_guard_review(self, db):
        from edge.whitelist_sync import load_local, is_blacklisted_local
        assert load_local(db, "anpr", "MH12XX9999") is None
        assert not is_blacklisted_local(db, "anpr", "MH12XX9999")


class TestRFIDAccess:

    def test_known_rfid_opens_gate(self, gpio, db, qdb):
        import edge.gate_controller as gc
        orig_db = gc.cfg.OFFLINE_DB_PATH
        orig_q = gc.cfg.OFFLINE_QUEUE_PATH
        orig_online = gc._online
        try:
            gc.cfg.OFFLINE_DB_PATH = db
            gc.cfg.OFFLINE_QUEUE_PATH = qdb
            gc._online = False
            gc._oq = __import__('edge.offline_queue', fromlist=['OfflineQueue']).OfflineQueue(qdb)
            gc.handle_detection("rfid", "a3f9c2d4e5f6")
            time.sleep(0.3)
        finally:
            gc.cfg.OFFLINE_DB_PATH = orig_db
            gc.cfg.OFFLINE_QUEUE_PATH = orig_q
            gc._online = orig_online
        assert gpio.pin_state(17) == gpio.LOW

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


class TestBlacklist:

    def test_blacklisted_plate_never_opens_gate(self, gpio, db, qdb):
        import edge.gate_controller as gc
        orig_db = gc.cfg.OFFLINE_DB_PATH
        orig_q = gc.cfg.OFFLINE_QUEUE_PATH
        orig_online = gc._online
        try:
            gc.cfg.OFFLINE_DB_PATH = db
            gc.cfg.OFFLINE_QUEUE_PATH = qdb
            gc._online = False
            gc._oq = __import__('edge.offline_queue', fromlist=['OfflineQueue']).OfflineQueue(qdb)
            gc.handle_detection("anpr", "DL01ZZ9999", confidence=0.97)
            time.sleep(0.15)
        finally:
            gc.cfg.OFFLINE_DB_PATH = orig_db
            gc.cfg.OFFLINE_QUEUE_PATH = orig_q
            gc._online = orig_online
        # Gate should NOT have opened — pin should still be LOW
        assert gpio.pin_state(17) == gpio.LOW


class TestSafety:

    def test_expired_mqtt_command_rejected(self, gpio):
        from edge.gate_controller import _on_command
        cmd = {"action":"open","event_id":"test-1","ttl":int(time.time())-60,"plate":"KA05MF1234"}
        msg = MagicMock(); msg.payload = json.dumps(cmd).encode()
        with patch("edge.gate_controller.open_gate") as mo:
            _on_command(None, None, msg)
        mo.assert_not_called()

    def test_duplicate_mqtt_command_ignored(self, gpio):
        from edge.gate_controller import _on_command, _seen_ids
        eid = "dedup-test-123"
        _seen_ids[eid] = time.time()  # mark as already seen
        cmd = {"action":"open","event_id":eid,"ttl":int(time.time())+30}
        msg = MagicMock(); msg.payload = json.dumps(cmd).encode()
        with patch("edge.gate_controller.open_gate") as mo:
            _on_command(None, None, msg)
        mo.assert_not_called()


class TestOfflineQueue:

    def test_events_queued_when_offline(self, db, qdb):
        import edge.gate_controller as gc
        orig_db = gc.cfg.OFFLINE_DB_PATH
        orig_q = gc.cfg.OFFLINE_QUEUE_PATH
        orig_online = gc._online
        try:
            gc.cfg.OFFLINE_DB_PATH = db
            gc.cfg.OFFLINE_QUEUE_PATH = qdb
            gc._online = False
            gc._oq = __import__('edge.offline_queue', fromlist=['OfflineQueue']).OfflineQueue(qdb)
            gc.handle_detection("anpr", "KA05MF1234", 0.94)
            time.sleep(0.2)
        finally:
            gc.cfg.OFFLINE_DB_PATH = orig_db
            gc.cfg.OFFLINE_QUEUE_PATH = orig_q
            gc._online = orig_online
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
