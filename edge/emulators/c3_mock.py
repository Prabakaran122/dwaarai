"""Mock ZKTeco C3-100 controller for development/testing."""
import time, logging, threading
log = logging.getLogger("c3_mock")


class C3Mock:
    """In-memory simulation of C3-100. Same interface as C3Controller."""

    def __init__(self, ip="127.0.0.1", port=4370, serial_number="",
                 door_number=1, open_duration=5):
        self.ip = ip
        self.port = port
        self.serial_number = serial_number
        self.door_number = door_number
        self.open_duration = open_duration
        self._cards: set[str] = set()
        self._blocked: set[str] = set()
        self._events: list[dict] = []
        self._poll_cursor = 0
        self._connected = False
        self._door_open = False
        self._scenario_thread = None

    def connect(self) -> bool:
        self._connected = True
        log.info(f"[C3 MOCK] Connected to {self.ip}:{self.port}")
        return True

    def disconnect(self):
        self._connected = False
        log.info("[C3 MOCK] Disconnected")

    def is_connected(self) -> bool:
        return self._connected

    def sync_cards(self, cards: list[str]) -> int:
        self._cards = set(cards)
        log.info(f"[C3 MOCK] Synced {len(cards)} cards")
        return len(cards)

    def clear_cards(self) -> bool:
        self._cards.clear()
        return True

    def add_card(self, card_number: str) -> bool:
        self._cards.add(card_number)
        log.info(f"[C3 MOCK] Added card {card_number[:12]}...")
        return True

    def remove_card(self, card_number: str) -> bool:
        self._cards.discard(card_number)
        return True

    def block_card(self, card_number: str) -> bool:
        self._blocked.add(card_number)
        return True

    def poll_events(self) -> list[dict]:
        new_events = self._events[self._poll_cursor:]
        self._poll_cursor = len(self._events)
        return new_events

    def open_door(self) -> bool:
        self._door_open = True
        log.info(f"[C3 MOCK] Door {self.door_number} OPENED ({self.open_duration}s)")
        def _close():
            time.sleep(self.open_duration)
            self._door_open = False
            log.info(f"[C3 MOCK] Door {self.door_number} CLOSED")
        threading.Thread(target=_close, daemon=True).start()
        return True

    def get_status(self) -> dict:
        return {
            "connected": self._connected,
            "ip": self.ip,
            "card_count": len(self._cards),
            "blocked_count": len(self._blocked),
            "door_open": self._door_open,
        }

    def simulate_card_tap(self, card_number: str):
        """Simulate a card being tapped on the Wiegand reader."""
        if card_number in self._blocked:
            event_type = "deny"
        elif card_number in self._cards:
            event_type = "allow"
            self.open_door()
        else:
            event_type = "deny"
        self._events.append({
            "card_number": card_number,
            "event_type": event_type,
            "door": self.door_number,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
        log.info(f"[C3 MOCK] Card tap: {card_number[:12]}... → {event_type}")

    def run_scenario(self, steps: list[dict], loop=False):
        """steps = [{"card": "abc123...", "delay": 5.0}, ...]"""
        def _go():
            while True:
                for s in steps:
                    time.sleep(s.get("delay", 3.0))
                    self.simulate_card_tap(s["card"])
                if not loop:
                    break
        self._scenario_thread = threading.Thread(target=_go, daemon=True)
        self._scenario_thread.start()
