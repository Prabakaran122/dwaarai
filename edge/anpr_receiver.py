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


# Plate/confidence field names across camera vendors (ZKTeco LPRC, Hikvision,
# Dahua, and the "AlarmInfoPlate" family common to LPR cameras). Searched
# recursively, so nested shapes like
#   {"AlarmInfoPlate": {"result": {"PlateResult": {"license": "KA05..."}}}}
# resolve without hard-coding the path.
_PLATE_KEYS = ["plate", "plateNumber", "plate_number", "PlateNumber", "licensePlate",
               "LicensePlate", "license", "carLicense", "car_license", "plateNo",
               "plate_no", "number", "plateResult"]
_CONF_KEYS = ["confidence", "Confidence", "conf", "reliability"]


def _deep_find(obj, keys):
    """First non-empty value for any key in `keys`, searched depth-first."""
    if isinstance(obj, dict):
        for k in keys:
            v = obj.get(k)
            if isinstance(v, str) and v.strip():
                return v
            if isinstance(v, (int, float)):
                return v
        for v in obj.values():
            r = _deep_find(v, keys)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _deep_find(v, keys)
            if r is not None:
                return r
    return None


def extract_plate_json(data):
    """Pull (plate, confidence) from a parsed JSON body of any known shape."""
    plate = _deep_find(data, _PLATE_KEYS)
    if isinstance(plate, dict):                      # e.g. plateResult:{number:..}
        plate = _deep_find(plate, _PLATE_KEYS)
    conf = _deep_find(data, _CONF_KEYS)
    if isinstance(conf, (int, float)) and conf > 1:  # 0-100 -> 0-1
        conf = conf / 100.0
    elif not isinstance(conf, (int, float)):
        conf = None
    return (plate if isinstance(plate, str) else None), conf


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
                # Couldn't extract a plate — log the RAW payload so we can add a
                # parser for this camera's format (how we onboard a new LPRC300).
                log.warning("ANPR event, no plate extracted — RAW for format "
                            f"discovery: content_type={content_type!r} "
                            f"body={body[:1000]!r}")
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
        """Parse a JSON plate event from any known camera shape (ZKTeco LPRC,
        Hikvision, Dahua, AlarmInfoPlate, generic). Field search is recursive."""
        return extract_plate_json(json.loads(body))

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
