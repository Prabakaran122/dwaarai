#!/usr/bin/env python3
"""Live gate/device console for the real C3 over the push protocol.

Runs TWO servers in one process:
  - the C3 push server on :8080 (the panel dials into this)
  - a local web dashboard on :8090 (open http://localhost:8090 in a browser)

The dashboard shows the real device's status, its live request feed, relay
state, command ACKs and tap events — and has buttons to fire tests (push a
card, open the door, change poll rate). Everything you or I trigger flows
through the same server, so both appear live on the page.
"""
import argparse, json, sys, time, logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout),
              logging.FileHandler("c3_push_capture.log", mode="a")])
log = logging.getLogger("console")

from edge.c3_push_server import C3PushServer, format_user_cmd, format_control_cmd

SRV = None
_rate = {"t": time.monotonic(), "n": 0, "rate": 0.0}


def state_json():
    sn = SRV.serial_number
    dev = SRV._devices.get(sn)
    now = time.monotonic()
    dn = SRV.getreq_count - _rate["n"]; dt = now - _rate["t"]
    if dt >= 0.8:
        _rate["rate"] = round(dn / dt, 2) if dt else 0.0
        _rate["t"] = now; _rate["n"] = SRV.getreq_count
    info = dev.info if dev else {}
    return {
        "online": SRV.device_online(sn),
        "registered": bool(dev and dev.registered),
        "sn": sn,
        "model": info.get("~DeviceName", "—"),
        "fw": info.get("FirmVer", "—"),
        "push": info.get("PushVersion", "—"),
        "ip": info.get("IPAddress", "—"),
        "locks": info.get("LockCount", "—"),
        "readers": info.get("ReaderCount", "—"),
        "poll_count": SRV.getreq_count,
        "poll_rate": _rate["rate"],
        "relay_now": (dev.last_relay if dev else "") or "000000",
        "queued": len(dev.cmd_queue) if dev else 0,
        "cards": len(dev.users) if dev else 0,
        "recent": list(SRV.recent)[-45:][::-1],
        "events": list(SRV.event_log)[-30:][::-1],
        "relay": list(SRV.relay_log)[-20:][::-1],
        "acks": list(SRV.ack_log)[-30:][::-1],
    }


def enqueue(make_cmd):
    sn = SRV.serial_number
    cid = SRV.next_cmd_id()
    wire = make_cmd(cid)
    SRV.enqueue_command(cid, wire, sn)
    log.info(f"console queued cmd {cid}: {wire!r}")
    return {"cid": cid, "wire": wire}


