#!/usr/bin/env python3
"""Extensive real-controller test + capability discovery for the C3-200 Plus.

Drives many scenarios against the live panel over the push protocol to find
where the integration breaks, measure throughput, and discover which device
commands are usable. Writes c3_test_report.json and prints a summary.

Non-destructive: never issues CLEAR DATA / factory-reset. Test cards pushed
during the run are deleted at the end.

Run:  python -m edge.tools.c3_extensive_test --sn NDB7255000188
"""
import argparse, json, sys, time, statistics, logging

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout),
              logging.FileHandler("c3_push_capture.log", mode="a")])
log = logging.getLogger("xtest")

from edge.c3_push_server import (C3PushServer, format_user_cmd,
                                 format_control_cmd, format_user_delete_cmd)

RESULTS = []
def rec(name, status, detail=""):
    RESULTS.append({"name": name, "status": status, "detail": detail})
    log.info(f"  [{status:4}] {name} - {detail}")


def wait_until(pred, timeout, interval=0.02):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        time.sleep(interval)
    return pred()


class Rig:
    def __init__(self, srv, sn):
        self.srv, self.sn = srv, sn
    def ret_of(self, cid):
        for d in self.srv._devices.values():
            if cid in d.acked:
                return d.acked[cid]
        return None
    def send(self, cmd, timeout=8):
        cid = self.srv.next_cmd_id()
        t0 = time.monotonic()
        self.srv.enqueue_command(cid, f"C:{cid}:{cmd}", self.sn)
        acked = wait_until(lambda: self.srv.command_acked(cid), timeout)
        return cid, (self.ret_of(cid) if acked else None), time.monotonic() - t0
    def ok(self, ret):
        return ret is not None and str(ret).lstrip("-").isdigit() and int(ret) >= 0


# ── scenarios ─────────────────────────────────────────────────────────
def s_connectivity(r):
    dev = r.srv._devices.get(r.sn)
    if r.srv.device_online(r.sn):
        info = dev.info if dev else {}
        rec("connectivity/online", "PASS",
            f"{info.get('~DeviceName','?')} fw={info.get('FirmVer','?')} "
            f"locks={info.get('LockCount','?')} readers={info.get('ReaderCount','?')} "
            f"maxusers={info.get('~MaxUserCount','?')}")
    else:
        rec("connectivity/online", "FAIL", "panel not online")


def s_pollrate(r):
    n0 = r.srv.getreq_count; time.sleep(4.0)
    itv = 4.0 / max(1, r.srv.getreq_count - n0)
    rec("poll interval", "INFO", f"~{itv:.2f}s/poll")


def s_single_card(r):
    cid, ret, dt = r.send(format_user_cmd_body("9900001"))
    rec("card write (single)", "PASS" if r.ok(ret) else "FAIL",
        f"Return={ret} in {dt*1000:.0f}ms")


def s_delete_card(r):
    cid, ret, dt = r.send(f"DATA DELETE user CardNo=9900001")
    rec("card delete", "PASS" if r.ok(ret) else "FAIL", f"Return={ret}")


def s_open_door(r, door=1):
    relay0 = len(r.srv.relay_log)
    cid, ret, dt = r.send(f"CONTROL DEVICE 01{door:02X}01{3:02X}")
    fired = wait_until(lambda: len(r.srv.relay_log) > relay0 and
                       r.srv.relay_log[-1]["to"] != "000000", 5)
    st = "PASS" if r.ok(ret) and fired else ("WARN" if r.ok(ret) else "FAIL")
    rec(f"open door {door}", st,
        f"Return={ret} relay_fired={fired} in {dt*1000:.0f}ms")


def s_rapid_opens(r):
    cids = []
    for _ in range(5):
        cid = r.srv.next_cmd_id()
        r.srv.enqueue_command(cid, format_control_cmd(cid, 1, 2), r.sn)
        cids.append(cid)
    ok = wait_until(lambda: all(r.srv.command_acked(c) for c in cids), 15)
    acked = sum(1 for c in cids if r.srv.command_acked(c))
    rec("rapid opens (5)", "PASS" if acked == 5 else "WARN",
        f"{acked}/5 acked")


