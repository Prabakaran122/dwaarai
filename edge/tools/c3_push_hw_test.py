#!/usr/bin/env python3
"""Live hardware smoke-test / capture harness for the C3 **Push protocol**.

Unlike the pytest suite (which drives a simulated panel), this talks to a REAL
ZKTeco C3 on the LAN. Because the panel dials OUT to us, there is a one-time
setup step: point the panel's Cloud Server Setting at THIS machine.

PREREQUISITES (only the panel operator can do these):
  1. Panel and this PC on the same reachable LAN.
  2. On the panel (keypad menu Comm > Cloud Server, or via ZKBio/web), set:
        Server Address = <this PC's LAN IP>     (e.g. 192.168.18.111)
        Server Port    = <PORT below>           (default 8080)
        Enable domain/HTTP push = ON
  3. Save; the panel reboots/reconnects and starts checking in.

WHAT THIS DOES:
  - Starts the real C3PushServer and prints the IP:port to configure.
  - Waits for the panel to check in (proves connectivity + firmware push support).
  - Dumps every raw HTTP exchange to c3_push_capture.log — this is how we learn
    the panel's EXACT record/command byte layout to finalize the parsers.
  - Then runs live steps: push a test card, wait for you to tap it (event should
    surface), and fire a remote door-open.

Run:  python -m edge.tools.c3_push_hw_test --port 8080 --sn <panel serial>
"""
import argparse, socket, sys, time, logging

# Make raw exchanges visible — this is a diagnostic tool.
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout),
              logging.FileHandler("c3_push_capture.log", mode="w")],
)
log = logging.getLogger("hw_test")

from edge.c3_push_server import C3PushServer


def lan_ip() -> str:
    """Best-effort primary LAN IPv4 of this host."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))   # no packet sent; just picks the egress iface
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def wait_until(pred, timeout, interval=0.5):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(interval)
    return pred()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080, help="port the panel pushes to")
    ap.add_argument("--sn", default="", help="panel serial number (targets commands)")
    ap.add_argument("--card", default="0009999001", help="test card number to push")
    ap.add_argument("--door", type=int, default=1)
    ap.add_argument("--wait", type=int, default=120, help="seconds to wait for check-in")
    args = ap.parse_args()

    ip = lan_ip()
    srv = C3PushServer(listen_host="0.0.0.0", listen_port=args.port,
                       serial_number=args.sn)
    srv.start()

    print("\n" + "=" * 64)
    print(f"  C3 push server listening on  {ip}:{args.port}")
    print(f"  Configure the panel Cloud Server Setting:")
    print(f"      Server Address = {ip}")
    print(f"      Server Port    = {args.port}")
    print(f"  Raw exchanges are being written to c3_push_capture.log")
    print("=" * 64 + "\n")

    # 1) Connectivity + firmware push support
    print(f"[1/4] Waiting up to {args.wait}s for the panel to check in ...")
    if not wait_until(lambda: srv.device_online(args.sn), args.wait):
        print("  ✗ No check-in. Either the panel isn't pointed at this IP:port, "
              "it's on another subnet, or this firmware doesn't support push.")
        print("    Leaving the server up so you can watch c3_push_capture.log; "
              "Ctrl+C to stop.")
        try:
            while True:
                time.sleep(2)
        except KeyboardInterrupt:
            srv.stop(); return 1
    sn = args.sn or next(iter(srv._devices))
    print(f"  ✓ Panel checked in (SN={sn}). Push protocol confirmed on this firmware.\n")

    # 2) Push a test card (the capability PULL lacked)
    print(f"[2/4] Pushing test card {args.card} ...")
    cid = srv.next_cmd_id()
    from edge.c3_push_server import format_user_cmd
    srv.enqueue_command(cid, format_user_cmd(cid, args.card), sn)
    if wait_until(lambda: srv.command_acked(cid), 15):
        print("  ✓ Panel ACKed the user-add command.\n")
    else:
        print("  ⚠ No ACK in 15s — check c3_push_capture.log for the panel's reply "
              "format (command syntax may need adjusting for this firmware).\n")

    # 3) Tap event
    print(f"[3/4] Tap card {args.card} at the reader now (30s) ...")
    seen = {}
    def _tap():
        for e in srv.drain_events():
            log.info(f"EVENT: {e}")
            seen.update(e)
        return seen.get("card_number") == args.card
    if wait_until(_tap, 30):
        print(f"  ✓ Event received: {seen}\n")
    else:
        print("  ⚠ No matching event. Any events seen are in the log; the RTLog "
              "field layout may differ — that capture tells us how to fix parse_rtlog_line.\n")

    # 4) Remote unlock
    print(f"[4/4] Firing remote open on door {args.door} (5s) — watch the barrier ...")
    cid = srv.next_cmd_id()
    from edge.c3_push_server import format_control_cmd
    srv.enqueue_command(cid, format_control_cmd(cid, args.door, 5), sn)
    if wait_until(lambda: srv.command_acked(cid), 15):
        print("  ✓ Panel ACKed the open command (barrier should have moved).\n")
    else:
        print("  ⚠ No ACK — see log for the control-command reply format.\n")

    print("Done. Full capture in c3_push_capture.log — share it and I'll lock the "
          "wire format to this exact firmware.")
    srv.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