PAGE = r"""<!doctype html><html><head><meta charset="utf-8">
<title>CommunityGate · C3 Console</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 :root{--bg:#0d1117;--card:#161b22;--bd:#30363d;--fg:#e6edf3;--mut:#8b949e;
   --grn:#3fb950;--red:#f85149;--amb:#d29922;--blu:#58a6ff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
   font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}
 header{display:flex;align-items:center;gap:16px;padding:14px 20px;
   border-bottom:1px solid var(--bd);background:var(--card);position:sticky;top:0;z-index:5}
 h1{font-size:16px;margin:0;font-weight:600}
 .pill{padding:4px 12px;border-radius:20px;font-weight:600;font-size:13px}
 .on{background:rgba(63,185,80,.15);color:var(--grn);border:1px solid var(--grn)}
 .off{background:rgba(248,81,73,.15);color:var(--red);border:1px solid var(--red)}
 .meta{color:var(--mut);font-size:12px;margin-left:auto;text-align:right}
 .wrap{display:grid;grid-template-columns:300px 1fr 1fr;gap:14px;padding:16px}
 .card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:14px;min-height:120px}
 .card h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin:0 0 10px}
 .kv{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #21262d;font-size:13px}
 .kv b{color:var(--fg);font-weight:600}.kv span{color:var(--mut)}
 button{width:100%;padding:10px;margin:6px 0;border-radius:8px;border:1px solid var(--bd);
   background:#21262d;color:var(--fg);font-size:14px;cursor:pointer;font-weight:600}
 button:hover{border-color:var(--blu)}
 button.grn{background:rgba(63,185,80,.15);border-color:var(--grn);color:var(--grn)}
 button.amb{background:rgba(210,153,34,.15);border-color:var(--amb);color:var(--amb)}
 input{width:100%;padding:8px;margin:4px 0 8px;border-radius:6px;border:1px solid var(--bd);
   background:#0d1117;color:var(--fg)}
 .feed{font-family:ui-monospace,Consolas,monospace;font-size:12px;max-height:340px;overflow:auto}
 .row{padding:4px 6px;border-bottom:1px solid #21262d;display:flex;gap:8px}
 .row:first-child{background:rgba(88,166,255,.06)}
 .t{color:var(--mut)}.g{color:var(--grn)}.r{color:var(--red)}.b{color:var(--blu)}.a{color:var(--amb)}
 .relaybox{font-family:ui-monospace,monospace;font-size:22px;letter-spacing:4px;text-align:center;padding:10px}
 .lit{color:var(--grn);text-shadow:0 0 8px var(--grn)}
 .full{grid-column:1/-1}
</style></head><body>
<header>
 <h1>CommunityGate · C3 Console</h1>
 <span id="status" class="pill off">—</span>
 <span id="relaypill" class="pill" style="border:1px solid var(--bd);color:var(--mut)">relay 000000</span>
 <div class="meta" id="meta"></div>
</header>
<div class="wrap">
 <div class="card">
  <h2>Device</h2>
  <div id="dev"></div>
 </div>
 <div class="card">
  <h2>Run a test</h2>
  <label>Card number</label><input id="card" value="7654321">
  <button class="grn" onclick="pushCard()">＋ Push card to panel</button>
  <hr style="border-color:#21262d">
  <label>Open duration (s)</label><input id="dur" value="3">
  <button class="amb" onclick="openDoor()">⎇ Open door · fire relay</button>
  <hr style="border-color:#21262d">
  <label>RequestDelay (poll interval, s)</label><input id="rd" value="1">
  <button onclick="setRd()">⟳ Set poll rate</button>
  <div id="lastcmd" style="margin-top:10px;font-family:monospace;font-size:12px;color:var(--mut)"></div>
 </div>
 <div class="card">
  <h2>Relay output (boom-barrier port)</h2>
  <div class="relaybox" id="relaybig">000000</div>
  <div style="color:var(--mut);font-size:12px;text-align:center">bit flips to non-zero when the door relay energizes</div>
  <h2 style="margin-top:14px">Relay transitions</h2>
  <div class="feed" id="relayfeed" style="max-height:140px"></div>
 </div>
 <div class="card">
  <h2>Command ACKs (device → us)</h2>
  <div class="feed" id="acks"></div>
 </div>
 <div class="card">
  <h2>Tap events (rtlog)</h2>
  <div class="feed" id="events"></div>
 </div>
 <div class="card">
  <h2>Live request feed (device → us)</h2>
  <div class="feed" id="feed"></div>
 </div>
</div>
<script>
async function post(u,b){const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});return r.json();}
function lc(o){document.getElementById('lastcmd').textContent='queued #'+o.cid+': '+o.wire;}
async function pushCard(){lc(await post('/api/card',{card:document.getElementById('card').value}));}
async function openDoor(){lc(await post('/api/open',{duration:+document.getElementById('dur').value}));}
async function setRd(){lc(await post('/api/reqdelay',{delay:+document.getElementById('rd').value}));}
function esc(s){return (''+s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
async function tick(){
 let s; try{s=await (await fetch('/api/state')).json();}catch(e){return;}
 const st=document.getElementById('status');
 st.textContent=s.online?'● ONLINE':'○ OFFLINE';st.className='pill '+(s.online?'on':'off');
 document.getElementById('meta').innerHTML='poll '+s.poll_rate+'/s · '+s.poll_count+' polls · '+s.queued+' queued';
 document.getElementById('dev').innerHTML=
  kv('Model',s.model)+kv('Serial',s.sn)+kv('Firmware',s.fw)+kv('Push ver',s.push)+
  kv('IP',s.ip)+kv('Locks',s.locks)+kv('Readers',s.readers)+
  kv('Registered',s.registered?'yes':'no')+kv('Cards pushed',s.cards);
 const rp=document.getElementById('relaypill');
 rp.textContent='relay '+s.relay_now;
 const lit=s.relay_now && s.relay_now!=='000000';
 rp.style.color=lit?'var(--grn)':'var(--mut)';
 const rb=document.getElementById('relaybig');rb.textContent=s.relay_now;rb.className='relaybox'+(lit?' lit':'');
 document.getElementById('feed').innerHTML=s.recent.map(r=>{
   const c=r.path.includes('getrequest')?'t':(r.path.includes('registry')?'a':(r.path.includes('devicecmd')?'b':'g'));
   return '<div class="row"><span class="t">'+r.ts+'</span><span class="'+c+'">'+r.method+'</span><span>'+esc(r.path)+'</span>'+(r.blen?'<span class="t">·'+r.blen+'b</span>':'')+'</div>';
 }).join('');
 document.getElementById('acks').innerHTML=s.acks.map(a=>{
   const ok=(+a.return)>=0;
   return '<div class="row"><span class="t">'+a.ts+'</span><span class="b">#'+a.id+'</span><span>'+esc(a.cmd)+'</span><span class="'+(ok?'g':'r')+'">Return='+a.return+'</span></div>';
 }).join('')||'<div class="row t">no commands yet — click a test button</div>';
 document.getElementById('events').innerHTML=s.events.map(e=>{
   const ok=e.event_type==='allow';
   return '<div class="row"><span class="t">'+esc(e.timestamp)+'</span><span class="b">card '+esc(e.card_number)+'</span><span class="'+(ok?'g':'r')+'">'+e.event_type+'</span><span class="t">evt='+e.event_code+'</span></div>';
 }).join('')||'<div class="row t">no taps yet — tap a card at the reader</div>';
 document.getElementById('relayfeed').innerHTML=s.relay.map(r=>
   '<div class="row"><span class="t">'+r.ts+'</span><span>'+r.from+'</span><span class="b">→</span><span class="'+(r.to!=='000000'?'g':'t')+'">'+r.to+'</span></div>'
 ).join('')||'<div class="row t">no relay changes yet</div>';
}
function kv(k,v){return '<div class="kv"><span>'+k+'</span><b>'+esc(v)+'</b></div>';}
setInterval(tick,1000);tick();
</script></body></html>"""


