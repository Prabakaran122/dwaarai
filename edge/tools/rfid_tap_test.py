"""RFID real-tap test harness — one command, run it with a reader wired to the C3.

What it does:
  1. Starts the push server and waits for the panel to connect.
  2. Provisions a KNOWN test tag (so tapping it should be an ALLOW).
  3. Live-decodes every tap the panel reports, capturing the real event= code
     for both known (allow) and unknown (deny) tags — which is exactly what we
     need to lock down the allow/deny codes and prove the offline local path.

Usage (once the C3 is reachable and an RFID reader is on its Wiegand port):
    python -m edge.tools.rfid_tap_test --sn NDB7255000188 --known 1234567
Then tap: (a) a tag whose number == --known  -> expect ALLOW
          (b) any other tag                   -> expect DENY
Ctrl+C to stop.
"""
import argparse, time, sys
from edge.c3_push_server import C3PushServer, format_user_cmd

ALLOW_HINT = {0, 1}  # commonly-seen allow event codes; we PRINT the real one


def describe_tap(evt: dict, known: str) -> str:
    """One-line human summary of a tap event (pure — unit-testable)."""
    card = evt.get("card_number", "?")
    code = evt.get("event_code", "?")
    kind = evt.get("event_type", "?").upper()
    is_known = card == known
    tag = "KNOWN" if is_known else "unknown"
    return (f"  TAP  card={card:<14} event={code:<4} -> {kind:<5} "
            f"[{tag}]  door={evt.get('door','?')} idx={evt.get('index','?')} "
            f"@ {evt.get('timestamp','?')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sn", required=True, help="panel serial (e.g. NDB7255000188)")
    ap.add_argument("--known", required=True, help="a tag number to provision as ALLOW")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--wait", type=int, default=180, help="seconds to wait for the panel")
    args = ap.parse_args()

    srv = C3PushServer(listen_host="0.0.0.0", listen_port=args.port, serial_number=args.sn)
    srv.start()
    print(f"Push server up on :{args.port}. Waiting for panel {args.sn} ...", flush=True)
    t0 = time.time()
    while time.time() - t0 < args.wait and not srv.device_online(args.sn):
        time.sleep(1)
    if not srv.device_online(args.sn):
        print("Panel never connected — check LAN/power and that it points at this host:port.")
        srv.stop(); sys.exit(1)
    print("Panel online. Provisioning known tag ...", flush=True)

    cid = srv.next_cmd_id()
    srv.enqueue_command(cid, format_user_cmd(cid, args.known, name="TapTest"), args.sn)
    t0 = time.time()
    while time.time() - t0 < 8 and not srv.command_acked(cid):
        time.sleep(0.05)
    print(f"Known tag {args.known} provisioned (acked={srv.command_acked(cid)}).")
    print("\nNow TAP tags on the reader. Expect ALLOW for the known tag, DENY for others.")
    print("Watching for taps (Ctrl+C to stop):\n", flush=True)

    seen = 0
    try:
        while True:
            for evt in srv.drain_events():
                if evt.get("event_type") == "alarm":
                    print(f"  ALARM  {evt.get('alarm')} door={evt.get('door')}"); continue
                print(describe_tap(evt, args.known), flush=True)
                seen += 1
            time.sleep(0.3)
    except KeyboardInterrupt:
        print(f"\nStopped. {seen} tap event(s) captured. "
              f"Note the real event= codes above to lock allow/deny.")
        srv.stop()


if __name__ == "__main__":
    main()
