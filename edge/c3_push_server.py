"""ZKTeco C3 **Push protocol** server (edge-hosted).

The vendor "C# Access Push Demo" is NOT a linkable library — it is a Windows
reference *server* for ZKTeco's Push protocol: plain HTTP over TCP/IP in which
the **device dials out to us**. This module is the Python re-implementation of
that server role, meant to run on the edge Pi on the same LAN as the C3.

Why we want it: the PULL library (`zkaccess-c3`) cannot write the panel's user
table, so `sync_cards`/`add_card` are no-ops today (see c3_controller.py). In
Push mode the panel pulls `DATA UPDATE user` commands from us — so card
provisioning finally works from code.

Roles reversed vs PULL:
    PULL  — Pi opens TCP:4370 to the C3, polls RT log.
    PUSH  — C3 opens HTTP to *this* server; we buffer its events and hand it
            queued commands when it polls.

Endpoints (ZKTeco push protocol shape):
    GET  /iclock/cdata?SN=..&options=all   handshake / registration
    POST /iclock/cdata?SN=..&table=rtlog   device uploads realtime events
    GET  /iclock/getrequest?SN=..          device polls for queued commands
    POST /iclock/devicecmd?SN=..           device reports command results

WIRE-FORMAT NOTE: the exact byte-level record/command encoding of a specific C3
firmware must be confirmed against ZKTeco's "Access Control Push Protocol" spec
or a traffic capture. To keep that a *localized* change, every format-specific
bit lives in the small helpers at the bottom (`format_control_cmd`,
`format_user_cmd`, `format_user_delete_cmd`, `parse_rtlog_line`). The transport,
queueing and buffering around them are format-independent and already correct.
"""
import time, threading, logging, itertools, hashlib, collections
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

log = logging.getLogger("c3_push_server")

# Seconds without a device check-in after which we consider the panel offline.
DEVICE_TIMEOUT = 30.0

# Command reliability: re-hand a command if the panel doesn't ACK it within
# ACK_TIMEOUT; give up (and log a failure) once it's older than CMD_TTL or after
# MAX_TRIES. A lost 'open' must retry, but a very stale one must not fire late.
ACK_TIMEOUT = 4.0
CMD_TTL = 60.0
MAX_TRIES = 5
PRIO_CONTROL = 10   # door open / relay — jump ahead of bulk data
PRIO_DATA = 0       # card writes / roster sync


class _DeviceState:
    """Per-serial-number command queue + liveness, owned by the server."""
    def __init__(self, sn: str):
        self.sn = sn
        self.last_seen = 0.0
        # Pending commands: each is a dict {id, cmd, enq, tries, prio}. Higher
        # prio (control/open) is handed out before data (bulk card sync).
        self.cmd_queue: list[dict] = []
        # Commands handed to the panel but not yet ACKed — reaped/retried if the
        # panel drops them (a lost 'open' must not be silently forgotten).
        self.in_flight: dict[int, dict] = {}
        self.acked: dict[int, str] = {}              # cmd_id -> return code
        self.users: set[str] = set()                 # mirror of pushed card table
        self.registered = False                      # completed the registry handshake
        self.registry_code = ""                      # server-assigned RegistryCode
        self.info: dict[str, str] = {}               # device info from /iclock/registry
        self.last_relay = ""                         # last relay bitmask seen in rtstate
        self.last_alarm = "0000"                     # last alarm bitmask seen
        self.state: dict = {}                        # latest decoded rtstate (health)