def s_durations(r):
    out = []
    for d in (1, 10, 254):
        cid, ret, dt = r.send(f"CONTROL DEVICE 0101{d:02X}".replace(f"{d:02X}", f"01{d:02X}"))
        out.append(f"{d}s→{ret}")
    rec("open durations 1/10/254s", "INFO", " ".join(out))


def s_batch_limit(r):
    """Find the max commands-per-poll the panel reliably executes."""
    findings = []
    best = 1
    for k in (1, 2, 3, 5, 10):
        r.srv.getreq_batch = k
        base = 20000 + k * 100
        cids = []
        for i in range(10):
            cid = r.srv.next_cmd_id()
            r.srv.enqueue_command(cid, format_user_cmd(cid, str(base + i)), r.sn)
            cids.append(cid)
        wait_until(lambda: all(r.srv.command_acked(c) for c in cids), 20)
        acked = sum(1 for c in cids if r.srv.command_acked(c))
        findings.append(f"batch={k}:{acked}/10")
        if acked == 10:
            best = k
        # cleanup these test cards
        for i in range(10):
            cid = r.srv.next_cmd_id()
            r.srv.enqueue_command(cid, format_user_delete_cmd(cid, str(base + i)), r.sn)
    r.srv.getreq_batch = 1
    allok = all(f.endswith("10/10") for f in findings)
    rec("batch-per-poll limit", "CAP",
        f"reliable up to batch={best} | {'; '.join(findings)}")
    return best


def s_throughput(r, batch):
    """Provisioning throughput: push 40 cards at the safe batch size."""
    r.srv.getreq_batch = batch
    base = 30000
    cids = []
    t0 = time.monotonic()
    for i in range(40):
        cid = r.srv.next_cmd_id()
        r.srv.enqueue_command(cid, format_user_cmd(cid, str(base + i)), r.sn)
        cids.append(cid)
    wait_until(lambda: all(r.srv.command_acked(c) for c in cids), 90)
    dt = time.monotonic() - t0
    acked = sum(1 for c in cids if r.srv.command_acked(c))
    rate = acked / dt if dt else 0
    for i in range(40):  # cleanup
        cid = r.srv.next_cmd_id()
        r.srv.enqueue_command(cid, format_user_delete_cmd(cid, str(base + i)), r.sn)
    r.srv.getreq_batch = 1
    est1000 = 1000 / rate if rate else 0
    rec("provisioning throughput", "CAP" if acked == 40 else "WARN",
        f"{acked}/40 in {dt:.1f}s = {rate:.1f} cards/s -> ~{est1000/60:.1f} min for 1000 cards")


def s_malformed(r):
    cid, ret, dt = r.send("THIS IS NOT A REAL COMMAND", timeout=5)
    # server must survive; a following valid command must still work
    cid2, ret2, _ = r.send(format_user_cmd_body("9900002"))
    r.send(f"DATA DELETE user CardNo=9900002")
    survived = r.ok(ret2)
    rec("malformed command handling", "PASS" if survived else "FAIL",
        f"bad_cmd Return={ret}; recovery={'ok' if survived else 'BROKEN'}")


def s_capabilities(r):
    """Probe which device commands are usable (Return>=0 = supported)."""
    probes = [
        ("open door 1",        "CONTROL DEVICE 01010103"),
        ("open door 2",        "CONTROL DEVICE 01020103"),
        ("aux output 1",       "CONTROL DEVICE 02010103"),
        ("cancel alarm",       "CONTROL DEVICE 03000000"),
        ("normal-open door1",  "CONTROL DEVICE 01010100"),
        ("SET OPTIONS",        "SET OPTIONS RequestDelay=1"),
        ("DATA UPDATE user",   format_user_cmd_body("9900003")),
        ("DATA DELETE user",   "DATA DELETE user CardNo=9900003"),
        ("DATA UPDATE userauthorize", "DATA UPDATE userauthorize Pin=9900003\tAuthorizeTimezoneId=1\tAuthorizeDoorId=1"),
        ("DATA QUERY user",    "DATA QUERY user"),
        ("CHECK",              "CHECK"),
        ("INFO",               "INFO"),
        ("LOG QUERY",          "LOG QUERY"),
        ("ENROLL",             "ENROLL_MF"),
        ("UNLOCK",             "AC_UNLOCK"),
        ("PING",               "PING"),
    ]
    for label, cmd in probes:
        cid, ret, dt = r.send(cmd, timeout=6)
        supported = r.ok(ret)
        rec(f"cap: {label}", "CAP",
            f"Return={ret} -> {'SUPPORTED' if supported else 'rejected/unsupported'}  [{cmd[:40]}]")


