#!/usr/bin/env python3
"""One-command gate provisioning for a new community/apartment.

Points a ZKTeco C3 access panel at the edge's push server and verifies it
registers and can be written to — automating the manual steps we did by hand.
Ships as `provision-gate.exe` (PyInstaller) so an installer runs it with no
Python on their laptop.

Usage:
  provision-gate --panel 192.168.1.201 --password <adminpw> \
                 --edge-ip 192.168.1.50 --port 8080 --verify

  --source-ip   bind outbound to this local IP (only needed if the panel is on a
                different subnet alias; on a normal same-subnet edge, omit it)
  --verify      after configuring, start a temp push server, wait for the panel
                to register, push a test card, and confirm — end-to-end proof
  --restore-file  where to save the panel's ORIGINAL cloud-server config (so a
                  bad run is reversible). Default: panel_backup_<ip>.json
"""
import argparse, hashlib, json, sys, time

try:
    import requests, urllib3
    from requests.adapters import HTTPAdapter
    from urllib3.poolmanager import PoolManager
    urllib3.disable_warnings()
except Exception:
    print("requires 'requests' (pip install requests)"); sys.exit(2)


def make_session(source_ip):
    s = requests.Session(); s.verify = False; s.headers["Connection"] = "close"
    if source_ip:
        class SrcAdapter(HTTPAdapter):
            def init_poolmanager(self, c, m, block=False, **k):
                self.poolmanager = PoolManager(num_pools=c, maxsize=m, block=block,
                                               source_address=(source_ip, 0), **k)
        s.mount("https://", SrcAdapter())
    return s


class Panel:
    def __init__(self, ip, password, source_ip=None, user="admin"):
        self.base = f"https://{ip}"
        self.s = make_session(source_ip)
        self.user, self.password = user, password
        self.tok = None

    def login(self):
        md5 = hashlib.md5(self.password.encode()).hexdigest()
        r = self.s.post(f"{self.base}/web/api/v1/login",
                        data=json.dumps({"method": "login", "username": self.user, "password": md5}),
                        headers={"Content-Type": "application/json"}, timeout=10)
        d = r.json()
        if d.get("code") != 0:
            raise SystemExit(f"login failed: {d.get('message')} (code {d.get('code')})")
        self.tok = d["data"]["accesstoken"]

    def get_cloud(self):
        r = self.s.post(f"{self.base}/web/api/v1/param",
                        data=json.dumps({"method": "get",
                             "data": "CurWebServerMode,WebServerType,WebServerIP,WebServerPort,WebServerURL,",
                             "accesstoken": self.tok}),
                        headers={"Content-Type": "application/json"}, timeout=10)
        return r.json()["data"]

    def set_cloud(self, ip, port):
        info = (f"WebServerType=http,WebServerIP={ip},WebServerPort={port},"
                f"WebServerURL=http://{ip}:{port},CurWebServerMode=ip,")
        r = self.s.post(f"{self.base}/web/api/v1/param",
                        data=json.dumps({"method": "set", "data": info, "accesstoken": self.tok}),
                        headers={"Content-Type": "application/json"}, timeout=10)
        if r.json().get("code") != 0:
            raise SystemExit(f"set cloud server failed: {r.text[:200]}")

    def reboot(self):
        self.s.post(f"{self.base}/web/api/v1/opt",
                    data=json.dumps({"method": "reboot", "accesstoken": self.tok}),
                    headers={"Content-Type": "application/json"}, timeout=10)


def verify(port, edge_ip, test_card="9990001", wait=120):
    """Start a temp push server, wait for the panel to register + write a card."""
    # import lazily so the config-only path has no edge deps
    sys.path.insert(0, ".")
    from edge.c3_push_server import C3PushServer, format_user_cmd
    srv = C3PushServer(listen_host="0.0.0.0", listen_port=port)
    srv.start()
    print(f"  [verify] push server up on {edge_ip}:{port}; waiting for panel to dial in…")
    t0 = time.time()
    while time.time() - t0 < wait:
        if srv._devices and any(srv.device_online(sn) for sn in srv._devices):
            break
        time.sleep(1)
    else:
        srv.stop(); return False, "panel never registered (check its Cloud Server setting / firewall)"
    sn = next(iter(srv._devices))
    cid = srv.next_cmd_id()
    srv.enqueue_command(cid, format_user_cmd(cid, test_card), sn)
    ok = False
    t0 = time.time()
    while time.time() - t0 < 20:
        if srv.command_acked(cid):
            ok = True; break
        time.sleep(0.2)
    # remove the test card again
    from edge.c3_push_server import format_user_delete_cmd
    cid2 = srv.next_cmd_id()
    srv.enqueue_command(cid2, format_user_delete_cmd(cid2, test_card), sn)
    time.sleep(2)
    srv.stop()
    return ok, f"panel SN={sn} registered; test card write ack={'OK' if ok else 'FAILED'}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--panel", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--edge-ip", required=True)
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--source-ip", default=None)
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--no-reboot", action="store_true")
    ap.add_argument("--restore-file", default=None)
    args = ap.parse_args()

    print(f"[1/5] Logging into panel {args.panel} …")
    p = Panel(args.panel, args.password, args.source_ip)
    p.login()
    print("      OK")

    print("[2/5] Backing up current cloud-server config …")
    orig = p.get_cloud()
    backup = args.restore_file or f"panel_backup_{args.panel.replace('.','_')}.json"
    with open(backup, "w") as f:
        json.dump(orig, f, indent=2)
    print(f"      saved -> {backup}   (was {orig.get('WebServerURL','?')})")

    print(f"[3/5] Pointing panel at edge {args.edge_ip}:{args.port} (HTTP) …")
    p.set_cloud(args.edge_ip, args.port)
    print(f"      set. read-back: {p.get_cloud().get('WebServerURL')}")

    if not args.no_reboot:
        print("[4/5] Rebooting panel to apply (≈30–60s) …")
        p.reboot()
    else:
        print("[4/5] Skipping reboot (--no-reboot) — change applies on next panel restart")

    if args.verify:
        print("[5/5] Verifying end-to-end (register + card write) …")
        ok, msg = verify(args.port, args.edge_ip)
        print(f"      {msg}")
        print("\n" + ("✅ PROVISIONED — panel is talking to the edge and accepts card writes."
                      if ok else "⚠  Configured, but verification did not complete — see message above."))
        return 0 if ok else 1
    else:
        print("[5/5] Skipped verification (--verify to run it)")
        print("\n✅ Panel configured. Start the edge (USE_C3_PUSH=true) and it will register.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
