import os
from dataclasses import dataclass

@dataclass
class Config:
    GATE_ID:       str  = os.environ["GATE_ID"]
    COMMUNITY_ID:  str  = os.environ["COMMUNITY_ID"]
    DEVICE_TOKEN:  str  = os.environ["DEVICE_TOKEN"]
    CLOUD_API_URL: str  = os.getenv("CLOUD_API_URL", "http://localhost:3000/api/v1")

    RELAY_PIN:          int   = int(os.getenv("RELAY_GPIO_PIN", "17"))
    RELAY_OPEN_SECONDS: float = float(os.getenv("RELAY_OPEN_SECONDS", "5"))
    COMMAND_TTL:        int   = int(os.getenv("MQTT_COMMAND_TTL_SECONDS", "30"))

    MQTT_BROKER:    str  = os.getenv("MQTT_BROKER", "localhost")
    MQTT_PORT:      int  = int(os.getenv("MQTT_PORT", "1883"))
    MQTT_USE_TLS:   bool = os.getenv("MQTT_USE_TLS","false").lower()=="true"
    MQTT_CERT_PATH: str  = os.getenv("MQTT_CERT_PATH", "")
    MQTT_KEY_PATH:  str  = os.getenv("MQTT_KEY_PATH", "")
    MQTT_CA_PATH:   str  = os.getenv("MQTT_CA_PATH", "")

    RFID_SPI_BUS:    int   = int(os.getenv("RFID_SPI_BUS", "0"))
    RFID_RESET_PIN:  int   = int(os.getenv("RFID_RESET_PIN", "25"))
    RFID_DEBOUNCE:   float = float(os.getenv("RFID_DEBOUNCE_SECONDS", "3"))

    OFFLINE_DB_PATH:    str = os.getenv("OFFLINE_DB_PATH",    "/tmp/whitelist.db")
    OFFLINE_QUEUE_PATH: str = os.getenv("OFFLINE_QUEUE_PATH", "/tmp/event_queue.db")
    WHITELIST_SYNC_INTERVAL: int = int(os.getenv("WHITELIST_SYNC_INTERVAL_SECONDS","300"))
    HEARTBEAT_INTERVAL: int = int(os.getenv("HEARTBEAT_INTERVAL_SECONDS","60"))

    ANPR_SERVICE_URL: str   = os.getenv("ANPR_SERVICE_URL", "http://localhost:8001")
    ANPR_THRESHOLD:   float = float(os.getenv("ANPR_CONFIDENCE_THRESHOLD","0.75"))

    USE_GPIO_MOCK:   bool = os.getenv("USE_GPIO_MOCK",   "true").lower()=="true"
    USE_RFID_MOCK:   bool = os.getenv("USE_RFID_MOCK",   "true").lower()=="true"
    USE_CAMERA_MOCK: bool = os.getenv("USE_CAMERA_MOCK", "true").lower()=="true"
    MOCK_CAMERA_INTERVAL: float = float(os.getenv("MOCK_CAMERA_INTERVAL_SECONDS","4"))
    MOCK_CAMERA_PLATE_DIR: str  = os.getenv("MOCK_CAMERA_PLATE_DIR","scripts/test_plates")

cfg = Config()
