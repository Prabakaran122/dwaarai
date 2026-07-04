#!/usr/bin/env python3
"""Stand up the C3 push server and just LISTEN — for live hardware bring-up.

Prints a heartbeat with device status every few seconds and traces every raw
HTTP request to c3_push_capture.log, so the moment a real panel is pointed at
us we see its exact endpoints/records. Leave running while you configure the
panel's Cloud Server (ADMS) setting.

Run:  python -m edge.tools.c3_push_listen --port 8080
"""
import argparse, socket, sys, time, logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout),
              logging.FileHandler("c3_push_capture.log", mode="a")],
)
log = logging.getLogger("listen")

from edge.c3_push_server import C3PushServer


def lan_ips():
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--sn", default="")
    args = ap.parse_args()

    srv = C3PushServer(listen_host="0.0.0.0", listen_port=args.port,
                       serial_number=args.sn, trace=True)
    srv.start()
    print("=" * 60)
    print(f"  Push server LISTENING on port {args.port}")
    print(f"  This host's IPs: {', '.join(lan_ips()) or 'unknown'}")
    print(f"  Point the panel Cloud Server at  <this-host>:{args.port}")
    print(f"  Tracing all requests to c3_push_capture.log")
    print("=" * 60, flush=True)

    last = None
    while True:
        devs = list(srv._devices.keys())
        online = [sn for sn in devs if srv.device_online(sn)]
        state = (tuple(sorted(devs)), tuple(sorted(online)))
        if state != last:
            log.info(f"STATUS devices={devs or '[]'} online={online or '[]'}")
            last = state
        time.sleep(2)


if __name__ == "__main__":
    main()
