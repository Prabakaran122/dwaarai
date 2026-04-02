"""Simulates UHF RFID reader for FASTag. Modes: scenario, random, inventory."""
import threading, time, hashlib, logging, random
log = logging.getLogger("uhf_mock")

# Test FASTag TIDs — matches seed data
TEST_TAGS = {
    "RESIDENT_301":  {"tid": "E200001234560001", "desc": "Priya Sharma — Flat 301"},
    "RESIDENT_205":  {"tid": "E200001234560002", "desc": "Rajan Kumar — Flat 205"},
    "RESIDENT_BIKE": {"tid": "E200001234560003", "desc": "Anil Nair — Bike"},
    "VISITOR":       {"tid": "E200009999990001", "desc": "Visitor — no registration"},
    "UNKNOWN":       {"tid": "E200008888880001", "desc": "Unknown vehicle"},
}

def tid_to_hash(tid: str) -> str:
    """SHA-256 hash of TID string, 64 hex chars."""
    return hashlib.sha256(tid.encode()).hexdigest()

class UHFMock:
    def __init__(self, on_tag_callback):
        self.cb = on_tag_callback
        self._running = False

    def read_tag(self, key: str = "RESIDENT_301"):
        tag = TEST_TAGS.get(key, TEST_TAGS["UNKNOWN"])
        event = {
            "tid_hash": tid_to_hash(tag["tid"]),
            "rssi": -35.0,
            "timestamp": time.time(),
        }
        log.info(f"[UHF MOCK] Tag: {tag['desc']}")
        self.cb(event)

    def run_scenario(self, steps: list[dict], loop=False):
        """steps = [{"tag": "RESIDENT_301", "delay": 5.0}, ...]"""
        def _go():
            while True:
                for s in steps:
                    time.sleep(s.get("delay", 3.0))
                    self.read_tag(s.get("tag", "RESIDENT_301"))
                if not loop:
                    break
        threading.Thread(target=_go, daemon=True).start()

    def run_random(self, interval=8.0, pool=None):
        pool = pool or list(TEST_TAGS)
        self._running = True
        def _go():
            while self._running:
                self.read_tag(random.choice(pool))
                time.sleep(interval)
        threading.Thread(target=_go, daemon=True).start()

    def stop(self):
        self._running = False

    def start(self, on_detection=None):
        """Compatibility with gate_controller start pattern."""
        pass
