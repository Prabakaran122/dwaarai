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

    def test_load_local_returns_none_for_unknown(self, wl_db):
        from edge.whitelist_sync import _init_db, load_local
        with patch("edge.whitelist_sync.cfg") as mock_cfg:
            mock_cfg.OFFLINE_DB_PATH = wl_db
            _init_db()
        result = load_local(wl_db, "anpr", "MH12XX9999")
        assert result is None

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