class Dash(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        p = urlparse(self.path).path
        if p in ("/", "/index.html"):
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif p == "/api/state":
            self._send(200, json.dumps(state_json()))
        elif p == "/api/uploads":
            self._send(200, json.dumps(list(SRV.data_upload)))
        else:
            self._send(404, "{}")

    def do_POST(self):
        p = urlparse(self.path).path
        n = int(self.headers.get("Content-Length", 0) or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            body = {}
        if p == "/api/card":
            card = str(body.get("card", "")).strip() or "7654321"
            self._send(200, json.dumps(enqueue(lambda cid: format_user_cmd(cid, card))))
        elif p == "/api/open":
            dur = int(body.get("duration", 3))
            self._send(200, json.dumps(enqueue(lambda cid: format_control_cmd(cid, 1, dur))))
        elif p == "/api/reqdelay":
            d = int(body.get("delay", 1))
            self._send(200, json.dumps(enqueue(lambda cid: f"C:{cid}:SET OPTIONS RequestDelay={d}")))
        elif p == "/api/raw":
            cmd = str(body.get("cmd", "")).strip()
            self._send(200, json.dumps(enqueue(lambda cid: f"C:{cid}:{cmd}")))
        else:
            self._send(404, "{}")


def main():
    global SRV
    ap = argparse.ArgumentParser()
    ap.add_argument("--sn", default="NDB7255000188")
    ap.add_argument("--device-port", type=int, default=8080)
    ap.add_argument("--web-port", type=int, default=8090)
    args = ap.parse_args()

    SRV = C3PushServer(listen_host="0.0.0.0", listen_port=args.device_port,
                       serial_number=args.sn, trace=True)
    SRV.start()
    _rate["n"] = SRV.getreq_count

    dash = ThreadingHTTPServer(("127.0.0.1", args.web_port), Dash)
    dash.daemon_threads = True
    print("=" * 60)
    print(f"  C3 push server (device)  : 0.0.0.0:{args.device_port}")
    print(f"  OPEN THE CONSOLE  ->  http://localhost:{args.web_port}")
    print("=" * 60, flush=True)
    try:
        dash.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        SRV.stop()


if __name__ == "__main__":
    main()
