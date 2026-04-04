"""ZKTeco C3-100 controller wrapper using pyzkaccess SDK.

Provides: card sync, event polling, remote door unlock.
All communication over TCP/IP to the C3's Ethernet port.

Install: pip install pyzkaccess
"""
import time, logging
log = logging.getLogger("c3_controller")

try:
    from pyzkaccess import ZKAccess
    _HAS_SDK = True
except ImportError:
    _HAS_SDK = False
    log.warning("pyzkaccess not installed — C3 controller unavailable. Install: pip install pyzkaccess")


class C3Controller:
    """Wrapper around pyzkaccess for ZKTeco C3-100 Plus."""

    def __init__(self, ip: str = "192.168.1.201", port: int = 4370,
                 serial_number: str = "", door_number: int = 1,
                 open_duration: int = 5):
        if not _HAS_SDK:
            raise ImportError("pyzkaccess required. Install: pip install pyzkaccess")
        self.ip = ip
        self.port = port
        self.serial_number = serial_number
        self.door_number = door_number
        self.open_duration = open_duration
        self._zk: ZKAccess | None = None
        self._last_event_index = 0

    def connect(self) -> bool:
        try:
            connstr = f"protocol=TCP,ipaddress={self.ip},port={self.port}"
            self._zk = ZKAccess(connstr=connstr)
            log.info(f"C3 connected: {self.ip}:{self.port}")
            return True
        except Exception as e:
            log.error(f"C3 connect failed: {e}")
            self._zk = None
            return False

    def disconnect(self):
        if self._zk:
            try:
                self._zk = None
            except Exception:
                pass
        log.info("C3 disconnected")

    def is_connected(self) -> bool:
        return self._zk is not None

    def sync_cards(self, cards: list[str]) -> int:
        """Replace all cards on the C3 with the given list."""
        if not self._zk:
            return 0
        try:
            self._zk.table("user").clear()
            for card in cards:
                self._zk.table("user").upsert([{
                    "CardNo": card,
                    "Pin": card[:10],
                    "Doors": str(self.door_number),
                }])
            log.info(f"C3 synced {len(cards)} cards")
            return len(cards)
        except Exception as e:
            log.error(f"C3 card sync failed: {e}")
            return 0

    def clear_cards(self) -> bool:
        if not self._zk:
            return False
        try:
            self._zk.table("user").clear()
            return True
        except Exception as e:
            log.error(f"C3 clear cards failed: {e}")
            return False

    def add_card(self, card_number: str) -> bool:
        if not self._zk:
            return False
        try:
            self._zk.table("user").upsert([{
                "CardNo": card_number,
                "Pin": card_number[:10],
                "Doors": str(self.door_number),
            }])
            log.info(f"C3 added card {card_number[:12]}...")
            return True
        except Exception as e:
            log.error(f"C3 add card failed: {e}")
            return False

    def remove_card(self, card_number: str) -> bool:
        if not self._zk:
            return False
        try:
            self._zk.table("user").delete(CardNo=card_number)
            return True
        except Exception as e:
            log.error(f"C3 remove card failed: {e}")
            return False

    def block_card(self, card_number: str) -> bool:
        """Remove the card so C3 denies it."""
        return self.remove_card(card_number)

    def poll_events(self) -> list[dict]:
        """Get new card events since last poll."""
        if not self._zk:
            return []
        try:
            raw_events = self._zk.table("transaction").select()
            new_events = []
            for evt in raw_events[self._last_event_index:]:
                new_events.append({
                    "card_number": evt.get("CardNo", ""),
                    "event_type": "allow" if evt.get("Verified") else "deny",
                    "door": int(evt.get("Door", self.door_number)),
                    "timestamp": evt.get("TimeStamp", time.strftime("%Y-%m-%dT%H:%M:%S")),
                })
            self._last_event_index = len(raw_events)
            return new_events
        except Exception as e:
            log.error(f"C3 poll events failed: {e}")
            return []

    def open_door(self) -> bool:
        """Remote unlock: trigger relay for configured duration."""
        if not self._zk:
            return False
        try:
            self._zk.door(self.door_number).open(self.open_duration)
            log.info(f"C3 door {self.door_number} opened ({self.open_duration}s)")
            return True
        except Exception as e:
            log.error(f"C3 open door failed: {e}")
            return False

    def get_status(self) -> dict:
        return {
            "connected": self.is_connected(),
            "ip": self.ip,
            "door_number": self.door_number,
        }
