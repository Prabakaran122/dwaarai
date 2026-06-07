"""ANPR Camera Event Receiver.

Lightweight HTTP server that receives license plate events from any ANPR camera.
Replaces the EasyOCR/PaddleOCR pipeline — the camera does the OCR on-device.

Supported camera formats:
- Generic JSON: {"plate": "KA05MF1234", "confidence": 0.98}
- Hikvision ISAPI: XML event with licensePlate field
- Dahua: JSON with PlateNumber field

Configure your ANPR camera to POST events to:
  http://<server-ip>:8001/anpr/event

Runs on port 8001 (same port as old ANPR service).
"""
import json, logging, re, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from xml.etree import ElementTree

log = logging.getLogger("anpr_receiver")

# Plate normalization
_PLATE_RE = re.compile(r'[^A-Za-z0-9]')

def normalize_plate(raw):
    """Strip non-alnum, uppercase."""
    return _PLATE_RE.sub('', raw).upper()


class ANPREventHandler(BaseHTTPRequestHandler):
    """HTTP handler for ANPR camera plate events."""

    callback = None  # Set by ANPRReceiver

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            content_type = self.headers.get('Content-Type', '')

            plate = None
            confidence = None

            if 'xml' in content_type or body.strip().startswith(b'<'):
                # Hikvision ISAPI XML format
                plate, confidence = self._parse_hikvision_xml(body)
            else:
                # JSON format (generic, Dahua, etc.)
                plate, confidence = self._parse_json(body)

            if plate:
                plate = normalize_plate(plate)
                log.info(f"ANPR event: plate={plate} conf={confidence}")
                if self.callback:
                    self.callback(plate, confidence)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "plate": plate}).encode())
            else:
                log.warning(f"ANPR event with no plate: {body[:200]}")
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"status": "no_plate"}')

        except Exception as e:
            log.error(f"ANPR event error: {e}")
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        """Health check."""
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok": true, "service": "anpr-receiver"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        """Suppress default HTTP logging — we use our own logger."""
        pass

    def _parse_json(self, body):
        """Parse JSON plate event. Supports multiple camera formats."""
        data = json.loads(body)

        # Generic format: {"plate": "...", "confidence": 0.98}
        plate = data.get('plate') or data.get('plateNumber') or data.get('plate_number')

        # Dahua format: {"PlateNumber": "...", "Confidence": 98}
        if not plate:
            plate = data.get('PlateNumber') or data.get('plateResult', {}).get('number')

        # Hikvision JSON format (some models)
        if not plate:
            plate = data.get('licensePlate') or data.get('ANPR', {}).get('licensePlate')

        # Confidence
        confidence = data.get('confidence') or data.get('Confidence')
        if confidence and isinstance(confidence, (int, float)):
            if confidence > 1:
                confidence = confidence / 100.0  # Dahua sends 0-100
        else:
            confidence = None

        return plate, confidence

    def _parse_hikvision_xml(self, body):
        """Parse Hikvision ISAPI XML plate event."""
        try:
            root = ElementTree.fromstring(body)
            # Remove namespace prefix if present
            ns = ''
            if root.tag.startswith('{'):
                ns = root.tag.split('}')[0] + '}'

            plate = None
            confidence = None

            # Try common Hikvision XML paths
            for path in [
                f'{ns}licensePlate',
                f'{ns}ANPR/{ns}licensePlate',
                'licensePlate',
                './/licensePlate',
                './/plateNumber',
            ]:
                elem = root.find(path)
                if elem is not None and elem.text:
                    plate = elem.text.strip()
                    break

            for path in [f'{ns}confidence', './/confidence']:
                elem = root.find(path)
                if elem is not None and elem.text:
                    try:
                        confidence = float(elem.text)
                        if confidence > 1:
                            confidence = confidence / 100.0
                    except ValueError:
                        pass
                    break

            return plate, confidence
        except ElementTree.ParseError:
            log.warning("Failed to parse XML ANPR event")
            return None, None


class ANPRReceiver:
    """ANPR Camera event receiver server."""

    def __init__(self, port=8001, on_plate_callback=None):
        self.port = port
        self.callback = on_plate_callback
        self._server = None
        self._thread = None

    def start(self):
        """Start the HTTP server in a background thread."""
        ANPREventHandler.callback = self.callback
        # ThreadingHTTPServer: each plate event is handled on its own thread so a
        # slow cloud access-check in the callback can't stall the next camera event.
        self._server = ThreadingHTTPServer(('0.0.0.0', self.port), ANPREventHandler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        log.info(f"ANPR receiver listening on port {self.port}")
        log.info(f"Configure camera to POST to: http://<this-ip>:{self.port}/anpr/event")

    def stop(self):
        if self._server:
            self._server.shutdown()
            log.info("ANPR receiver stopped")
