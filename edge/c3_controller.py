"""ZKTeco C3-100 controller wrapper using zkaccess-c3 (pure Python).

Provides: card sync, event polling, remote door unlock.
All communication over TCP/IP to the C3's Ethernet port.
Works on any OS — no DLL, no Wine, no Windows dependency.

Install: pip install zkaccess-c3
"""
import time, logging
log = logging.getLogger("c3_controller")

try:
    from c3 import C3, ControlDeviceOutput
    _HAS_SDK = True
except ImportError:
    _HAS_SDK = False
    log.warning("zkaccess-c3 not installed — C3 controller unavailable. Install: pip install zkaccess-c3")


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
        """Replace all cards on the C3 with the given list.

        Uses the C3 'user' table: clears existing, then adds each card
        with access to the configured door.
        """
        if not self._panel:
            return 0
        try:
            # Clear existing users
            try:
                self._panel.set_device_data("user", [])
            except Exception:
                log.warning("C3 clear users failed — may not be supported, continuing with add")

            # Add each card as a user record
            for i, card in enumerate(cards):
                try:
                    self._panel.set_device_data("user", [{
                        "CardNo": card,
                        "Pin": str(i + 1),
                        "Password": "",
                        "Group": "1",
                        "StartTime": "2000-01-01 00:00:00",
                        "EndTime": "2099-12-31 23:59:59",
                    }])
                except Exception as e:
                    log.warning(f"C3 add card {card[:12]}... failed: {e}")

            log.info(f"C3 synced {len(cards)} cards")
            return len(cards)
        except Exception as e:
            log.error(f"C3 card sync failed: {e}")
            return 0

    def clear_cards(self) -> bool:
        if not self._panel:
            return False
        try:
            self._panel.set_device_data("user", [])
            return True
        except Exception as e:
            log.error(f"C3 clear cards failed: {e}")
            return False

    def add_card(self, card_number: str) -> bool:
        if not self._panel:
            return False
        try:
            self._panel.set_device_data("user", [{
                "CardNo": card_number,
                "Pin": card_number[:10],
                "Password": "",
                "Group": "1",
                "StartTime": "2000-01-01 00:00:00",
                "EndTime": "2099-12-31 23:59:59",
            }])
            log.info(f"C3 added card {card_number[:12]}...")
            return True
        except Exception as e:
            log.error(f"C3 add card failed: {e}")
            return False

    def remove_card(self, card_number: str) -> bool:
        """Remove a card. Note: zkaccess-c3 may not support individual delete.
        Falls back to clearing and re-syncing if needed."""
        if not self._panel:
            return False
        try:
            # Try to get all users, filter out the card, re-sync
            users = self._panel.get_device_data("user", ["CardNo", "Pin"])
            remaining = [u for u in users if u.get("CardNo") != card_number]
            self._panel.set_device_data("user", [])
            for u in remaining:
                self._panel.set_device_data("user", [u])
            log.info(f"C3 removed card {card_number[:12]}...")
            return True
        except Exception as e:
            log.error(f"C3 remove card failed: {e}")
            return False

    def block_card(self, card_number: str) -> bool:
        """Remove the card so C3 denies it."""
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
            return []

    def open_door(self) -> bool:
        """Remote unlock: trigger relay for configured duration."""
        if not self._panel:
            return False
        try:
            duration_ms = self.open_duration * 1000
            self._panel.control_device(
                ControlDeviceOutput(
                    output_number=self.door_number,
                    address=0,
                    duration=duration_ms
                )
            )
            log.info(f"C3 door {self.door_number} opened ({self.open_duration}s)")
            return True
        except Exception as e:
            log.error(f"C3 open door failed: {e}")
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