class C3PushServer:
    """Owns the HTTP listener and the shared event buffer + command queues.

    Thread-safe. One instance can serve multiple panels keyed by SN, but the
    edge runs one panel per gate so `serial_number` scopes commands/status.
    """

    def __init__(self, listen_host: str = "0.0.0.0", listen_port: int = 8080,
                 serial_number: str = "", trace: bool = False):
        self.listen_host = listen_host
        self.listen_port = listen_port
        self.serial_number = serial_number
        self.trace = trace  # log every raw request (wire-format capture)
        self.getreq_count = 0  # total /iclock/getrequest polls (poll-rate metric)
        # Observability ring buffers for the live console (read-only snapshots).
        self.recent = collections.deque(maxlen=300)      # request feed
        self.event_log = collections.deque(maxlen=100)   # parsed tap events
        self.relay_log = collections.deque(maxlen=50)    # relay state transitions
        self.ack_log = collections.deque(maxlen=100)     # command ACKs
        self.data_upload = collections.deque(maxlen=2000)  # DATA QUERY uploads (table rows)
        self.last_device_time = ""  # panel clock, from the time= field it uploads
        self.getreq_batch = 1  # commands handed per getrequest poll (1 = safe default)
        # rtlog de-dup: the panel REPLAYS buffered events on reconnect (and can
        # repeat a frame within one POST). Skip already-seen events so we never
        # double-open / double-log. Keyed by SN|index|time|card.
        self._event_keys = collections.deque(maxlen=5000)
        self._event_key_set = set()
        self._events: list[dict] = []
        self._devices: dict[str, _DeviceState] = {}
        self._lock = threading.Lock()
        self._cmd_ids = itertools.count(1)
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    # ── lifecycle ─────────────────────────────────────────────────────
    def start(self) -> int:
        """Bind and serve in a background thread. Returns the bound port
        (useful when listen_port=0 asks the OS for an ephemeral port)."""
        server = self  # closure handle for the handler
        handler = _make_handler(server)
        self._httpd = ThreadingHTTPServer((self.listen_host, self.listen_port), handler)
        # HTTP/1.1 keep-alive leaves a handler thread blocked on the persistent
        # connection. Python 3.12's ThreadingMixIn joins those on server_close()
        # (block_on_close=True) → shutdown hangs forever. Make handler threads
        # daemon and don't join them on close; shutdown() stops the accept loop
        # and the OS reaps the idle sockets.
        self._httpd.daemon_threads = True
        self._httpd.block_on_close = False
        self.listen_port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever,
                                        name="c3-push-http", daemon=True)
        self._thread.start()
        log.info(f"C3 push server listening on {self.listen_host}:{self.listen_port}")
        return self.listen_port

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        log.info("C3 push server stopped")

    def is_running(self) -> bool:
        return self._httpd is not None

    # ── device liveness ───────────────────────────────────────────────
    def _ensure_device(self, sn: str) -> _DeviceState:
        """Get/create the device slot WITHOUT marking it seen (used when we
        queue a command before the panel has ever checked in)."""
        dev = self._devices.get(sn)
        if dev is None:
            dev = _DeviceState(sn)
            self._devices[sn] = dev
            log.info(f"C3 device slot created: SN={sn}")
        return dev

    def _touch(self, sn: str) -> _DeviceState:
        """Get/create the device slot AND stamp liveness (a real check-in)."""
        dev = self._ensure_device(sn)
        if not dev.last_seen:
            log.info(f"C3 device checked in: SN={sn}")
        dev.last_seen = time.time()
        return dev

    def _device_online_locked(self, sn: str) -> bool:
        """Liveness check assuming the caller already holds self._lock."""
        dev = self._devices.get(sn)
        if dev is None and not sn:
            # No SN filter configured — treat "any device seen recently" as online.
            dev = max(self._devices.values(), key=lambda d: d.last_seen, default=None)
        if dev is None:
            return False
        return (time.time() - dev.last_seen) < DEVICE_TIMEOUT

    def device_online(self, sn: str = "") -> bool:
        sn = sn or self.serial_number
        with self._lock:
            return self._device_online_locked(sn)

    def seconds_since_seen(self, sn: str = "") -> float:
        """How long since the panel last contacted us (inf if never)."""
        sn = sn or self.serial_number
        with self._lock:
            dev = self._devices.get(sn)
            if dev is None or not dev.last_seen:
                return float("inf")
            return time.time() - dev.last_seen

    def queue_depth(self, sn: str = "") -> int:
        """Outstanding work = queued + in-flight (not yet ACKed)."""
        sn = sn or self.serial_number
        with self._lock:
            dev = self._devices.get(sn)
            return (len(dev.cmd_queue) + len(dev.in_flight)) if dev else 0

    def panel_state(self, sn: str = "") -> dict:
        """Latest decoded rtstate (door/relay/alarm/sensor) for health/monitoring."""
        sn = sn or self.serial_number
        with self._lock:
            dev = self._devices.get(sn)
            return dict(dev.state) if dev else {}

    # ── command queue (called by the controller) ──────────────────────
    def next_cmd_id(self) -> int:
        """Mint a command id. The controller bakes this same id into the
        wire line (C:<id>:...) so the panel's ack correlates to the queue."""
        return next(self._cmd_ids)

    def enqueue_command(self, cmd_id: int, command: str, sn: str = "",
                        priority: int = None) -> int:
        sn = sn or self.serial_number
        # Control/open commands outrank bulk data so an urgent open never queues
        # behind a big roster sync.
        if priority is None:
            priority = PRIO_CONTROL if "CONTROL DEVICE" in command else PRIO_DATA
        with self._lock:
            dev = self._ensure_device(sn)   # queue without faking a check-in
            dev.cmd_queue.append({"id": cmd_id, "cmd": command, "enq": time.time(),
                                  "tries": 0, "prio": priority})
            # Track the intended card roster here (the device ACK doesn't echo
            # CardNo, so this is the reliable source of the pushed-card count).
            if "DATA UPDATE user" in command or "DATA DELETE user" in command:
                card = ""
                for tok in command.replace("\t", " ").split():
                    if tok.startswith("CardNo="):
                        card = tok.split("=", 1)[1]
                if card:
                    dev.users.discard(card) if "DELETE" in command else dev.users.add(card)
        log.debug(f"queued cmd {cmd_id} (prio {priority}) for {sn}: {command}")
        return cmd_id

    def command_acked(self, cmd_id: int) -> bool:
        with self._lock:
            for dev in self._devices.values():
                if cmd_id in dev.acked:
                    return True
        return False

    # ── event buffer (called by the controller) ───────────────────────
    def drain_events(self) -> list[dict]:
        with self._lock:
            out = self._events
            self._events = []
        return out

    def status(self, sn: str = "") -> dict:
        sn = sn or self.serial_number
        with self._lock:
            dev = self._devices.get(sn)
            return {
                "running": self.is_running(),
                "listen_port": self.listen_port,
                "serial_number": sn,
                "device_online": self._device_online_locked(sn),  # already hold _lock
                "queued_commands": len(dev.cmd_queue) if dev else 0,
                "card_count": len(dev.users) if dev else 0,
            }

    # ── internal: handler callbacks (hold the lock) ───────────────────
    # Registration handshake per ZKTeco Security PUSH spec, verified against a
    # real C3-200 Plus (FW AC Ver 19.0.18, PushVersion 2.0.34):
    #   1. GET  /iclock/cdata?options=all  -> "OK"
    #   2. POST /iclock/registry           -> "RegistryCode=<code>"
    #   3. POST /iclock/push               -> config block (ServerVersion/Delay/…)
    #   4. GET  /iclock/getrequest         -> queued commands
    def _handle_registry(self, sn: str) -> bytes:
        """GET /iclock/cdata?options=all — initial ping. Server replies OK;
        registration proper happens at POST /iclock/registry."""
        with self._lock:
            self._touch(sn)
        return b"OK\r\n"

    def _handle_registry_post(self, sn: str, body: str) -> bytes:
        """POST /iclock/registry — device sends its capabilities. Reply with a
        server-assigned RegistryCode; this is what completes registration."""
        with self._lock:
            dev = self._touch(sn)
            for kv in body.split(","):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    dev.info[k] = v
            if not dev.registry_code:
                dev.registry_code = hashlib.md5(sn.encode()).hexdigest()[:16]
            dev.registered = True
            code = dev.registry_code
        log.info(f"C3 registered: SN={sn} model={dev.info.get('~DeviceName','?')} "
                 f"fw={dev.info.get('FirmVer','?')} code={code}")
        return f"RegistryCode={code}\r\n".encode()

    def _handle_push(self, sn: str, body: str) -> bytes:
        """POST /iclock/push — device downloads its runtime config after
        registering. RequestDelay drives how often it polls /iclock/getrequest."""
        with self._lock:
            self._touch(sn)
        return ("ServerVersion=2.0.34\r\nServerName=CommunityGate\r\n"
                "ErrorDelay=10\r\nRequestDelay=1\r\n"
                "TransTimes=00:00;23:59\r\nTransInterval=1\r\nTransFlag=1111111111\r\n"
                "Realtime=1\r\nTimeZone=8\r\nEncrypt=0\r\n").encode()

    def _handle_getrequest(self, sn: str) -> bytes:
        with self._lock:
            self.getreq_count += 1
            dev = self._touch(sn)
            self._reap_in_flight(dev)          # retry/drop commands the panel lost
            if not dev.cmd_queue:
                return b"OK\r\n"
            # Priority first (control/open ahead of bulk data), then FIFO. Hand
            # out up to getreq_batch (default 1 — larger batches drop on real HW).
            dev.cmd_queue.sort(key=lambda c: (-c["prio"], c["enq"]))
            n = min(max(1, self.getreq_batch), len(dev.cmd_queue))
            now = time.time()
            lines = []
            for _ in range(n):
                c = dev.cmd_queue.pop(0)
                c["sent"] = now
                dev.in_flight[c["id"]] = c     # await ACK; reaped if it never comes
                lines.append(c["cmd"])
        return ("\r\n".join(lines) + "\r\n").encode()

    def _reap_in_flight(self, dev):
        """Retry commands the panel hasn't ACKed within ACK_TIMEOUT; give up on
        ones past CMD_TTL / MAX_TRIES (marking them failed so waiters unblock).
        Caller holds self._lock."""
        now = time.time()
        for cid, c in list(dev.in_flight.items()):
            if now - c.get("sent", now) < ACK_TIMEOUT:
                continue
            del dev.in_flight[cid]
            if now - c["enq"] > CMD_TTL or c["tries"] >= MAX_TRIES:
                log.warning(f"command {cid} FAILED (no ACK, tries={c['tries']}): {c['cmd'][:60]}")
                dev.acked.setdefault(cid, "-1")   # terminal — unblock any waiter
                self.ack_log.append({"ts": time.strftime("%H:%M:%S"), "id": cid,
                                     "return": "TIMEOUT", "cmd": c["cmd"][:40]})
            else:
                c["tries"] += 1
                dev.cmd_queue.append(c)           # re-hand on a future poll
                log.info(f"command {cid} not ACKed — retry {c['tries']}")

    def _handle_cdata_post(self, sn: str, table: str, body: str) -> bytes:
        with self._lock:
            dev = self._touch(sn)
        # Capture the panel's own clock from any record it uploads (time=...).
        for _line in body.splitlines():
            for _tok in _line.split("\t"):
                if _tok.startswith("time="):
                    self.last_device_time = _tok[5:].strip()
                    break
            else:
                continue
            break
        t = table.lower()
        if t == "rtlog":
            fresh = []
            with self._lock:
                for line in body.splitlines():
                    if not line.strip():
                        continue
                    evt = parse_rtlog_line(line)
                    if not evt:
                        continue
                    key = f"{sn}|{evt.get('index','')}|{evt['timestamp']}|{evt['card_number']}"
                    if key in self._event_key_set:
                        continue                       # duplicate — replayed frame
                    if len(self._event_keys) == self._event_keys.maxlen:
                        self._event_key_set.discard(self._event_keys[0])
                    self._event_keys.append(key)
                    self._event_key_set.add(key)
                    fresh.append(evt)
                if fresh:
                    self._events.extend(fresh)
                    self.event_log.extend(fresh)       # display buffer (not drained)
            if fresh:
                log.debug(f"buffered {len(fresh)} new event(s) from {sn}")
        elif t == "attlog":
            # Attendance/access log some biometric terminals (SpeedFace-V5L) push
            # instead of key=value rtlog. Positional TSV: pin, time, status,
            # verify, workcode, ... — turn each into a person-verify event.
            fresh = []
            with self._lock:
                for line in body.splitlines():
                    parts = line.split("\t")
                    if len(parts) < 2 or not parts[0].strip():
                        continue
                    pin = parts[0].strip()
                    ts = parts[1].strip()
                    verify = parts[3].strip() if len(parts) > 3 else ""
                    key = f"{sn}|attlog|{ts}|{pin}"
                    if key in self._event_key_set:
                        continue
                    if len(self._event_keys) == self._event_keys.maxlen:
                        self._event_key_set.discard(self._event_keys[0])
                    self._event_keys.append(key); self._event_key_set.add(key)
                    fresh.append({
                        "card_number": pin, "user_id": pin, "pin": pin,
                        "is_biometric": True, "verify_method": _verify_method(verify),
                        "event_type": "allow", "event_code": 0, "door": 1,
                        "index": ts, "timestamp": ts or time.strftime("%Y-%m-%dT%H:%M:%S"),
                    })
                if fresh:
                    self._events.extend(fresh)
                    self.event_log.extend(fresh)
            if fresh:
                log.info(f"buffered {len(fresh)} ATTLOG verify(s) from {sn}")
        elif t == "rtstate":
            # Device I/O telemetry: door / relay / alarm / sensor state. We decode
            # it into named health fields (dev.state) and surface alarms — the raw
            # bitmask-to-physical mapping is firmware-specific, so we expose the
            # raw values plus reliable 'active' booleans rather than guess bits.
            for line in body.splitlines():
                fields = {}
                for tok in line.split("\t"):
                    if "=" in tok:
                        k, v = tok.split("=", 1)
                        fields[k] = v.strip()
                if "relay" not in fields and "door" not in fields:
                    continue
                relay = fields.get("relay", dev.last_relay or "000000")
                alarm = fields.get("alarm", "0000")
                alarm_active = bool(alarm) and set(alarm) != {"0"}
                dev.state = {"time": fields.get("time", ""), "relay": relay,
                             "relay_active": relay != "000000", "door": fields.get("door", ""),
                             "alarm": alarm, "alarm_active": alarm_active,
                             "sensor": fields.get("sensor", ""), "seen_ts": time.time()}
                if relay != dev.last_relay:
                    log.info(f"RELAY STATE change SN={sn}: {dev.last_relay or '(init)'} "
                             f"-> {relay}  (door={fields.get('door','?')} "
                             f"time={fields.get('time','?')})")
                    self.relay_log.append({"ts": time.strftime("%H:%M:%S"),
                                           "from": dev.last_relay or "init", "to": relay})
                    dev.last_relay = relay
                # Alarm transition -> surface as an event for the gate loop / cloud.
                if alarm_active and alarm != dev.last_alarm:
                    log.warning(f"C3 ALARM active SN={sn}: alarm={alarm} "
                                f"door={fields.get('door','?')} sensor={fields.get('sensor','?')}")
                    self._events.append({"card_number": "0", "event_type": "alarm",
                                         "event_code": -1, "alarm": alarm,
                                         "door": fields.get("door", ""),
                                         "timestamp": fields.get("time", "")})
                dev.last_alarm = alarm
        else:
            # Any other table (user, userinfo, fp, …) — e.g. the reply to a
            # DATA QUERY. Capture rows so the console can count them.
            rows = [ln for ln in body.splitlines() if ln.strip()]
            for ln in rows:
                self.data_upload.append({"table": t, "line": ln[:220]})
            if rows:
                log.info(f"DATA upload table={t}: {len(rows)} row(s)")
        return b"OK\r\n"

    def _handle_devicecmd(self, sn: str, body: str) -> bytes:
        # Body form: ID=<cmd_id>&Return=<code>&CMD=<name>
        fields = dict(kv.split("=", 1) for kv in body.replace("\r", "").replace("\n", "&").split("&") if "=" in kv)
        try:
            cmd_id = int(fields.get("ID", "0"))
        except ValueError:
            cmd_id = 0
        ret = fields.get("Return", "0")
        if cmd_id:
            with self._lock:
                dev = self._touch(sn)
                dev.in_flight.pop(cmd_id, None)   # ACKed — no longer awaiting/retrying
                dev.acked[cmd_id] = ret
                self.ack_log.append({"ts": time.strftime("%H:%M:%S"), "id": cmd_id,
                                     "return": ret, "cmd": fields.get("CMD", "")})
                # Keep the user-table mirror in sync for status/observability.
                _apply_user_effect(dev, fields)
        return b"OK\r\n"


