"""Drop-in for RPi.GPIO. Set USE_GPIO_MOCK=true to activate."""
import logging
log = logging.getLogger("gpio_mock")

BCM = "BCM"; BOARD = "BOARD"; OUT = "OUT"; IN = "IN"; HIGH = 1; LOW = 0
_pins: dict[int, int] = {}
_LABELS = {17: "RELAY_GATE", 25: "RFID_RST", 24: "IR_SENSOR"}

def setmode(mode):    log.info(f"[GPIO MOCK] setmode({mode})")
def setwarnings(f):   pass
def cleanup():
    log.info("[GPIO MOCK] cleanup"); _pins.clear()

def setup(pin, direction, initial=LOW):
    _pins[pin] = initial
    log.info(f"[GPIO MOCK] setup {_LABELS.get(pin, pin)} dir={direction}")

def output(pin, state):
    _pins[pin] = state
    label = "HIGH ▲ OPEN" if state == HIGH else "LOW  ▼ CLOSED"
    log.info(f"[GPIO MOCK] {_LABELS.get(pin, pin)} → {label}")

def input(pin):
    return _pins.get(pin, LOW)

# Test helpers
def pin_state(pin: int) -> int:  return _pins.get(pin, LOW)
def all_pins() -> dict:          return dict(_pins)
