"""Tests for pre-pilot hardening fixes on the real (non-mock) edge hardware paths.

Covers:
- C3 door-open duration is sent in SECONDS (clamped 1-254), not milliseconds.
- C3 marks itself disconnected when a device op fails (so the poll loop reconnects).
- C3 card-write methods degrade gracefully (zkaccess-c3 can't write the user table).
- ANPR receiver uses a threaded HTTP server.
- OfflineQueue creates its parent directory (persistent /var/lib path).
"""
import pytest
import edge.c3_controller as c3mod
from edge.c3_controller import C3Controller


class _FakeControl:
    def __init__(self, output_number=None, address=None, duration=None):
        self.output_number = output_number
        self.address = address
        self.duration = duration


class _FakePanel:
    def __init__(self):
        self.controls = []
        self.fail_control = False

    def control_device(self, cmd):
        if self.fail_control:
            raise RuntimeError("link down")
        self.controls.append(cmd)

    def get_rt_log(self):
        raise RuntimeError("link down")


@pytest.fixture
def sdk(monkeypatch):
    # Pretend the SDK is available and capture ControlDeviceOutput args.
    monkeypatch.setattr(c3mod, "_HAS_SDK", True)
    monkeypatch.setattr(c3mod, "ControlDeviceOutput", _FakeControl, raising=False)


def _controller(open_duration=5):
    c = C3Controller(open_duration=open_duration)
    c._panel = _FakePanel()
    c._connected = True
    return c


class TestDoorDuration:
    def test_duration_is_seconds_not_milliseconds(self, sdk):
        c = _controller(open_duration=5)
        assert c.open_door() is True
        cmd = c._panel.controls[-1]
        assert cmd.duration == 5      # regression guard: must NOT be 5000
        assert cmd.address == 1       # door output, not auxiliary

    def test_duration_clamped_to_max_254(self, sdk):
        c = _controller(open_duration=9999)
        assert c.open_door()
        assert c._panel.controls[-1].duration == 254

    def test_duration_floored_to_min_1(self, sdk):
        c = _controller(open_duration=0)
        assert c.open_door()
        assert c._panel.controls[-1].duration == 1


class TestConnectionDropDetection:
    def test_open_failure_marks_disconnected(self, sdk):
        c = _controller()
        c._panel.fail_control = True
        assert c.open_door() is False
        assert c.is_connected() is False

    def test_poll_failure_marks_disconnected(self, sdk):
        c = _controller()
        assert c.poll_events() == []
        assert c.is_connected() is False


class TestCardWritesDegrade:
    """zkaccess-c3 can't write the user table — writes must no-op, not raise."""

    def test_writes_noop_without_raising(self, sdk):
        c = _controller()
        assert c.sync_cards(["a", "b"]) == 0
        assert c.add_card("x") is False
        assert c.clear_cards() is False
        assert c.remove_card("x") is False
        assert c.block_card("x") is False


class TestAnprThreadedServer:
    def test_uses_threading_http_server(self):
        from http.server import ThreadingHTTPServer
        from edge.anpr_receiver import ANPRReceiver
        r = ANPRReceiver(port=0, on_plate_callback=lambda p, c: None)
        r.start()
        try:
            assert isinstance(r._server, ThreadingHTTPServer)
        finally:
            r.stop()


class TestOfflineQueuePersistentDir:
    def test_creates_missing_parent_dir(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        nested = tmp_path / "var" / "lib" / "communitygate" / "event_queue.db"
        oq = OfflineQueue(str(nested))
        assert nested.parent.exists()
        oq.enqueue({"raw_value": "KA01AB1234"})
        assert oq.pending_count() == 1
