"""Plate visitor passes: kind tagging + offline validity-window enforcement."""
import os, sqlite3, tempfile, time
os.environ.update({"GATE_ID": "t", "COMMUNITY_ID": "t", "DEVICE_TOKEN": "t", "USE_C3_MOCK": "true"})
import edge.whitelist_sync as wl


def _db():
    p = tempfile.mktemp(suffix=".db")
    with sqlite3.connect(p) as c:
        c.execute("CREATE TABLE whitelist(plate,rfid_uid_hash,fastag_tid_hash,unit_id,unit_number,resident_name)")
        c.execute("CREATE TABLE plate_passes_cache(plate,unit_id,unit_number,holder_name,valid_from,expires_at)")
    return p


def test_resident_vehicle_kind_and_normalization():
    p = _db()
    with sqlite3.connect(p) as c:
        c.execute("INSERT INTO whitelist VALUES(?,?,?,?,?,?)",
                  ("KA05MF1234", None, None, "u1", "A-101", "Ravi"))
    r = wl.load_local(p, "anpr", "ka05 mf-1234")   # dirty input -> normalized match
    assert r and r["kind"] == "resident_vehicle" and r["unit_number"] == "A-101"


def test_visitor_pass_within_window():
    p = _db(); now = time.time()
    with sqlite3.connect(p) as c:
        c.execute("INSERT INTO plate_passes_cache VALUES(?,?,?,?,?,?)",
                  ("KA05VIS1", "u1", "A-101", "Guest", now - 60, now + 3600))
    r = wl.load_local(p, "anpr", "KA05VIS1")
    assert r and r["kind"] == "visitor_pass"


def test_visitor_pass_expired_denied_offline():
    p = _db(); now = time.time()
    with sqlite3.connect(p) as c:
        c.execute("INSERT INTO plate_passes_cache VALUES(?,?,?,?,?,?)",
                  ("KA05VIS2", "u1", "A-101", "Guest", now - 7200, now - 60))
    assert wl.load_local(p, "anpr", "KA05VIS2") is None    # expired -> no match


def test_visitor_pass_not_yet_valid():
    p = _db(); now = time.time()
    with sqlite3.connect(p) as c:
        c.execute("INSERT INTO plate_passes_cache VALUES(?,?,?,?,?,?)",
                  ("KA05VIS3", "u1", "A-101", "Guest", now + 3600, now + 7200))
    assert wl.load_local(p, "anpr", "KA05VIS3") is None    # not yet valid
