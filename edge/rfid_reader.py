"""Real MFRC522 RFID reader. Used when USE_RFID_MOCK=false."""
import logging
log = logging.getLogger("rfid_reader")

class RFIDReader:
    def __init__(self, on_tap_callback):
        self.cb = on_tap_callback
        log.info("Real RFID reader initialized")

    def run(self):
        """Blocking SPI polling loop — runs in its own thread."""
        raise NotImplementedError("Real RFID reader requires RPi hardware")
