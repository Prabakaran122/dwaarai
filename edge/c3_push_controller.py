"""ZKTeco C3 controller — **Push protocol** implementation.

Drop-in replacement for `edge.c3_controller.C3Controller` and `C3Mock`: it
exposes the identical interface (connect / is_connected / sync_cards / add_card
/ remove_card / block_card / poll_events / open_door / get_status) so
`gate_controller.py` and `whitelist_sync.py` need no changes.

The difference is under the hood. Instead of opening TCP:4370 to the panel and
polling (PULL), it runs a `C3PushServer` that the panel dials into (PUSH):
    - writes (sync_cards/add_card/…) ENQUEUE commands the panel pulls → this is
      the capability the PULL library lacked, so card provisioning now works.
    - poll_events() drains the buffer the panel POSTs its taps into.
    - is_connected() reflects whether the panel has checked in recently.

Selected in gate_controller via USE_C3_MOCK/USE_C3_PUSH the same way the other
impls are — see edge/config.py.
"""
import time, logging
from edge.c3_push_server import (
    C3PushServer, format_control_cmd, format_user_cmd, format_user_delete_cmd,
    format_timezone_cmd, format_userauthorize_cmd, format_holiday_cmd,
    format_firstcard_cmd, format_normal_open_cmd, format_restore_cmd,
)

log = logging.getLogger("c3_push_controller")