# ── format-specific helpers (the ONLY parts to revisit vs the real spec) ──
def format_control_cmd(cmd_id: int, door: int, duration: int) -> str:
    """Remote-open command. ZKTeco push 'CONTROL DEVICE' takes a packed-hex
    operand <AA><BB><CC><EE>: AA=01 (output op), BB=door id, CC=01 (lock),
    EE=duration seconds (hex). e.g. door 1 / 5s -> 01010105."""
    dur = max(1, min(0xFE, int(duration)))
    return f"C:{cmd_id}:CONTROL DEVICE 01{door:02X}01{dur:02X}"


def format_user_cmd(cmd_id: int, card_number: str, pin: str = "",
                    valid_from="0", valid_until="0", name: str = "") -> str:
    """Push/update a card. StartTime/EndTime give a validity window (visitor /
    staff passes) — 0 = no limit; accepts YYYYMMDD or 'YYYY-MM-DD HH:MM:SS'
    (both verified Return=0 on the C3-200 Plus)."""
    pin = pin or card_number
    return (f"C:{cmd_id}:DATA UPDATE user Pin={pin}\tCardNo={card_number}\t"
            f"Password=\tGroup=1\tStartTime={valid_from}\tEndTime={valid_until}\t"
            f"Name={name or pin}")


