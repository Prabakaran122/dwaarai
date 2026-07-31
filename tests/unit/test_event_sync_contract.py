"""Edge → cloud event-sync contract.

The edge posts offline events to POST /events/sync, which validates them with
zod. Nothing used to test that boundary — the offline-queue tests mock
`requests.post` to return 200 — so the two sides drifted apart badly enough
that EVERY sync was rejected with 400 and the queue never drained:

  * `event_ts` was posted as a float epoch; the schema requires ISO-8601 UTC.
  * `guard_review` / `alarm` / `alert` decisions weren't in the schema's enum.
  * biometric methods ('fingerprint') overflowed a VARCHAR(10) column.

These tests pin the payload the edge actually produces to a golden fixture,
`tests/fixtures/edge-event-sync.json`. Its companion,
`services/api-gateway/src/__tests__/event-sync-contract.test.js`, feeds the
SAME fixture to the real zod schema. Change what the edge emits and this test
fails; change the fixture to match and the JS test proves the cloud still
accepts it. Neither side can move alone.
"""
import json, re, time
from pathlib import Path
from unittest.mock import patch

import pytest

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "edge-event-sync.json"

# zod's `.datetime()` (no `offset` option) accepts ONLY UTC ending in `Z`.
ZOD_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")

VALID_DECISIONS = {"allow", "deny", "override", "guard_review", "alarm", "alert"}
COMMUNITY = "3f1c9a52-8d4e-4a7b-9c31-5e2f8b6d0a14"
GATE = "b7e2d148-6c93-4f05-8a1d-2e7c4b9f3a60"

# Events exactly as edge/gate_controller.py enqueues them — float epoch
# timestamps and all the extra keys the cloud schema ignores.
SOURCE_EVENTS = [
    # ANPR allow (gate_controller._handle_anpr_event)
    {"event_id": "0a11f6d2-1c4e-4b90-8f52-6d3a7e18c9b4",
     "community_id": COMMUNITY, "gate_id": GATE,
     "detection_method": "anpr", "raw_value": "KA05MF1234",
     "access_decision": "allow", "anpr_confidence": 0.93,
     "gate_opened": True, "auto_paired": False, "ambiguous_correlation": False,
     "pass_kind": "resident", "is_offline_event": False, "event_ts": 1785312000.5},
    # FASTag allow over the USB reader (gate_controller._handle_usb_fastag)
    {"event_id": "1b22a7e3-2d5f-4ca1-9063-7e4b8f29d0c5",
     "community_id": COMMUNITY, "gate_id": GATE,
     "detection_method": "fastag", "raw_value": "34161FA820328972305B75E0",
     "unit_number": "A-402", "access_decision": "allow", "gate_opened": True,
     "is_offline_event": True, "event_ts": 1785312061.0},
    # Unknown plate → guard review (a decision the schema used to reject)
    {"event_id": "2c33b8f4-3e60-4db2-a174-8f5c9038e1d6",
     "community_id": COMMUNITY, "gate_id": GATE,
     "detection_method": "anpr", "raw_value": "TN09XY7788",
     "access_decision": "guard_review", "deny_reason": "not_recognized",
     "anpr_confidence": 0.71, "is_offline_event": True, "event_ts": 1785312125.25},
    # Biometric person verify (SpeedFace-V5L) — 11-char detection_method
    {"event_id": "3d44c905-4f71-4ec3-b285-906da149f2e7",
     "community_id": COMMUNITY, "gate_id": GATE,
     "detection_method": "fingerprint", "raw_value": "1042", "user_id": "1042",
     "access_decision": "allow", "deny_reason": None,
     "is_offline_event": False, "event_ts": 1785312190.0},
    # Panel alarm surfaced by the C3 rtstate decoder
    {"event_id": "4e55da16-5082-4fd4-a396-a17eb25a03f8",
     "community_id": COMMUNITY, "gate_id": GATE,
     "detection_method": "panel", "raw_value": "door1",
     "access_decision": "alarm", "deny_reason": "alarm_1",
     "is_offline_event": False, "event_ts": 1785312245.75},
]


def _post_via_queue(tmp_path, events):
    """Enqueue through the real OfflineQueue and capture what it POSTs.

    `defaults` mirrors how gate_controller constructs the queue — an entry node
    stamps direction='entry' on everything it reports.
    """
    from edge.offline_queue import OfflineQueue
    oq = OfflineQueue(str(tmp_path / "q.db"), defaults={"direction": "entry"})
    for e in events:
        oq.enqueue(e)
    with patch("requests.post") as mp:
        mp.return_value.status_code = 200
        oq.sync("http://cloud/api/v1", "device-token", batch=100)
    assert mp.call_count == 1, "expected a single batched POST"
    return mp.call_args.kwargs["json"]