class C3PushController:
    """Push-protocol C3 controller. Same interface as C3Controller/C3Mock.

    Args mirror C3Controller for drop-in construction. `ip`/`port` are the
    panel's address (informational in push mode — the panel initiates), while
    `listen_host`/`listen_port` are where THIS server binds for the panel to
    reach. Card writes are enqueued as commands the panel pulls.
    """

    def __init__(self, ip: str = "192.168.1.201", port: int = 4370,
                 serial_number: str = "", door_number: int = 1,
                 open_duration: int = 5,
                 listen_host: str = "0.0.0.0", listen_port: int = 8080,
                 sync_chunk: int = 50, sync_pause: float = 1.5):
        self.ip = ip
        self.port = port
        self.serial_number = serial_number
        self.door_number = door_number
        self.open_duration = open_duration
        # Bulk-sync throttle: enqueue at most `sync_chunk` cards, let the panel
        # drain them, then pause `sync_pause`s before the next chunk. Real-device
        # testing showed a sustained write-storm can hang the panel; pacing (which
        # we verified stays healthy) prevents that on large roster syncs.
        self.sync_chunk = max(1, sync_chunk)
        self.sync_pause = max(0.0, sync_pause)
        self._server = C3PushServer(listen_host=listen_host,
                                    listen_port=listen_port,
                                    serial_number=serial_number)
        self._started = False

    def connect(self) -> bool:
        """Start the push server. Unlike PULL 'connect', this does not reach the
        panel — the panel connects to us. Returns True once we are listening."""
        try:
            if not self._started:
                self._server.start()
                self._started = True
            log.info(f"C3 push server up on port {self._server.listen_port} "
                     f"(awaiting panel SN={self.serial_number or 'any'})")
            return True
        except Exception as e:
            log.error(f"C3 push server failed to start: {e}")
            return False

    def disconnect(self):
        if self._started:
            self._server.stop()
            self._started = False
        log.info("C3 push server shut down")

    def is_connected(self) -> bool:
        """Server up AND the panel has checked in within DEVICE_TIMEOUT."""
        return self._started and self._server.device_online(self.serial_number)

    def seconds_since_contact(self) -> float:
        """Seconds since the panel last reached us (inf if never / not started).
        Used by the gate loop to alert when the panel has gone silent too long."""
        if not self._started:
            return float("inf")
        return self._server.seconds_since_seen(self.serial_number)

    def panel_state(self) -> dict:
        """Latest decoded door/relay/alarm/sensor state — for a health heartbeat."""
        if not self._started:
            return {}
        return self._server.panel_state(self.serial_number)

    # ── card table writes (now actually supported, unlike PULL) ───────
    def sync_cards(self, cards: list[str]) -> int:
        """Push the full card set to the panel, THROTTLED. One UPDATE per card,
        enqueued in chunks that are allowed to drain (with a pause between) so a
        large roster can't overwhelm the panel's flash and hang it."""
        if not self._started:
            log.warning("C3 sync_cards skipped: push server not started")
            return 0
        n = len(cards)
        for i in range(0, n, self.sync_chunk):
            for card in cards[i:i + self.sync_chunk]:
                self._send(lambda cid, c=card: format_user_cmd(cid, c))
            if i + self.sync_chunk < n:          # more chunks to come — pace it
                self._drain(timeout=self.sync_chunk * 2)
                time.sleep(self.sync_pause)
        log.info(f"C3 synced {n} card(s) to the panel "
                 f"(chunk={self.sync_chunk}, pause={self.sync_pause}s)")
        return n

    def _drain(self, threshold: int = 5, timeout: float = 120.0):
        """Wait until the command queue has mostly drained (the panel has caught
        up) before enqueuing more — bounds sustained load during a big sync."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self._server.queue_depth(self.serial_number) <= threshold:
                return
            time.sleep(0.2)

    def clear_cards(self) -> bool:
        # A full clear requires enumerating the panel table; in practice we
        # reconcile by re-syncing the desired set. Report unsupported rather
        # than silently succeed.
        log.info("C3 clear_cards: reconcile via sync_cards(desired_set) in push mode")
        return False

    def add_card(self, card_number: str, valid_from="0", valid_until="0", name="") -> bool:
        """Add/update a card. valid_from/valid_until (YYYYMMDD or datetime, 0 =
        none) make it a time-limited pass — visitor or staff-hours access,
        enforced locally on the panel."""
        if not self._started:
            return False
        self._send(lambda cid: format_user_cmd(cid, card_number, valid_from=valid_from,
                                               valid_until=valid_until, name=name))
        window = f" [{valid_from}..{valid_until}]" if str(valid_from) != "0" else ""
        log.info(f"C3 queued add_card {card_number[:12]}...{window}")
        return True

    # ── access model (staff hours, visitor windows, holidays, first-card) ─
    def set_timezone(self, tz_id: int, seg1="0000", seg2="2359") -> bool:
        """Define an allowed-time window (e.g. staff shift 09:00–18:00)."""
        if not self._started:
            return False
        self._send(lambda cid: format_timezone_cmd(cid, tz_id, seg1, seg2))
        return True

    def set_access_level(self, pin: str, tz_id: int = 1, door: int = 1) -> bool:
        """Grant a user access to a door within a time zone."""
        if not self._started:
            return False
        self._send(lambda cid: format_userauthorize_cmd(cid, pin, tz_id, door))
        return True

    def set_holiday(self, uid: int, date_yyyymmdd: str, htype: int = 1) -> bool:
        if not self._started:
            return False
        self._send(lambda cid: format_holiday_cmd(cid, uid, date_yyyymmdd, htype))
        return True

    def set_first_card(self, pin: str, door: int = 1, tz_id: int = 1) -> bool:
        if not self._started:
            return False
        self._send(lambda cid: format_firstcard_cmd(cid, pin, door, tz_id))
        return True

    # ── emergency / scheduled modes (evacuation open, lockdown, rush-hour) ─
    def hold_open(self, door: int = None) -> bool:
        """Hold a door (or all doors) normally-open — evacuation / rush-hour."""
        if not self._started:
            return False
        for d in ([door] if door else [1, 2]):
            self._send(lambda cid, dd=d: format_normal_open_cmd(cid, dd))
        log.warning(f"C3 HOLD-OPEN door(s) {'all' if not door else door}")
        return True

    def restore_door(self, door: int = None) -> bool:
        """End normally-open / lockdown — return door(s) to controlled mode."""
        if not self._started:
            return False
        for d in ([door] if door else [1, 2]):
            self._send(lambda cid, dd=d: format_restore_cmd(cid, dd))
        log.warning(f"C3 RESTORE door(s) {'all' if not door else door}")
        return True

    def remove_card(self, card_number: str) -> bool:
        if not self._started:
            return False
        self._send(lambda cid: format_user_delete_cmd(cid, card_number))
        log.info(f"C3 queued remove_card {card_number[:12]}...")
        return True

    def block_card(self, card_number: str) -> bool:
        """Block = remove from the panel's allow table so it stops opening."""
        return self.remove_card(card_number)

    # ── events ────────────────────────────────────────────────────────
    def poll_events(self) -> list[dict]:
        if not self._started:
            return []
        return self._server.drain_events()

    # ── remote unlock ─────────────────────────────────────────────────
    def open_door(self) -> bool:
        if not self._started:
            return False
        # duration is a single byte on the panel (1-254s); clamp like the PULL path.
        duration_s = max(1, min(254, int(self.open_duration)))
        self._send(lambda cid: format_control_cmd(cid, self.door_number, duration_s))
        log.info(f"C3 queued open door {self.door_number} ({duration_s}s)")
        return True

    def get_status(self) -> dict:
        st = self._server.status(self.serial_number)
        st.update({"ip": self.ip, "door_number": self.door_number,
                   "connected": self.is_connected()})
        return st

    # ── helper ────────────────────────────────────────────────────────
    def _send(self, make_cmd) -> int:
        """Mint one command id, format the wire line with it, and queue it so
        the panel's ack (keyed by that id) correlates back to this command."""
        cid = self._server.next_cmd_id()
        self._server.enqueue_command(cid, make_cmd(cid), self.serial_number)
        return cid
