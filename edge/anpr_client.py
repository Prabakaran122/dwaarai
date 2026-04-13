"""Real ANPR client for RTSP/USB cameras on Raspberry Pi.

Captures frames from an RTSP stream or USB camera, detects motion to avoid
processing empty frames, and sends frames to the ANPR service for plate
recognition.

Requirements:
  pip install opencv-python-headless requests

Usage:
  # RTSP IP camera
  RTSP_CAMERA_URL=rtsp://admin:pass@192.168.1.100:554/stream1
  USE_CAMERA_MOCK=false

  # USB camera (e.g. /dev/video0)
  RTSP_CAMERA_URL=0
  USE_CAMERA_MOCK=false
"""
import os
import io
import time
import threading
import logging
import requests

log = logging.getLogger("anpr_client")

try:
    import cv2
    import numpy as np
    _HAS_CV2 = True
except ImportError:
    _HAS_CV2 = False
    log.warning("opencv-python not installed — ANPR client unavailable")


class ANPRClient:
    def __init__(self, rtsp_url: str, anpr_url: str = None,
                 capture_interval: float = 1.0,
                 motion_threshold: float = 5000.0,
                 cooldown: float = 8.0,
                 reconnect_delay: float = 5.0,
                 max_reconnects: int = 0):
        """
        Args:
            rtsp_url: RTSP URL or camera index (e.g. "0" for USB webcam)
            anpr_url: ANPR service base URL (default from ANPR_SERVICE_URL env)
            capture_interval: Seconds between frame captures (default 1.0)
            motion_threshold: Minimum contour area to trigger ANPR (default 5000)
            cooldown: Seconds to wait after a successful detection (default 8.0)
            reconnect_delay: Seconds between reconnect attempts (default 5.0)
            max_reconnects: Max reconnect attempts, 0 = unlimited (default 0)
        """
        if not _HAS_CV2:
            raise ImportError(
                "opencv-python required. Install with: pip install opencv-python-headless"
            )

        # Accept integer string for USB cameras
        self.rtsp_url = int(rtsp_url) if rtsp_url.isdigit() else rtsp_url
        self.anpr_url = anpr_url or os.getenv("ANPR_SERVICE_URL", "http://localhost:8001")
        self.capture_interval = capture_interval
        self.motion_threshold = motion_threshold
        self.cooldown = cooldown
        self.reconnect_delay = reconnect_delay
        self.max_reconnects = max_reconnects

        self._cap = None
        self._prev_gray = None
        self._running = False
        self._cb = None
        self._last_detection_time = 0.0
        self._consecutive_failures = 0

        log.info(f"ANPR client initialized: source={rtsp_url} interval={capture_interval}s "
                 f"motion_threshold={motion_threshold} cooldown={cooldown}s")

    def _connect(self) -> bool:
        """Open or reopen the video capture."""
        if self._cap is not None:
            self._cap.release()

        self._cap = cv2.VideoCapture(self.rtsp_url)

        if isinstance(self.rtsp_url, str):
            # RTSP optimizations
            self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        if not self._cap.isOpened():
            log.error(f"Failed to open camera: {self.rtsp_url}")
            return False

        log.info(f"Camera connected: {self.rtsp_url}")
        self._prev_gray = None
        self._consecutive_failures = 0
        return True

    def _has_motion(self, frame) -> bool:
        """Detect motion by comparing current frame to previous frame."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        if self._prev_gray is None:
            self._prev_gray = gray
            return False

        delta = cv2.absdiff(self._prev_gray, gray)
        self._prev_gray = gray

        thresh = cv2.threshold(delta, 25, 255, cv2.THRESH_BINARY)[1]
        thresh = cv2.dilate(thresh, None, iterations=2)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for c in contours:
            if cv2.contourArea(c) > self.motion_threshold:
                return True

        return False

    def _frame_to_jpeg(self, frame) -> bytes:
        """Encode frame as JPEG bytes."""
        _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return buf.tobytes()

    def _send_to_anpr(self, jpeg_bytes: bytes) -> dict | None:
        """Send JPEG frame to ANPR service and return result."""
        try:
            r = requests.post(
                f"{self.anpr_url}/anpr/process",
                files={"image": ("frame.jpg", io.BytesIO(jpeg_bytes), "image/jpeg")},
                timeout=5.0
            )
            if r.status_code == 200:
                return r.json()
            log.warning(f"ANPR service returned {r.status_code}")
            return None
        except requests.exceptions.RequestException as e:
            log.warning(f"ANPR service error: {e}")
            return None

    def _loop(self):
        """Main capture loop — runs in its own thread."""
        reconnect_count = 0

        while self._running:
            # Connect/reconnect
            if self._cap is None or not self._cap.isOpened():
                if self.max_reconnects > 0 and reconnect_count >= self.max_reconnects:
                    log.error("Max reconnect attempts reached, stopping")
                    break
                reconnect_count += 1
                log.info(f"Connecting to camera (attempt {reconnect_count})...")
                if not self._connect():
                    time.sleep(self.reconnect_delay)
                    continue
                reconnect_count = 0

            # Capture frame
            ret, frame = self._cap.read()
            if not ret:
                self._consecutive_failures += 1
                if self._consecutive_failures > 10:
                    log.warning("Too many capture failures, reconnecting...")
                    self._cap.release()
                    self._cap = None
                    time.sleep(self.reconnect_delay)
                continue

            self._consecutive_failures = 0

            # Skip if in cooldown after last detection
            now = time.time()
            if (now - self._last_detection_time) < self.cooldown:
                time.sleep(self.capture_interval)
                continue

            # Check for motion
            if not self._has_motion(frame):
                time.sleep(self.capture_interval)
                continue

            log.debug("Motion detected, sending frame to ANPR")

            # Send to ANPR service
            jpeg = self._frame_to_jpeg(frame)
            result = self._send_to_anpr(jpeg)

            if result and result.get("plate"):
                self._last_detection_time = now
                log.info(f"Plate detected: {result['plate']} "
                         f"conf={result.get('confidence', 0):.2f} "
                         f"in {result.get('processing_ms', 0):.0f}ms")
                if self._cb:
                    self._cb(result)

            time.sleep(self.capture_interval)

        # Cleanup
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        log.info("ANPR client stopped")

    def start(self, on_detection=None):
        """Start capturing and processing frames in a background thread."""
        self._cb = on_detection
        self._running = True
        threading.Thread(target=self._loop, daemon=True).start()
        log.info("ANPR client started")

    def stop(self):
        """Stop the capture loop."""
        self._running = False