def format_user_cmd_body(card):
    # helper mirroring format_user_cmd's tail without the C:<id> prefix
    return (f"DATA UPDATE user Pin={card}\tCardNo={card}\tPassword=\tGroup=1\t"
            f"StartTime=0\tEndTime=0\tName={card}")


def drain(srv, sn, timeout=60):
    """Wait until the command queue is empty (no backlog) before the next phase."""
    def empty():
        dev = srv._devices.get(sn)
        return not dev or not dev.cmd_queue
    wait_until(empty, timeout, 0.1)


def s_priority(r):
    """Does an urgent open wait behind a bulk card sync? (No priority = yes.)"""
    for i in range(20):  # simulate a bulk sync backlog
        cid = r.srv.next_cmd_id()
        r.srv.enqueue_command(cid, format_user_cmd(cid, str(40000 + i)), r.sn)
    cid, ret, dt = r.send(format_control_cmd_body(1, 3))  # urgent open behind it
    for i in range(20):  # cleanup
        cid2 = r.srv.next_cmd_id()
        r.srv.enqueue_command(cid2, format_user_delete_cmd(cid2, str(40000 + i)), r.sn)
    rec("open latency behind 20-card sync", "WARN" if dt > 3 else "PASS",
        f"urgent open waited {dt:.1f}s behind the backlog (no command priority)")


def format_control_cmd_body(door, dur):
    return f"CONTROL DEVICE 01{door:02X}01{dur:02X}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sn", default="NDB7255000188")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--mode", default="full", choices=["full", "caps"])
    args = ap.parse_args()

    srv = C3PushServer(listen_host="0.0.0.0", listen_port=args.port,
                       serial_number=args.sn, trace=False)
    srv.start()
    log.info(f"waiting for panel {args.sn}…")
    if not wait_until(lambda: srv.device_online(args.sn), 90):
        rec("connectivity/online", "FAIL", "panel never came online in 90s")
        _report(); srv.stop(); return 1
    r = Rig(srv, args.sn)
    r.send("SET OPTIONS RequestDelay=1", timeout=6)  # speed up polling

    if args.mode == "caps":
        log.info("=== CAPABILITY DISCOVERY (isolated) ===")
        drain(srv, args.sn)
        s_capabilities(r)
        _report(); srv.stop(); return 0

    log.info("=== SCENARIOS ===")
    s_connectivity(r)
    s_pollrate(r)
    s_single_card(r)
    s_delete_card(r)
    s_open_door(r, 1)
    s_open_door(r, 2)
    s_rapid_opens(r)
    s_malformed(r)
    s_priority(r)
    best = s_batch_limit(r)
    s_throughput(r, best)
    log.info("=== CAPABILITY DISCOVERY ===")
    drain(srv, args.sn)          # clear the throughput cleanup backlog first
    s_capabilities(r)

    _report()
    srv.stop()
    return 0


def _report():
    counts = {}
    for x in RESULTS:
        counts[x["status"]] = counts.get(x["status"], 0) + 1
    log.info("=" * 64)
    log.info(f"SUMMARY: {counts}")
    fails = [x for x in RESULTS if x["status"] == "FAIL"]
    if fails:
        log.info("FAILURES:")
        for x in fails:
            log.info(f"   FAIL {x['name']}: {x['detail']}")
    with open("c3_test_report.json", "w") as f:
        json.dump({"results": RESULTS, "counts": counts}, f, indent=2)
    log.info("report -> c3_test_report.json")
    log.info("=" * 64)


if __name__ == "__main__":
    sys.exit(main())
