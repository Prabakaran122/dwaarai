#!/usr/bin/env python3
"""Probe the real C3's access-control model over push (paced, gentle).

Confirms which access features the panel ACCEPTS via the push protocol —
time-limited cards (visitor passes), access levels, time zones, holidays — by
recording the Return code for each. Return=0 = accepted; a negative code means
the verb is understood but the format/params differ (still informative).

Also reports the panel's own clock (#2) from the time= it uploads.
"""
import argparse, sys, time, logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
log = logging.getLogger("acc")

from edge.c3_push_server import C3PushServer

PACE = 0.6


def wait_until(pred, timeout, interval=0.05):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        time.sleep(interval)
    return pred()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sn", default="NDB7255000188")
    ap.add_argument("--port", type=int, default=8080)
    args = ap.parse_args()
    srv = C3PushServer(listen_host="0.0.0.0", listen_port=args.port,
                       serial_number=args.sn, trace=False)
    srv.start()
    log.info(f"waiting up to 160s for panel {args.sn} (rebooting)…")
    if not wait_until(lambda: srv.device_online(args.sn), 160):
        log.error("panel never came online"); srv.stop(); return 1
    srv.getreq_batch = 1
    sn = args.sn

    def send(cmd, timeout=8):
        cid = srv.next_cmd_id()
        srv.enqueue_command(cid, f"C:{cid}:{cmd}", sn)
        ok = wait_until(lambda: srv.command_acked(cid), timeout)
        ret = next((d.acked[cid] for d in srv._devices.values() if cid in d.acked), None)
        time.sleep(PACE)
        return ret

    # give it a moment to push an rtstate so we have its clock
    log.info("panel online. Reading device clock…")
    wait_until(lambda: srv.last_device_time, 20)
    log.info(f"[#2 TIME] panel clock = {srv.last_device_time or '(none seen)'} | "
             f"PC now = {time.strftime('%Y-%m-%d %H:%M:%S')}")

    log.info("=== #1 ACCESS-CONTROL MODEL (Return=0 means accepted) ===")
    tests = [
        ("time-limited card YYYYMMDD",
         "DATA UPDATE user Pin=8100001\tCardNo=8100001\tPassword=\tGroup=1\t"
         "StartTime=20260705\tEndTime=20260805\tName=visitor1"),
        ("time-limited card datetime",
         "DATA UPDATE user Pin=8100002\tCardNo=8100002\tPassword=\tGroup=1\t"
         "StartTime=2026-07-05 00:00:00\tEndTime=2026-08-05 23:59:59\tName=visitor2"),
        ("access level (userauthorize)",
         "DATA UPDATE userauthorize Pin=8100001\tAuthorizeTimezoneId=1\tAuthorizeDoorId=1"),
        ("timezone (table=timezone)",
         "DATA UPDATE timezone TimezoneId=2\tSunTime1=0000\tSunTime2=2359"),
        ("timezone (table=tz)",
         "DATA UPDATE tz Uid=2\tSunTime1=0\tSunTime2=1439"),
        ("holiday",
         "DATA UPDATE holiday Uid=1\tHoliday=20260815\tHolidayType=1"),
        ("first-card (firstcard)",
         "DATA UPDATE firstcard Pin=8100001\tDoorId=1\tTimezoneId=1"),
    ]
    results = []
    for label, cmd in tests:
        ret = send(cmd)
        ok = ret is not None and str(ret).lstrip("-").isdigit() and int(ret) >= 0
        results.append((label, ret, ok))
        log.info(f"  [{'ACCEPT' if ok else 'reject'}] {label:32} Return={ret}")

    # cleanup the two test cards, paced
    for c in ("8100001", "8100002"):
        send(f"DATA DELETE user CardNo={c}")

    log.info("=" * 58)
    acc = [l for l, r, ok in results if ok]
    log.info(f"ACCEPTED by panel: {acc or 'none'}")
    log.info(f"panel stayed online through the run: {srv.device_online(sn)}")
    log.info("=" * 58)
    srv.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