def format_user_delete_cmd(cmd_id: int, card_number: str) -> str:
    return f"C:{cmd_id}:DATA DELETE user CardNo={card_number}"


# ── access-model commands (all verified Return=0 on the C3-200 Plus) ──────
def format_timezone_cmd(cmd_id: int, tz_id: int, seg1="0000", seg2="2359") -> str:
    """Define a time zone (allowed window). Table is 'timezone' (NOT 'tz')."""
    return f"C:{cmd_id}:DATA UPDATE timezone TimezoneId={tz_id}\tSunTime1={seg1}\tSunTime2={seg2}"


def format_userauthorize_cmd(cmd_id: int, pin: str, tz_id: int = 1, door: int = 1) -> str:
    """Grant a user access to a door within a time zone (access level)."""
    return (f"C:{cmd_id}:DATA UPDATE userauthorize Pin={pin}\t"
            f"AuthorizeTimezoneId={tz_id}\tAuthorizeDoorId={door}")


def format_holiday_cmd(cmd_id: int, uid: int, date_yyyymmdd: str, htype: int = 1) -> str:
    return f"C:{cmd_id}:DATA UPDATE holiday Uid={uid}\tHoliday={date_yyyymmdd}\tHolidayType={htype}"


def format_firstcard_cmd(cmd_id: int, pin: str, door: int = 1, tz_id: int = 1) -> str:
    """First-card-opens-then-normal for a door."""
    return f"C:{cmd_id}:DATA UPDATE firstcard Pin={pin}\tDoorId={door}\tTimezoneId={tz_id}"


