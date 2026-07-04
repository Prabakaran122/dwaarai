"""ANPR↔FASTag correlation: auto-pair only when the pairing is unambiguous.

Two cars tail-gating (2 tags) with one plate must NOT auto-pair (that would
bond the wrong tag↔plate into the roster) — it should still open for a known
resident plate but leave the tags pending.
"""
import os, tempfile, time
_tmp = tempfile.mkdtemp()
os.environ.update({
    "GATE_ID": "t", "COMMUNITY_ID": "t", "DEVICE_TOKEN": "t",
    "USE_C3_MOCK": "true", "GATE_TYPE": "entry",
    "OFFLINE_DB_PATH": os.path.join(_tmp, "wl.db"),
    "OFFLINE_QUEUE_PATH": os.path.join(_tmp, "q.db"),
})
import edge.gate_controller as gc


def _arm(monkeypatch, tags, plate_decision="allow"):
    monkeypatch.setattr(gc, "_online", True)
    monkeypatch.setattr(gc, "_open_gate", lambda: True)
    monkeypatch.setattr(gc, "is_blacklisted_local", lambda *a, **k: False)
    res = {"decision": plate_decision, "unit_number": "A1", "resident_name": "R"}
    monkeypatch.setattr(gc, "_cloud_check", lambda *a, **k: res)
    monkeypatch.setattr(gc, "_local_check", lambda *a, **k: res)
    monkeypatch.setattr(gc._oq, "enqueue", lambda e: None)
    paired = []
    monkeypatch.setattr(gc, "_try_auto_pair", lambda tid, plate: paired.append((tid, plate)))
    gc._pending_unknown.clear()
    now = time.time()
    for t in tags:
        gc._pending_unknown[t] = {"ts": now, "event": {}}
    return paired


def test_single_tag_auto_pairs(monkeypatch):
    paired = _arm(monkeypatch, ["TAG_A"])
    gc.handle_anpr_detection("KA05AB1234", 0.9)
    time.sleep(0.15)  # auto-pair runs in a daemon thread
    assert paired == [("TAG_A", "KA05AB1234")]
    assert "TAG_A" not in gc._pending_unknown        # consumed


def test_two_tags_open_but_do_not_pair(monkeypatch):
    paired = _arm(monkeypatch, ["TAG_A", "TAG_B"])
    gc.handle_anpr_detection("KA05AB1234", 0.9)
    time.sleep(0.15)
    assert paired == []                               # AMBIGUOUS → no auto-pair
    # both tags left pending (not wrongly consumed)
    assert "TAG_A" in gc._pending_unknown and "TAG_B" in gc._pending_unknown
