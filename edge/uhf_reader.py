"""UHF RFID reader for FASTag TID detection via serial/USB.

Supports readers with a serial command protocol (e.g., ThingMagic M6e Nano,
Chafon CF-RU5102). Reads all tags in range, filters by RSSI, hashes TID.

Install: pip install pyserial
"""
import hashlib, time, logging, threading
log = logging.getLogger("uhf_reader")

try:
    import serial
    _HAS_SERIAL = True
except ImportError:
    _HAS_SERIAL = False
    log.warning("pyserial not installed — UHF reader unavailable")


def tid_to_hash(tid: str) -> str:
    """SHA-256 hash of TID string, 64 hex chars."""
    return hashlib.sha256(tid.encode()).hexdigest()


class UHFReader:
    def __init__(self, on_tag_callback, port: str = "/dev/ttyUSB0",
                 baud: int = 115200, debounce: float = 8.0,
                 rssi_threshold: float = -60.0):
        if not _HAS_SERIAL:
            raise ImportError("pyserial required. Install with: pip install pyserial")
        self.cb = on_tag_callback
        self.port = port
        self.baud = baud
        self.debounce = debounce
        self.rssi_threshold = rssi_threshold
        self._last_tid = None
        self._last_time = 0.0
        self._running = False
        self._serial = None
        log.info(f"UHF reader initialized (port={port}, debounce={debounce}s, rssi>={rssi_threshold})")

    def _connect(self):
        self._serial = serial.Serial(self.port, self.baud, timeout=1.0)
        log.info(f"UHF serial connected: {self.port}")

    def _read_inventory(self) -> list[dict]:
        """Read tags from reader. Returns list of {tid, rssi}.

        This is a placeholder for the actual reader protocol.
        Real implementation depends on the specific UHF reader model.
        Override this method or replace with reader-specific protocol.
        """
        if self._serial and self._serial.in_waiting:
            raw = self._serial.readline().decode(errors="ignore").strip()
            if raw:
                parts = raw.split(",")
                if len(parts) >= 2:
                    try:
                        return [{"tid": parts[0].strip(), "rssi": float(parts[1].strip())}]
                    except ValueError:
                        pass
        return []

    def run(self):
        """Blocking polling loop — runs in its own thread."""
        self._running = True
        self._connect()
        log.info("UHF reader polling started")
        try:
            while self._running:
                try:
                    tags = self._read_inventory()
                    for tag in tags:
                        if tag["rssi"] < self.rssi_threshold:
                            continue

                        tid = tag["tid"]
                        now = time.time()

                        if tid == self._last_tid and (now - self._last_time) < self.debounce:
                            continue

                        self._last_tid = tid
                        self._last_time = now
                        tid_hash = tid_to_hash(tid)

                        log.info(f"FASTag detected: TID={tid[:12]}... RSSI={tag['rssi']} hash={tid_hash[:12]}...")
                        self.cb({
                            "tid_hash": tid_hash,
                            "rssi": tag["rssi"],
                            "timestamp": now,
                        })
                except Exception as e:
                    log.error(f"UHF read error: {e}")
                    time.sleep(0.5)

                time.sleep(0.1)
        finally:
            if self._serial:
                self._serial.close()
            log.info("UHF reader stopped")

    def stop(self):
        self._running = False
