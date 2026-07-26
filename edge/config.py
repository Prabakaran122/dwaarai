import os, sys
from dataclasses import dataclass

# Persistent state dir for the offline whitelist cache + event queue — must
# survive reboots. Windows: %PROGRAMDATA%\CommunityGate (e.g. C:\ProgramData\...);
# Linux/CI: /var/lib/communitygate. Override the whole dir with STATE_DIR, or the
# individual DB files with OFFLINE_DB_PATH / OFFLINE_QUEUE_PATH (dev/tests do this).
STATE_DIR = os.getenv(
    "STATE_DIR",
    os.path.join(os.environ.get("PROGRAMDATA", r"C:\ProgramData"), "CommunityGate")
    if sys.platform == "win32" else "/var/lib/communitygate",
)

@dataclass
class Config:
    GATE_ID:       str  = os.environ["GATE_ID"]
    COMMUNITY_ID:  str  = os.environ["COMMUNITY_ID"]
    DEVICE_TOKEN:  str  = os.environ["DEVICE_TOKEN"]
    CLOUD_API_URL: str  = os.getenv("CLOUD_API_URL", "http://localhost:3000/api/v1")

    GATE_TYPE:     str  = os.getenv("GATE_TYPE", "entry")
    COMMAND_TTL:   int  = int(os.getenv("MQTT_COMMAND_TTL_SECONDS", "30"))

    # ZKTeco C3-100 controller
    C3_IP:           str   = os.getenv("C3_IP", "192.168.1.201")
    C3_PORT:         int   = int(os.getenv("C3_PORT", "4370"))
    C3_SERIAL:       str   = os.getenv("C3_SERIAL", "")
    C3_POLL_INTERVAL:    float = float(os.getenv("C3_POLL_INTERVAL_SECONDS", "0.5"))
    C3_CARD_SYNC_INTERVAL: int = int(os.getenv("C3_CARD_SYNC_INTERVAL_SECONDS", "300"))
    C3_DOOR_NUMBER:  int   = int(os.getenv("C3_DOOR_NUMBER", "1"))
    C3_OPEN_DURATION: int  = int(os.getenv("C3_OPEN_DURATION_SECONDS", "5"))
    USE_C3_MOCK:     bool  = os.getenv("USE_C3_MOCK", "true").lower()=="true"
    # PUSH protocol (ADMS) — the panel dials into a server WE host on the edge.
    # Enables card WRITES (which the PULL zkaccess-c3 path cannot do). When true,
    # the edge runs a push server on C3_PUSH_PORT and the panel's Cloud Server
    # setting must point at this edge's IP:C3_PUSH_PORT. See edge/c3_push_controller.py.
    USE_C3_PUSH:     bool  = os.getenv("USE_C3_PUSH", "false").lower()=="true"
    C3_PUSH_PORT:    int   = int(os.getenv("C3_PUSH_PORT", "8080"))
    C3_PUSH_BIND:    str   = os.getenv("C3_PUSH_BIND", "0.0.0.0")
    # Alert if the panel hasn't contacted the push server in this many seconds
    # (panel wedged / network down). Local C3 decisions continue during a gap.
    C3_ALERT_SECONDS: int  = int(os.getenv("C3_ALERT_SECONDS", "90"))
    # Bulk card-sync throttle (avoids overwhelming the panel's flash on a big roster).
    C3_SYNC_CHUNK:   int   = int(os.getenv("C3_SYNC_CHUNK", "50"))
    C3_SYNC_PAUSE:   float = float(os.getenv("C3_SYNC_PAUSE_SECONDS", "1.5"))

    # USB FASTag reader (edge-side decision). Fallback for readers that dump the
    # full 96-bit EPC over Wiegand (which the 32-bit C3 card field can't decode).
    # Reader in Active + USB-KB mode types the EPC over USB; the edge reads it,
    # checks the whitelist, and opens the C3 barrier. See uhf_usb_reader.py.
    USE_UHF_USB:      bool  = os.getenv("USE_UHF_USB", "false").lower() == "true"
    UHF_USB_DEBOUNCE: float = float(os.getenv("UHF_USB_DEBOUNCE_SECONDS", "8"))
    # The keyboard hook is process-wide, so the filter must be strict enough
    # that human typing on the gate PC can never be mistaken for a tag. Exact
    # EPC widths (96-bit = 24 hex chars, 128-bit = 32) and a machine-speed
    # burst window. See edge/uhf_usb_reader.py.
    UHF_EPC_LENGTHS:  tuple = tuple(
        int(n) for n in os.getenv("UHF_EPC_LENGTHS", "24,32").split(",") if n.strip()
    )
    UHF_MAX_KEY_GAP:  float = float(os.getenv("UHF_MAX_KEY_GAP_SECONDS", "0.05"))

    # MQTT
    MQTT_BROKER:    str  = os.getenv("MQTT_BROKER", "localhost")
    MQTT_PORT:      int  = int(os.getenv("MQTT_PORT", "1883"))
    MQTT_USE_TLS:   bool = os.getenv("MQTT_USE_TLS","false").lower()=="true"
    MQTT_CERT_PATH: str  = os.getenv("MQTT_CERT_PATH", "")
    MQTT_KEY_PATH:  str  = os.getenv("MQTT_KEY_PATH", "")
    MQTT_CA_PATH:   str  = os.getenv("MQTT_CA_PATH", "")

    # Offline storage — must persist across reboots. Defaults land in STATE_DIR
    # (%PROGRAMDATA%\CommunityGate on Windows, /var/lib/communitygate on Linux);
    # the edge creates the dir on startup. Override via env in dev/tests.
    OFFLINE_DB_PATH:    str = os.getenv("OFFLINE_DB_PATH",    os.path.join(STATE_DIR, "whitelist.db"))
    OFFLINE_QUEUE_PATH: str = os.getenv("OFFLINE_QUEUE_PATH", os.path.join(STATE_DIR, "event_queue.db"))
    WHITELIST_SYNC_INTERVAL: int = int(os.getenv("WHITELIST_SYNC_INTERVAL_SECONDS","300"))
    HEARTBEAT_INTERVAL: int = int(os.getenv("HEARTBEAT_INTERVAL_SECONDS","60"))

    # ANPR camera event receiver (camera POSTs plate events to this port)
    ANPR_RECEIVER_PORT: int = int(os.getenv("ANPR_RECEIVER_PORT", "8001"))

    # ANPR correlation
    FASTAG_CORRELATION_WINDOW: float = float(os.getenv("FASTAG_CORRELATION_WINDOW_SECONDS", "5"))

cfg = Config()