def format_normal_open_cmd(cmd_id: int, door: int) -> str:
    """Hold a door normally-open (rush-hour / emergency evacuation). EE=00 =
    stay open (verified Return=1)."""
    return f"C:{cmd_id}:CONTROL DEVICE 01{door:02X}0100"


def format_restore_cmd(cmd_id: int, door: int) -> str:
    """End normally-open by giving the door a finite (1s) open, after which it
    returns to controlled mode. NOTE: on the C3-200 Plus the all-zero operand
    (…0000) is rejected (Return=-13); a short timed open is a valid command. If
    normal-open persists on your firmware, ending it reliably needs a panel
    reboot or the web-UI door mode — verify on your unit."""
    return f"C:{cmd_id}:CONTROL DEVICE 01{door:02X}0101"


# ZKTeco access event codes (event=NN in rtlog). Codes seen/known to be an
# access GRANT on the C3; everything else with a card number is treated as a
# deny/failed verify. Refined from live captures — extend as needed.
_ALLOW_EVENT_CODES = {0, 1, 2, 3, 4}  # normal verify-open variants (card/fp/pwd/…)

# ZKTeco verify-mode codes (verifytype / verify field), used by biometric
# terminals like the SpeedFace-V5L to say HOW the person was identified.
# Extend from live captures once the device is pushing.
_VERIFY_METHOD = {
    "0": "auto", "1": "fingerprint", "2": "fingerprint", "3": "password",
    "4": "card", "9": "finger_vein", "15": "face", "16": "face",
    "20": "palm", "25": "face",
}


