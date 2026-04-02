"""Tests for UHF reader mock and hashing."""
import pytest, time
from edge.emulators.uhf_mock import UHFMock, tid_to_hash, TEST_TAGS


class TestTidHash:
    def test_hash_is_64_hex_chars(self):
        h = tid_to_hash("E200001234560001")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_is_deterministic(self):
        h1 = tid_to_hash("E200001234560001")
        h2 = tid_to_hash("E200001234560001")
        assert h1 == h2

    def test_different_tids_produce_different_hashes(self):
        h1 = tid_to_hash("E200001234560001")
        h2 = tid_to_hash("E200001234560002")
        assert h1 != h2


class TestUHFMock:
    def test_read_tag_calls_callback(self):
        events = []
        mock = UHFMock(on_tag_callback=lambda e: events.append(e))
        mock.read_tag("RESIDENT_301")
        assert len(events) == 1
        assert events[0]["tid_hash"] == tid_to_hash(TEST_TAGS["RESIDENT_301"]["tid"])
        assert events[0]["rssi"] == -35.0
        assert "timestamp" in events[0]

    def test_read_unknown_tag(self):
        events = []
        mock = UHFMock(on_tag_callback=lambda e: events.append(e))
        mock.read_tag("UNKNOWN")
        assert len(events) == 1
        assert events[0]["tid_hash"] == tid_to_hash(TEST_TAGS["UNKNOWN"]["tid"])

    def test_scenario_playback(self):
        events = []
        mock = UHFMock(on_tag_callback=lambda e: events.append(e))
        mock.run_scenario([
            {"tag": "RESIDENT_301", "delay": 0.1},
            {"tag": "VISITOR", "delay": 0.1},
        ], loop=False)
        time.sleep(0.5)
        assert len(events) == 2

    def test_all_test_tags_have_unique_hashes(self):
        hashes = set()
        for tag in TEST_TAGS.values():
            h = tid_to_hash(tag["tid"])
            assert h not in hashes, f"Duplicate hash for {tag['tid']}"
            hashes.add(h)