class TestEventSyncContract:
    def test_posted_payload_matches_golden_fixture(self, tmp_path):
        """The edge's real output == the fixture the cloud schema is tested against."""
        posted = _post_via_queue(tmp_path, SOURCE_EVENTS)
        expected = json.loads(FIXTURE.read_text())
        assert posted == expected, (
            "Edge sync payload drifted from tests/fixtures/edge-event-sync.json. "
            "Update the fixture, then confirm the api-gateway contract test still "
            "passes — the cloud schema may need widening too."
        )

    def test_event_ts_is_zod_datetime(self, tmp_path):
        """The bug that broke every sync: float epoch instead of ISO-8601 UTC."""
        posted = _post_via_queue(tmp_path, SOURCE_EVENTS)
        for evt in posted["events"]:
            ts = evt["event_ts"]
            assert isinstance(ts, str), f"event_ts must be a string, got {type(ts).__name__}"
            assert ZOD_DATETIME.match(ts), f"event_ts {ts!r} is not zod-.datetime() valid"

    def test_fixture_satisfies_cloud_field_limits(self):
        """Mirror of the zod/column limits, so Python alone catches most drift."""
        for evt in json.loads(FIXTURE.read_text())["events"]:
            assert evt["access_decision"] in VALID_DECISIONS, evt["access_decision"]
            assert evt.get("direction") in (None, "entry", "exit"), evt.get("direction")
            assert 1 <= len(evt["detection_method"]) <= 20, evt["detection_method"]
            assert len(evt.get("raw_value") or "") <= 100
            assert len(evt.get("deny_reason") or "") <= 100
            assert len(evt.get("matched_unit_number") or "") <= 30
            conf = evt.get("anpr_confidence")
            assert conf is None or 0 <= conf <= 1

    def test_direction_is_stamped_from_the_gate_default(self, tmp_path):
        """gate_events.direction existed since migration 008 but nothing set it,
        so every row read 'entry' and exits were invisible. The queue stamps it
        once, centrally, rather than relying on 12 call sites."""
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"), defaults={"direction": "exit"})
        oq.enqueue({"detection_method": "anpr", "event_ts": 1785312000.0})
        oq.enqueue({"detection_method": "anpr", "direction": "entry",   # caller wins
                    "event_ts": 1785312001.0})
        with patch("requests.post") as mp:
            mp.return_value.status_code = 200
            oq.sync("http://cloud/api/v1", "t")
        posted = mp.call_args.kwargs["json"]["events"]
        assert posted[0]["direction"] == "exit"
        assert posted[1]["direction"] == "entry"

    def test_enqueue_normalizes_float_epoch(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        oq.enqueue({"detection_method": "anpr", "event_ts": 1785312000.5})
        with patch("requests.post") as mp:
            mp.return_value.status_code = 200
            oq.sync("http://cloud/api/v1", "t")
        assert mp.call_args.kwargs["json"]["events"][0]["event_ts"] == "2026-07-29T08:00:00.500Z"

    def test_enqueue_defaults_missing_timestamp(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        oq.enqueue({"detection_method": "anpr"})       # no event_ts at all
        with patch("requests.post") as mp:
            mp.return_value.status_code = 200
            oq.sync("http://cloud/api/v1", "t")
        assert ZOD_DATETIME.match(mp.call_args.kwargs["json"]["events"][0]["event_ts"])

    def test_enqueue_passes_through_preformatted_string(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        oq.enqueue({"detection_method": "anpr", "event_ts": "2026-07-29T08:00:00.000Z"})
        with patch("requests.post") as mp:
            mp.return_value.status_code = 200
            oq.sync("http://cloud/api/v1", "t")
        assert mp.call_args.kwargs["json"]["events"][0]["event_ts"] == "2026-07-29T08:00:00.000Z"


class TestPoisonPill:
    """A permanently-rejected event must not hold the queue hostage."""

    def _queue(self, tmp_path, n):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        for i in range(n):
            oq.enqueue({"detection_method": "anpr", "raw_value": f"CAR{i}",
                        "event_ts": 1785312000.0 + i})
        return oq

    def test_rejected_batch_isolates_and_syncs_the_valid_events(self, tmp_path):
        oq = self._queue(tmp_path, 5)

        def fake_post(url, **kw):
            evts = kw["json"]["events"]
            bad = any(e["raw_value"] == "CAR2" for e in evts)
            return type("R", (), {"status_code": 400 if bad else 200, "text": "Validation error"})()

        with patch("requests.post", side_effect=fake_post):
            synced = oq.sync("http://cloud/api/v1", "t")
        # The batch fails, then each event is retried alone: 4 good ones land.
        assert synced == 4
        assert oq.pending_count() == 1

    def test_repeated_rejection_quarantines_and_unblocks(self, tmp_path):
        oq = self._queue(tmp_path, 1)
        resp = type("R", (), {"status_code": 400, "text": "Validation error"})()
        with patch("requests.post", return_value=resp):
            for _ in range(3):
                assert oq.sync("http://cloud/api/v1", "t") == 0
        assert oq.pending_count() == 0        # no longer blocks the head of the queue
        assert oq.quarantined_count() == 1    # but kept on disk for inspection

    @pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
    def test_transient_failures_never_quarantine(self, tmp_path, status):
        """A rotated token or a cloud outage must not destroy queued events."""
        oq = self._queue(tmp_path, 3)
        resp = type("R", (), {"status_code": status, "text": "nope"})()
        with patch("requests.post", return_value=resp):
            for _ in range(5):
                assert oq.sync("http://cloud/api/v1", "t") == 0
        assert oq.pending_count() == 3
        assert oq.quarantined_count() == 0

    def test_legacy_queue_db_without_attempts_column_is_migrated(self, tmp_path):
        import sqlite3
        path = str(tmp_path / "legacy.db")
        with sqlite3.connect(path) as c:      # pre-attempts schema, as shipped
            c.execute("""CREATE TABLE pending_events (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL,
                created_at REAL NOT NULL, synced INTEGER DEFAULT 0)""")
            c.execute("INSERT INTO pending_events VALUES('old','{\"a\":1}',1.0,0)")
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(path)
        assert oq.pending_count() == 1
        with patch("requests.post") as mp:
            mp.return_value.status_code = 200
            assert oq.sync("http://cloud/api/v1", "t") == 1