def _verify_method(raw: str) -> str:
    """Decode a ZKTeco verify-type into a human method. Biometric terminals send
    a small number (15=face, 1=fp, 4=card…); the C3 sends a 32-char zero string.
    Falls back to 'biometric' for an unknown non-zero value."""
    v = (raw or "").strip()
    if not v or set(v) == {"0"}:
        return ""                       # unspecified (e.g. C3's zero-filled field)
    v = v.lstrip("0") or "0"            # tolerate "015" / zero-padded forms
    return _VERIFY_METHOD.get(v, "biometric")


def parse_rtlog_line(line: str) -> dict | None:
    """Parse one realtime-log record a device POSTs (POST /iclock/cdata?table=rtlog).

    C3-200 Plus (FW 19.0.18) and SpeedFace-V5L share a tab-separated key=value form:
      time=..  pin=..  cardno=..  sitecode=..  linkid=..  eventaddr=..
      event=NN  inoutstatus=..  verifytype=..  index=..  sn=..
    - A **card** read (C3 / Wiegand)  → cardno != 0.
    - A **person** verify (V5L face/fp/pin) → pin != 0, cardno == 0.
    - cardno==0 AND pin==0 → a door/tamper/status record (ignored).
    """
    fields = {}
    for tok in line.split("\t"):
        if "=" in tok:
            k, v = tok.split("=", 1)
            fields[k] = v.strip()
    card = fields.get("cardno", "0")
    pin = fields.get("pin", "0")
    is_card = bool(card) and card != "0"
    is_person = bool(pin) and pin != "0"
    if not is_card and not is_person:
        return None                     # status/door/tamper — not an access read
    try:
        event_code = int(fields.get("event", "-1"))
    except ValueError:
        event_code = -1
    try:
        door = int(fields.get("eventaddr", "1") or 1)
    except ValueError:
        door = 1
    return {
        # For a card read this is the card number; for a biometric verify it's the
        # enrolled user id (pin), so downstream always has a stable identifier.
        "card_number": card if is_card else pin,
        "user_id": pin,
        "is_biometric": (not is_card) and is_person,
        "verify_method": _verify_method(fields.get("verifytype") or fields.get("verify")),
        "event_type": "allow" if event_code in _ALLOW_EVENT_CODES else "deny",
        "event_code": event_code,
        "pin": pin,
        "door": door,
        "index": fields.get("index", ""),   # device's monotonic event id (for de-dup)
        "timestamp": fields.get("time", time.strftime("%Y-%m-%dT%H:%M:%S")),
    }


