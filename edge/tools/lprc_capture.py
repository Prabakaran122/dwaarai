"""LPRC300 payload capture — run this, then trigger the camera on a plate.

The point: capture the EXACT bytes the LPRC300 pushes (its format is
vendor-specific), so we can lock the ANPR parser to reality instead of guessing.
Logs every request (method, path, content-type, raw body) to a file AND tries
the existing parser so you can see whether we'd extract the plate today.

Usage (camera powered, on the LAN, configured to POST to http://<edge>:8001/...):
    python -m edge.tools.lprc_capture --port 8001 --out lprc_payloads.log
Every push is appended to the out file; a plate we manage to parse is printed.
"""
import argparse, time, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    # Reuse the real receiver's extractor so "would we parse it?" is accurate.
    from edge.anpr_receiver import extract_plate_json  # type: ignore
except Exception:
    extract_plate_json = None

class Capture(BaseHTTPRequestHandler):
    out_file = "lprc_payloads.log"   # set from --out in main()

    def log_message(self, *a):  # silence default noisy logging
        pass

    def _handle(self, method):
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""
        ctype = self.headers.get("Content-Type", "")
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        # Try to extract a plate with the current parser.
        parsed = None
        if body and extract_plate_json:
            try:
                parsed = extract_plate_json(json.loads(body.decode("utf-8", "replace")))
            except Exception:
                parsed = None
        preview = body[:800].decode("utf-8", "replace")
        line = (f"\n===== {stamp}  {method} {self.path}  ({length}B, {ctype}) =====\n"
                f"{preview}\n-- parser result: {parsed} --\n")
        with open(self.out_file, "a", encoding="utf-8") as f:
            f.write(line)
        print(f"[{stamp}] {method} {self.path}  {length}B  ctype={ctype or '?'}  "
              f"parsed_plate={parsed}", flush=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK")

    def do_POST(self):
        self._handle("POST")

    def do_GET(self):
        self._handle("GET")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8001)
    ap.add_argument("--out", default=Capture.out_file)
    args = ap.parse_args()
    Capture.out_file = args.out
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Capture)
    print(f"LPRC capture listening on :{args.port} (all paths). Logging to {args.out}.")
    print("Point the camera here and trigger a plate. Ctrl+C to stop.\n", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped. Captured payloads are in", OUT)
        srv.shutdown()


if __name__ == "__main__":
    main()
