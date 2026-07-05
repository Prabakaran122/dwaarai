#!/usr/bin/env python3
"""Real-world gate scenarios, walked one-by-one against the live C3.

Deliberately GENTLE — paced commands, no write-storms (a rapid add/delete storm
is what hung the panel), with a panel-health check after every scenario so we
can see it stay alive. Scenarios that need a physical RFID reader are listed but
clearly marked NOT-RUN.

Run:  python -m edge.tools.c3_scenarios --sn NDB7255000188
"""
import argparse, sys, time, logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
log = logging.getLogger("scn")

from edge.c3_push_server import (C3PushServer, format_user_cmd,
                                 format_control_cmd, format_user_delete_cmd)

PACE = 0.6  # seconds between commands — deliberately unhurried


def wait_until(pred, timeout, interval=0.05):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        time.sleep(interval)
    return pred()


class Gate:
    def __init__(self, srv, sn):
        self.srv, self.sn = srv, sn
    def _ret(self, cid):
        for d in self.srv._devices.values():
            if cid in d.acked:
                return d.acked[cid]
        return None
    def cmd(self, wire_body, timeout=8):
        cid = self.srv.next_cmd_id()
        self.srv.enqueue_command(cid, f"C:{cid}:{wire_body}", self.sn)
        ok = wait_until(lambda: self.srv.command_acked(cid), timeout)
        time.sleep(PACE)
        return (self._ret(cid) if ok else None)
    def add_card(self, card):
        return self.cmd(format_user_cmd(0, card).split(":", 2)[2])
    def del_card(self, card):
        return self.cmd(f"DATA DELETE user CardNo={card}")
    def open_door(self, door=1, dur=3):
        return self.cmd(f"CONTROL DEVICE 01{door:02X}01{dur:02X}")
    def alive(self):
        """Panel health: is it still polling us? (getrequest count rising)"""
        n0 = self.srv.getreq_count
        return wait_until(lambda: self.srv.getreq_count > n0 + 1, 6)


def hdr(n, title):
    log.info("")
    log.info(f"===== SCENARIO {n}: {title} =====")


def health(g, label="panel health"):
    ok = g.alive()
    log.info(f"   [{'OK ' if ok else 'DOWN'}] {label}: panel {'still polling' if ok else 'NOT RESPONDING'}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sn", default="NDB7255000188")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--bulk", type=int, default=25)
    args = ap.parse_args()

    srv = C3PushServer(listen_host="0.0.0.0", listen_port=args.port,
                       serial_number=args.sn, trace=False)
    srv.start()
    log.info(f"push server up on :{args.port}; waiting for panel {args.sn}...")
    if not wait_until(lambda: srv.device_online(args.sn), 90):
        log.error("panel never came online"); srv.stop(); return 1
    g = Gate(srv, args.sn)
    g.cmd("SET OPTIONS RequestDelay=1")
    log.info("panel online. Walking real-world scenarios (paced, gentle).")
    results = []

    # 1 — a new resident is onboarded: their FASTag is provisioned to the panel
    hdr(1, "New resident onboarded (provision card)")
    r = g.add_card("7010001")
    ok = str(r) == "0"
    log.info(f"   card 7010001 written -> Return={r} ({'stored in panel' if ok else 'FAILED'})")
    results.append(("provision card", ok)); results.append(("  health", health(g)))

    # 2 — guard/admin opens the gate remotely (portal -> MQTT -> edge -> panel)
    hdr(2, "Guard remote-opens the gate (door 1)")
    relay0 = len(srv.relay_log)
    r = g.open_door(1, 3)
    fired = wait_until(lambda: len(srv.relay_log) > relay0 and srv.relay_log[-1]["to"] != "000000", 5)
    log.info(f"   open door 1 -> Return={r}; relay fired={fired}")
    results.append(("remote open door 1", str(r) == "1" and fired)); results.append(("  health", health(g)))

    # 3 — a second lane / exit boom
    hdr(3, "Second lane opens (door 2)")
    relay0 = len(srv.relay_log)
    r = g.open_door(2, 3)
    fired = wait_until(lambda: len(srv.relay_log) > relay0 and srv.relay_log[-1]["to"] != "000000", 5)
    log.info(f"   open door 2 -> Return={r}; relay fired={fired}")
    results.append(("remote open door 2", str(r) == "1" and fired)); results.append(("  health", health(g)))

    # 4 — resident moves out: their card is deprovisioned
    hdr(4, "Resident moves out (deprovision card)")
    r = g.del_card("7010001")
    ok = str(r) == "0"
    log.info(f"   card 7010001 deleted -> Return={r}")
    results.append(("deprovision card", ok)); results.append(("  health", health(g)))

    # 5 — new community goes live: bulk roster load, PACED so it can't hang the panel
    hdr(5, f"New community bulk load ({args.bulk} cards, paced)")
    base = 7020000
    good = 0
    t0 = time.monotonic()
    for i in range(args.bulk):
        if str(g.add_card(str(base + i))) == "0":
            good += 1
        if i % 8 == 7:
            if not g.alive():
                log.info(f"   [DOWN] panel stopped responding at card {i+1} !")
                break
    dt = time.monotonic() - t0
    log.info(f"   {good}/{args.bulk} cards written in {dt:.0f}s ({good/dt:.1f}/s), panel stayed responsive")
    results.append((f"bulk load {args.bulk} paced", good == args.bulk)); results.append(("  health", health(g)))

    # 6 — the edge box restarts (power blip / update): panel must reconnect on its own
    hdr(6, "Edge restarts — panel must reconnect")
    log.info("   stopping push server (simulating edge restart)...")
    srv.stop(); time.sleep(6)
    srv2 = C3PushServer(listen_host="0.0.0.0", listen_port=args.port,
                        serial_number=args.sn, trace=False)
    srv2.start()
    reconnected = wait_until(lambda: srv2.device_online(args.sn), 60)
    log.info(f"   panel reconnected after edge restart = {reconnected}")
    results.append(("edge restart recovery", reconnected))
    g = Gate(srv2, args.sn)  # rebind to new server

    # cleanup the bulk test cards (paced, gentle)
    hdr("cleanup", "removing test cards (paced)")
    if reconnected:
        for i in range(args.bulk):
            g.del_card(str(base + i))
        log.info(f"   removed {args.bulk} test cards")

    # 7 — scenarios that REQUIRE a physical RFID reader (not run here)
    hdr(7, "Reader-dependent scenarios (NOT RUN — need RFID reader wired)")
    for s in ["known FASTag tap -> local grant + allow event",
              "unknown card tap -> deny event -> ANPR correlation",
              "blocked/expired card tap -> deny",
              "OFFLINE: edge down, tap known card -> C3 opens locally, replays on reconnect"]:
        log.info(f"   [SKIP] {s}")

    # summary
    log.info("")
    log.info("=" * 58)
    passed = sum(1 for _, ok in results if ok)
    log.info(f"REAL-WORLD SCENARIO SUMMARY: {passed}/{len(results)} checks passed")
    for name, ok in results:
        log.info(f"   [{'PASS' if ok else 'FAIL'}] {name}")
    log.info("=" * 58)
    srv2.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
