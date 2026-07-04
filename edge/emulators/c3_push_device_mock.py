"""Simulated ZKTeco C3 panel speaking the **Push protocol** (client side).

This is the counterpart to `edge/c3_push_server.py`: it plays the role the real
C3 plays on the LAN — it dials out to the push server, polls for commands,
executes them against an in-memory user table / door, posts acks, and uploads
realtime events when a card is tapped.

It exists so the push server + C3PushController can be integration-tested
end-to-end with zero hardware (the project's convention: every hardware
interface has a mock). Not used in production — the real panel replaces it.
"""
import time, threading, logging
import requests

log = logging.getLogger("c3_push_device_mock")


class C3PushDeviceMock:
    def __init__(self, server_url: str, serial_number: str = "MOCKSN01",
                 poll_interval: float = 0.05):
        self.base = server_url.rstrip("/")
        self.sn = serial_number
        self.poll_interval = poll_interval
        self.users: set[str] = set()          # cards the panel would now accept
        self.door_open_events: list[int] = []  # durations it was told to open for
        self._running = False
        self._thread: threading.Thread | None = None

    # ── lifecycle ─────────────────────────────────────────────────────
    def start(self):
        # Handshake so the server marks us online.
        try:
            requests.get(f"{self.base}/iclock/cdata",
                         params={"SN": self.sn, "options": "all"}, timeout=2)
        except Exception as e:
            log.warning(f"handshake failed: {e}")
        self._running = True
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    # ── command polling ───────────────────────────────────────────────
    def _poll_loop(self):
        while self._running:
            try:
                r = requests.get(f"{self.base}/iclock/getrequest",
                                 params={"SN": self.sn}, timeout=2)
                body = r.text.strip()
                if body and body != "OK":
                    for line in body.splitlines():
                        self._execute(line.strip())
            except Exception as e:
                log.debug(f"poll error: {e}")
            time.sleep(self.poll_interval)

    def _execute(self, line: str):
        # Wire form: C:<id>:<verb> <table/target> <args...>
        if not line.startswith("C:"):
            return
        try:
            _c, cmd_id, rest = line.split(":", 2)
        except ValueError:
            return
        ret, card, cmdname = "0", "", rest.split(" ", 1)[0] if rest else ""
        if rest.startswith("CONTROL DEVICE"):
            # packed-hex operand <AA><BB><CC><EE>; duration = last hex byte.
            parts = rest.split()
            operand = parts[2] if len(parts) > 2 else "01010105"
            duration = int(operand[6:8], 16) if len(operand) >= 8 else 5
            self.door_open_events.append(duration)
            cmdname = "CONTROL DEVICE"
            log.info(f"[C3 PUSH MOCK] door opened for {duration}s")
        elif rest.startswith("DATA UPDATE user"):
            card = self._field(rest, "CardNo")
            if card:
                self.users.add(card)
            cmdname = "DATA UPDATE user"
            log.info(f"[C3 PUSH MOCK] user added: {card}")
        elif rest.startswith("DATA DELETE user"):
            card = self._field(rest, "CardNo")
            self.users.discard(card)
            cmdname = "DATA DELETE user"
            log.info(f"[C3 PUSH MOCK] user deleted: {card}")
        # Ack so the server can correlate the command id.
        try:
            requests.post(f"{self.base}/iclock/devicecmd", params={"SN": self.sn},
                          data=f"ID={cmd_id}&Return={ret}&CMD={cmdname}&CardNo={card}",
                          timeout=2)
        except Exception as e:
            log.debug(f"ack error: {e}")

    @staticmethod
    def _field(rest: str, key: str) -> str:
        for tok in rest.replace("\t", " ").split():
            if tok.startswith(key + "="):
                return tok.split("=", 1)[1]
        return ""

    # ── realtime events (a card tapped at the gate) ───────────────────
    def simulate_card_tap(self, card_number: str):
        """Post an RTLog record like the panel would. It authorizes locally:
        a card in its table verifies (allow) and it opens; otherwise deny."""
        verified = card_number in self.users
        if verified:
            self.door_open_events.append(5)
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        # Real C3-200 Plus rtlog shape: tab-separated key=value. event=0 is a
        # normal verify-open (allow); a non-allow code marks a denied read.
        event = 0 if verified else 27
        record = (f"time={ts}\tpin=1\tcardno={card_number}\tsitecode=0\tlinkid=0\t"
                  f"eventaddr=1\tevent={event}\tinoutstatus=2\tverifytype=1\t"
                  f"index=1\tsn={self.sn}")
        requests.post(f"{self.base}/iclock/cdata",
                      params={"SN": self.sn, "table": "rtlog"},
                      data=record, timeout=2)
        log.info(f"[C3 PUSH MOCK] card tap {card_number} -> "
                 f"{'allow' if verified else 'deny'}")
