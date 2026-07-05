#!/usr/bin/env python3
"""Measure door-open command latency on the real C3-200 Plus over push.

- applies RequestDelay=1 (tries a live SET OPTIONS; the /iclock/push config
  also serves it to any fresh registration)
- measures the real getrequest poll interval empirically
- fires N door-open commands (safe: no barrier wired — just the relay clicks)
  and times enqueue -> device ACK for each
- the server logs 'RELAY STATE change' from rtstate, proving the output fired
"""
import argparse, sys, time, statistics, logging

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout),
              logging.FileHandler("c3_push_capture.log", mode="a")])
log = logging.getLogger("measure")

from edge.c3_push_server import C3PushServer, format_control_cmd


def wait_until(pred, timeout, interval=0.02):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        time.sleep(interval)
    return pred()


def poll_interval(srv, seconds=6.0):
    """Empirical getrequest poll interval = window / polls-in-window."""
    start_n = srv.getreq_count
    t0 = time.monotonic()
    time.sleep(seconds)
    dn = srv.getreq_count - start_n
    dt = time.monotonic() - t0
    return (dt / dn) if dn else float("inf"), dn


def send_and_time(srv, sn, make_cmd, label, timeout=8):
    cid = srv.next_cmd_id()
    t0 = time.monotonic()
    srv.enqueue_command(cid, make_cmd(cid), sn)
    if wait_until(lambda: srv.command_acked(cid), timeout):
        dt = time.monotonic() - t0
        code = next((d.acked[cid] for d in srv._devices.values() if cid in d.acked), None)
        log.info(f"[{label}] cmd {cid} ACK in {dt*1000:.0f} ms (Return={code})")
        return dt
    log.warning(f"[{label}] cmd {cid} NO ACK within {timeout}s")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sn", default="NDB7255000188")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--opens", type=int, default=5)
    ap.add_argument("--door", type=int, default=1)
    args = ap.parse_args()

    srv = C3PushServer(listen_host="0.0.0.0", listen_port=args.port,
                       serial_number=args.sn, trace=True)
    srv.start()
    log.info(f"server up; waiting for panel {args.sn}…")
    if not wait_until(lambda: srv.device_online(args.sn), 90):
        log.error("panel never came online"); srv.stop(); return 1
    log.info("panel online.")

    # Try to apply RequestDelay=1 at runtime (no reboot).
    send_and_time(srv, args.sn, lambda cid: f"C:{cid}:SET OPTIONS RequestDelay=1",
                  "SET-REQDELAY", timeout=6)

    itv, n = poll_interval(srv, 6.0)
    log.info(f"MEASURED poll interval ≈ {itv:.2f}s ({n} polls / 6s)")

    lat = []
    for i in range(args.opens):
        dt = send_and_time(srv, args.sn,
                           lambda cid: format_control_cmd(cid, args.door, 3),
                           f"DOOR-OPEN#{i+1}", timeout=8)
        if dt is not None:
            lat.append(dt)
        time.sleep(3.0)  # let the relay time out between shots

    if lat:
        log.info("=" * 56)
        log.info(f"DOOR-OPEN latency over {len(lat)} shots (enqueue→ACK):")
        log.info(f"  min={min(lat)*1000:.0f}ms  max={max(lat)*1000:.0f}ms  "
                 f"mean={statistics.mean(lat)*1000:.0f}ms  "
                 f"median={statistics.median(lat)*1000:.0f}ms")
        log.info(f"  (poll interval ≈ {itv:.2f}s; latency ranges 0..interval + overhead)")
        log.info("=" * 56)
    else:
        log.warning("no door-open ACKs captured")
    srv.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
