"""ZKTeco C3-100 controller wrapper using zkaccess-c3 (pure Python).

Provides: card sync, event polling, remote door unlock.
All communication over TCP/IP to the C3's Ethernet port.
Works on any OS — no DLL, no Wine, no Windows dependency.

Install: pip install zkaccess-c3
"""
import time, logging
log = logging.getLogger("c3_controller")

try:
    from c3 import C3
    # ControlDeviceOutput moved between top-level and the controldevice submodule
    # across zkaccess-c3 versions — import defensively so either layout works.
    try:
        from c3 import ControlDeviceOutput
    except ImportError:
        from c3.controldevice import ControlDeviceOutput
    _HAS_SDK = True
except ImportError:
    _HAS_SDK = False
    log.warning("zkaccess-c3 not installed — C3 controller unavailable. Install: pip install zkaccess-c3")

# zkaccess-c3 (0.0.15) does NOT implement set_device_data/delete_device_data, so
# the C3 user/card table cannot be written from Python. Cards must be loaded onto
# the panel out-of-band (ZKAccess/ZKBio desktop software). The write methods below
# degrade gracefully instead of raising. See reference_app_distribution / hardware notes.
_WRITES_SUPPORTED = False


class C3Controller:
    """Wrapper around zkaccess-c3 for ZKTeco C3-100 Plus.

    Pure Python, cross-platform (Linux/Mac/Windows).
    Same interface as C3Mock for drop-in replacement.
    """

    def __init__(self, ip: str = "192.168.1.201", port: int = 4370,
                 serial_number: str = "", door_number: int = 1,
                 open_duration: int = 5):
        if not _HAS_SDK:
            raise ImportError("zkaccess-c3 required. Install: pip install zkaccess-c3")
        self.ip = ip
        self.port = port
        self.serial_number = serial_number
        self.door_number = door_number
        self.open_duration = open_duration
        self._panel: C3 | None = None
        self._connected = False
        self._known_event_count = 0

    def connect(self) -> bool:
        try:
            self._panel = C3(self.ip)
            result = self._panel.connect()
            if result:
                self._connected = True
                log.info(f"C3 connected: {self.ip}")
                return True
            else:
                log.error(f"C3 connect returned False: {self.ip}")
                self._panel = None
                return False
        except Exception as e:
            log.error(f"C3 connect failed: {e}")
            self._panel = None
            return False

    def disconnect(self):
        if self._panel:
            try:
                self._panel.disconnect()
            except Exception:
                pass
            self._panel = None
        self._connected = False
        log.info("C3 disconnected")

    def is_connected(self) -> bool:
        return self._connected and self._panel is not None

    def sync_cards(self, cards: list[str]) -> int:
        """Load the given cards onto the C3.

        NOTE: zkaccess-c3 (0.0.15) does not implement writing the 'user' table,
        so this cannot push cards to the panel. Cards must be provisioned via
        ZKAccess/ZKBio. This logs the gap once and no-ops rather than raising.
        """
        if not _WRITES_SUPPORTED:
            log.warning(
                "C3 sync_cards skipped: zkaccess-c3 cannot write the user table. "
                f"Load {len(cards)} card(s) onto the panel via ZKAccess/ZKBio software."
            )
            return 0
        return 0

    def clear_cards(self) -> bool:
        if not _WRITES_SUPPORTED:
            log.warning("C3 clear_cards skipped: zkaccess-c3 cannot write the user table.")
            return False
        return False

    def add_card(self, card_number: str) -> bool:
        if not _WRITES_SUPPORTED:
            log.warning(
                f"C3 add_card skipped ({card_number[:12]}...): zkaccess-c3 cannot write "
                "the user table. Provision via ZKAccess/ZKBio."
            )
            return False
        return False

    def remove_card(self, card_number: str) -> bool:
        if not _WRITES_SUPPORTED:
            log.warning(
                f"C3 remove_card skipped ({card_number[:12]}...): zkaccess-c3 cannot write "
                "the user table. Block via ZKAccess/ZKBio."
            )
            return False
        return False

    def block_card(self, card_number: str) -> bool:
        """Block a card. Not writable via zkaccess-c3 — handle via ZKAccess/ZKBio."""
        return self.remove_card(card_number)

    def poll_events(self) -> list[dict]:
        """Get new card events since last poll using RT log."""
        if not self._panel:
            return []
        try:
            raw_events = self._panel.get_rt_log()
            if not raw_events:
                return []

            new_events = []
            for evt in raw_events:
                # RT log entries have varying formats depending on firmware
                card = str(evt.get("CardNo", evt.get("Card", "")))
                if not card or card == "0":
                    continue  # Status event, not a card tap

                # Determine allow/deny from event type or verified field
                verified = evt.get("Verified", evt.get("InOutState", 0))
                event_type = "allow" if verified else "deny"

                new_events.append({
                    "card_number": card,
                    "event_type": event_type,
                    "door": int(evt.get("Door", self.door_number)),
                    "timestamp": evt.get("Time", time.strftime("%Y-%m-%dT%H:%M:%S")),
                })

            return new_events
        except Exception as e:
            log.error(f"C3 poll events failed: {e}")
            self._connected = False  # surface the drop so the poll loop reconnects
            return []

    def open_door(self) -> bool:
        """Remote unlock: trigger relay for configured duration."""
        if not self._panel:
            return False
        try:
            # C3 ControlDeviceOutput.duration is in SECONDS (0 = close, 1-254 =
            # seconds open, 255 = stay open). It is a single byte — passing
            # milliseconds (e.g. 5000) overflows and keeps the barrier up far too
            # long. Clamp to the valid 1-254s range.
            duration_s = max(1, min(254, int(self.open_duration)))
            self._panel.control_device(
                ControlDeviceOutput(
                    output_number=self.door_number,
                    address=1,  # 1 = door output (2 = auxiliary)
                    duration=duration_s
                )
            )
            log.info(f"C3 door {self.door_number} opened ({duration_s}s)")
            return True
        except Exception as e:
            log.error(f"C3 open door failed: {e}")
            self._connected = False  # surface the drop so the poll loop reconnects
            return False

    def get_status(self) -> dict:
        status = {
            "connected": self.is_connected(),
            "ip": self.ip,
            "door_number": self.door_number,
        }
        if self._panel and self._connected:
            try:
                params = self._panel.get_device_param(["~SerialNumber", "LockCount"])
                status["serial_number"] = params.get("~SerialNumber", "")
                status["lock_count"] = params.get("LockCount", 0)
            except Exception:
                pass
        return status
