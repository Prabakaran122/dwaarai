"""End-to-end tests for the C3 **Push protocol** path (no hardware).

Wires a real C3PushController (which starts the HTTP push server) to a
C3PushDeviceMock (which dials in like the real panel would), and asserts the
full loop: card writes reach the panel, taps surface as events, remote unlock
is delivered. This is the capability the PULL library could not provide.
"""
import time
import pytest

from edge.c3_push_controller import C3PushController
from edge.emulators.c3_push_device_mock import C3PushDeviceMock

SN = "MOCKSN01"


def wait_until(pred, timeout=3.0, interval=0.02):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return True
        time.sleep(interval)
    return pred()


@pytest.fixture
def rig():
    """A started controller (server on an ephemeral local port) + a panel mock
    dialed into it. Torn down after each test."""
    ctrl = C3PushController(serial_number=SN, door_number=1, open_duration=5,
                            listen_host="127.0.0.1", listen_port=0)
    assert ctrl.connect()
    port = ctrl._server.listen_port
    device = C3PushDeviceMock(f"http://127.0.0.1:{port}", serial_number=SN,
                              poll_interval=0.02)
    device.start()
    # Panel must be seen as online once it handshakes.
    assert wait_until(ctrl.is_connected), "panel never came online"
    try:
        yield ctrl, device
    finally:
        device.stop()
        ctrl.disconnect()


class TestConnection:
    def test_offline_until_panel_checks_in(self):
        ctrl = C3PushController(serial_number=SN, listen_host="127.0.0.1", listen_port=0)
        assert ctrl.connect()
        # Server is up but no panel has dialed in yet.
        assert ctrl.is_connected() is False
        ctrl.disconnect()

    def test_online_after_handshake(self, rig):
        ctrl, _ = rig
        assert ctrl.is_connected() is True
        st = ctrl.get_status()
        assert st["device_online"] is True
        assert st["running"] is True


class TestCardWrites:
    def test_sync_cards_reaches_panel(self, rig):
        ctrl, device = rig
        n = ctrl.sync_cards(["card_a", "card_b", "card_c"])
        assert n == 3
        assert wait_until(lambda: device.users == {"card_a", "card_b", "card_c"})

    def test_add_and_remove_card(self, rig):
        ctrl, device = rig
        ctrl.add_card("card_x")
        assert wait_until(lambda: "card_x" in device.users)
        ctrl.remove_card("card_x")
        assert wait_until(lambda: "card_x" not in device.users)

    def test_block_card_removes_from_panel(self, rig):
        ctrl, device = rig
        ctrl.add_card("bad")
        assert wait_until(lambda: "bad" in device.users)
        ctrl.block_card("bad")
        assert wait_until(lambda: "bad" not in device.users)

    def test_throttled_bulk_sync_delivers_every_card(self):
        # A multi-chunk sync (14 cards / chunk 4 = 4 chunks, paced) must still
        # land every card — the throttle bounds load without dropping writes.
        ctrl = C3PushController(serial_number=SN, listen_host="127.0.0.1",
                                listen_port=0, sync_chunk=4, sync_pause=0.02)
        assert ctrl.connect()
        port = ctrl._server.listen_port
        device = C3PushDeviceMock(f"http://127.0.0.1:{port}", serial_number=SN,
                                  poll_interval=0.02)
        device.start()
        try:
            assert wait_until(ctrl.is_connected)
            cards = [f"c{i}" for i in range(14)]
            assert ctrl.sync_cards(cards) == 14
            assert wait_until(lambda: device.users == set(cards), timeout=6)
        finally:
            device.stop(); ctrl.disconnect()


class TestEvents:
    def test_known_card_tap_surfaces_allow(self, rig):
        ctrl, device = rig
        ctrl.add_card("known")
        assert wait_until(lambda: "known" in device.users)
        device.simulate_card_tap("known")
        got = {}
        def _seen():
            for e in ctrl.poll_events():
                got.update(e)
            return got.get("card_number") == "known"
        assert wait_until(_seen)
        assert got["event_type"] == "allow"

    def test_unknown_card_tap_surfaces_deny(self, rig):
        ctrl, device = rig
        device.simulate_card_tap("stranger")
        events = []
        def _seen():
            events.extend(ctrl.poll_events())
            return any(e["card_number"] == "stranger" for e in events)
        assert wait_until(_seen)
        deny = [e for e in events if e["card_number"] == "stranger"][0]
        assert deny["event_type"] == "deny"

    def test_poll_drains_only_new_events(self, rig):
        ctrl, device = rig
        device.simulate_card_tap("c1")
        # Collect across polls until c1 arrives (poll_events drains as it reads).
        seen = []
        def _collect():
            seen.extend(ctrl.poll_events())
            return any(e["card_number"] == "c1" for e in seen)
        assert wait_until(_collect)
        # c1 was drained by the poll that saw it; with no new taps the next
        # poll returns nothing (events are not redelivered).
        assert ctrl.poll_events() == []


class TestRemoteUnlock:
    def test_open_door_delivered_to_panel(self, rig):
        ctrl, device = rig
        before = len(device.door_open_events)
        assert ctrl.open_door() is True
        assert wait_until(lambda: len(device.door_open_events) > before)
        assert device.door_open_events[-1] == 5

    def test_open_duration_clamped(self, rig):
        ctrl, device = rig
        ctrl.open_duration = 9999  # would overflow the panel's single duration byte
        before = len(device.door_open_events)
        ctrl.open_door()
        assert wait_until(lambda: len(device.door_open_events) > before)
        assert device.door_open_events[-1] == 254


class TestAccessModelAndEmergency:
    def test_time_limited_card_reaches_panel(self, rig):
        ctrl, device = rig
        ctrl.add_card("visitor77", valid_from="20260101", valid_until="20260201")
        assert wait_until(lambda: "visitor77" in device.users)

    def test_hold_open_holds_both_doors(self, rig):
        ctrl, device = rig
        before = len(device.door_open_events)
        assert ctrl.hold_open() is True          # no door arg -> both doors
        assert wait_until(lambda: len(device.door_open_events) >= before + 2)

    def test_access_level_and_timezone_accepted(self, rig):
        ctrl, device = rig
        # mock acks any command; assert they don't error and the panel stays online
        assert ctrl.set_timezone(2, "0900", "1800") is True
        assert ctrl.set_access_level("visitor77", tz_id=2, door=1) is True
        assert wait_until(ctrl.is_connected)
