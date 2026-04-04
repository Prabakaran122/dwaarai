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
