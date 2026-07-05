#!/usr/bin/env python3
"""Live command test against the real C3-200 Plus over the push protocol.

Single process: starts the push server, waits for the panel to register and
poll, then exercises real commands and reports the panel's ACKs.

  --card <n>   push/update a card into the panel user table (NON-physical) and
               wait for the device ACK (this is the capability PULL lacked)
  --open       fire a remote door-open (PHYSICAL: actuates the relay/barrier)
  --watch <s>  after commands, watch <s> seconds for card-tap rtlog events

Run:  python -m edge.tools.c3_live_test --sn NDB7255000188 --card 1234567
"""
import argparse, sys, time, logging

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout),
              logging.FileHandler("c3_push_capture.log", mode="a")])
log = logging.getLogger("live")

from edge.c3_push_server import (C3PushServer, format_user_cmd, format_control_cmd)


def wait_until(pred, timeout, interval=0.3):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(interval)
    return pred()


def ready(srv, sn):
    # An already-registered panel reconnects straight to getrequest polling
    # (it keeps its RegistryCode), so "online" — seen via ANY request — is the
    # right readiness signal, not a fresh registry POST this session.
    return srv.device_online(sn)


def send_and_wait(srv, sn, make_cmd, label, timeout=20):
    cid = srv.next_cmd_id()
    wire = make_cmd(cid)
    srv.enqueue_command(cid, wire, sn)
    log.info(f"[{label}] queued cmd {cid}: {wire!r}")
    if wait_until(lambda: srv.command_acked(cid), timeout):
        code = None
        for d in srv._devices.values():
            if cid in d.acked:
                code = d.acked[cid]
        ok = code is not None and str(code).lstrip("-").isdigit() and int(code) >= 0
        log.info(f"[{label}] ACK cmd {cid}: Return={code}  -> {'SUCCESS' if ok else 'FAIL'}")
        return ok
    log.warning(f"[{label}] NO ACK for cmd {cid} within {timeout}s "
                f"(command format may be wrong for this firmware; see capture log)")
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sn", default="NDB7255000188")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--card", default="")
    ap.add_argument("--open", action="store_true")
    ap.add_argument("--door", type=int, default=1)
    ap.add_argument("--duration", type=int, default=5)
    ap.add_argument("--watch", type=int, default=0)
    args = ap.parse_args()

    srv = C3PushServer(listen_host="0.0.0.0", listen_port=args.port,
                       serial_number=args.sn, trace=True)
    srv.start()
    log.info(f"server up on {args.port}; waiting for panel {args.sn} to register…")
    if not wait_until(lambda: ready(srv, args.sn), 90):
        log.error("panel did not register within 90s — aborting")
        srv.stop(); return 1
    log.info("panel REGISTERED and polling. Running commands.")

    results = {}
    if args.card:
        results["card_push"] = send_and_wait(
            srv, args.sn, lambda cid: format_user_cmd(cid, args.card), "CARD-PUSH")
    if args.open:
        results["door_open"] = send_and_wait(
            srv, args.sn,
            lambda cid: format_control_cmd(cid, args.door, args.duration), "DOOR-OPEN")

    if args.watch:
        log.info(f"watching {args.watch}s for card taps — TAP A CARD NOW…")
        end = time.time() + args.watch
        while time.time() < end:
            for e in srv.drain_events():
                log.info(f"[TAP] {e}")
            time.sleep(0.3)

    log.info(f"RESULTS: {results}")
    srv.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
