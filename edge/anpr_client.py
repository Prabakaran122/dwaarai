"""Real ANPR client for RTSP camera. Used when USE_CAMERA_MOCK=false."""
import logging
log = logging.getLogger("anpr_client")

class ANPRClient:
    def __init__(self, rtsp_url: str):
        self.rtsp_url = rtsp_url
        log.info(f"Real ANPR client initialized: {rtsp_url}")

    def start(self, on_detection=None):
        raise NotImplementedError("Real ANPR client requires RTSP camera")

    def stop(self):
        pass