def _apply_user_effect(dev: _DeviceState, fields: dict):
    cmd = fields.get("CMD", "")
    card = fields.get("CardNo", "")
    if not card:
        return
    if "DELETE" in cmd:
        dev.users.discard(card)
    elif "UPDATE" in cmd:
        dev.users.add(card)


def _make_handler(server: "C3PushServer"):
    class _Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):  # silence per-request stderr spam
            pass

        def _reply(self, payload: bytes, code: int = 200):
            self.send_response(code)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _qs(self):
            q = parse_qs(urlparse(self.path).query)
            return {k: v[0] for k, v in q.items()}

        def _body(self) -> str:
            n = int(self.headers.get("Content-Length", 0) or 0)
            return self.rfile.read(n).decode("utf-8", "replace") if n else ""

        def _trace(self, method: str, body: str = ""):
            # Raw capture: records EVERY request incl. unknown paths, so first
            # contact with a real panel reveals the exact endpoints/format it
            # uses (which may differ from the /iclock/* defaults).
            peer = self.client_address[0]
            server.recent.append({"ts": time.strftime("%H:%M:%S"), "peer": peer,
                                  "method": method, "path": self.path,
                                  "blen": len(body)})
            if server.trace:
                b = f" body[{len(body)}]={body[:400]!r}" if body else ""
                log.info(f"RAW {peer} {method} {self.path}{b}")

        def do_GET(self):
            self._trace("GET")
            path = urlparse(self.path).path
            q = self._qs()
            sn = q.get("SN", "")
            if path == "/iclock/cdata":
                self._reply(server._handle_registry(sn))
            elif path == "/iclock/getrequest":
                self._reply(server._handle_getrequest(sn))
            else:
                self._reply(b"OK\r\n")

        def do_POST(self):
            path = urlparse(self.path).path
            q = self._qs()
            sn = q.get("SN", "")
            body = self._body()
            self._trace("POST", body)
            if path == "/iclock/cdata":
                self._reply(server._handle_cdata_post(sn, q.get("table", ""), body))
            elif path == "/iclock/registry":
                self._reply(server._handle_registry_post(sn, body))
            elif path == "/iclock/push":
                self._reply(server._handle_push(sn, body))
            elif path == "/iclock/devicecmd":
                self._reply(server._handle_devicecmd(sn, body))
            else:
                self._reply(b"OK\r\n")

    return _Handler
