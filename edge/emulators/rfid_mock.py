"""Simulates MFRC522 card reader. Modes: interactive, scenario, random."""
import threading, time, hashlib, logging, random
log = logging.getLogger("rfid_mock")

# Matches seed_db.sql test data
TEST_CARDS = {
    "RESIDENT_301":  {"uid": 10010001, "desc": "Priya Sharma — Flat 301"},
    "RESIDENT_205":  {"uid": 10020002, "desc": "Rajan Kumar — Flat 205"},
    "RESIDENT_BIKE": {"uid": 10030003, "desc": "Anil Nair — Bike KA05EB2345"},
    "VISITOR_TEMP":  {"uid": 20010001, "desc": "Visitor temp card (valid pass)"},
    "STAFF_MAID":    {"uid": 30010001, "desc": "Kavitha — staff card"},
    "BLACKLISTED":   {"uid": 99990001, "desc": "Blacklisted card"},
    "UNKNOWN":       {"uid": 88880001, "desc": "Unknown card"},
}

def _hash(uid: int) -> str:
    return hashlib.sha256(str(uid).encode()).hexdigest()[:64]

class RFIDMock:
    def __init__(self, on_tap_callback):
        self.cb = on_tap_callback
        self._running = False

    def tap(self, key: str = "RESIDENT_301"):
        card = TEST_CARDS.get(key, TEST_CARDS["RESIDENT_301"])
        event = {"uid_hash": _hash(card["uid"]), "raw_uid": card["uid"],
                 "desc": card["desc"], "timestamp": time.time()}
        log.info(f"[RFID MOCK] Tap: {card['desc']}")
        self.cb(event)

    def run_interactive(self):
        print("[RFID MOCK] Cards:", list(TEST_CARDS))
        while True:
            k = input("tap> ").strip() or "RESIDENT_301"
            self.tap(k)

    def run_scenario(self, steps: list[dict], loop=False):
        """steps = [{"card": "RESIDENT_301", "delay": 5.0}, ...]"""
        def _go():
            while True:
                for s in steps:
                    time.sleep(s.get("delay", 3.0))
                    self.tap(s.get("card", "RESIDENT_301"))
                if not loop: break
        threading.Thread(target=_go, daemon=True).start()

    def run_random(self, interval=8.0, pool=None):
        pool = pool or list(TEST_CARDS)
        self._running = True
        def _go():
            while self._running:
                self.tap(random.choice(pool))
                time.sleep(interval)
        threading.Thread(target=_go, daemon=True).start()

    def stop(self): self._running = False
