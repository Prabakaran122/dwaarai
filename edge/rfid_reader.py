"""Real MFRC522 RFID reader via SPI on Raspberry Pi.

Hardware: RC522 module connected to RPi SPI0.
Wiring (default):
  SDA  → GPIO8 (CE0)
  SCK  → GPIO11 (SCLK)
  MOSI → GPIO10
  MISO → GPIO9
  RST  → GPIO25 (configurable via RFID_RESET_PIN)
  3.3V → Pin 1
  GND  → Pin 6

Install: pip install mfrc522
Enable SPI: sudo raspi-config → Interface Options → SPI → Enable
"""
import hashlib, time, logging
log = logging.getLogger("rfid_reader")

try:
    from mfrc522 import SimpleMFRC522
    _HAS_MFRC522 = True
except ImportError:
    _HAS_MFRC522 = False
    log.warning("mfrc522 package not installed — RFID reader unavailable")


def _uid_to_hash(uid: int) -> str:
    """SHA-256 hash of UID integer, matching the mock's hashing scheme."""
    return hashlib.sha256(str(uid).encode()).hexdigest()[:64]


class RFIDReader:
    def __init__(self, on_tap_callback, debounce: float = 3.0,
                 spi_bus: int = 0, reset_pin: int = 25):
        if not _HAS_MFRC522:
            raise ImportError(
                "mfrc522 package required. Install with: pip install mfrc522"
            )
        self.cb = on_tap_callback
        self.debounce = debounce
        self.reader = SimpleMFRC522()
        self._last_uid = None
        self._last_time = 0.0
        self._running = False
        log.info(f"Real RFID reader initialized (debounce={debounce}s)")

    def run(self):
        """Blocking SPI polling loop — runs in its own thread."""
        self._running = True
        log.info("RFID reader polling started")
        try:
            while self._running:
                try:
                    uid, _ = self.reader.read_no_block()
                    if uid is None:
                        time.sleep(0.1)
                        continue

                    now = time.time()
                    # Debounce: ignore same card within the debounce window
                    if uid == self._last_uid and (now - self._last_time) < self.debounce:
                        time.sleep(0.1)
                        continue

                    self._last_uid = uid
                    self._last_time = now
                    uid_hash = _uid_to_hash(uid)

                    log.info(f"Card detected: UID={uid} hash={uid_hash[:12]}...")
                    self.cb({
                        "uid_hash": uid_hash,
                        "raw_uid": uid,
                        "timestamp": now,
                    })

                except Exception as e:
                    log.error(f"RFID read error: {e}")
                    time.sleep(0.5)

                time.sleep(0.1)  # polling interval
        finally:
            self.reader.READER.MFRC522_Init()
            log.info("RFID reader stopped")

    def stop(self):
        self._running = False
