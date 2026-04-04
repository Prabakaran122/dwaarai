import os
from dataclasses import dataclass

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

    # MQTT
    MQTT_BROKER:    str  = os.getenv("MQTT_BROKER", "localhost")
    MQTT_PORT:      int  = int(os.getenv("MQTT_PORT", "1883"))
    MQTT_USE_TLS:   bool = os.getenv("MQTT_USE_TLS","false").lower()=="true"
    MQTT_CERT_PATH: str  = os.getenv("MQTT_CERT_PATH", "")
    MQTT_KEY_PATH:  str  = os.getenv("MQTT_KEY_PATH", "")
    MQTT_CA_PATH:   str  = os.getenv("MQTT_CA_PATH", "")

    # Offline storage
    OFFLINE_DB_PATH:    str = os.getenv("OFFLINE_DB_PATH",    "/tmp/whitelist.db")
    OFFLINE_QUEUE_PATH: str = os.getenv("OFFLINE_QUEUE_PATH", "/tmp/event_queue.db")
    WHITELIST_SYNC_INTERVAL: int = int(os.getenv("WHITELIST_SYNC_INTERVAL_SECONDS","300"))
    HEARTBEAT_INTERVAL: int = int(os.getenv("HEARTBEAT_INTERVAL_SECONDS","60"))

    # ANPR camera event receiver (camera POSTs plate events to this port)
    ANPR_RECEIVER_PORT: int = int(os.getenv("ANPR_RECEIVER_PORT", "8001"))

    # ANPR correlation
    FASTAG_CORRELATION_WINDOW: float = float(os.getenv("FASTAG_CORRELATION_WINDOW_SECONDS", "5"))

cfg = Config()
