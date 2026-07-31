"""USB keyboard-wedge UHF reader — reads the full FASTag EPC over USB.

Fallback path for readers that cannot emit a C3-compatible Wiegand frame. The
ZKTeco UHF-412 (firmware RF915_RD_V2.1a1_Crypt) transmits the full 96-bit EPC
over Wiegand regardless of the WG26/34/66 format setting; the C3 controller's
card-number field is only 32-bit, so it logs "WG Format Error" (event 42) and
never resolves a card number. See UHF_412_Wiegand_Issue_Report.md.

This module sidesteps Wiegand entirely: in **Active + USB-KB** mode the reader
"types" the EPC hex + Enter for every read. We capture those globally (no window
focus required) and hand each EPC to a callback. The access decision and the
C3 barrier open then happen on the edge — which has no 32-bit limit and uses the
full unique 96-bit EPC.

Requirements:
  pip install keyboard        # global key capture

Deploy on a DEDICATED gate PC — the global hook sees ALL keyboard input, so the
box should not be used for anything else. Set the reader to **Set Active** +
**Enable USB KB** in UHF_ConfigTool.
"""
import time, logging, threading

log = logging.getLogger("uhf_usb")

try:
    import keyboard
    _HAS_KB = True
except ImportError:
    _HAS_KB = False
    log.warning("keyboard not installed — USB UHF reader unavailable (pip install keyboard)")

_HEX = set("0123456789abcdefABCDEF")


class UHFUsbReader:
    """Capture Enter-terminated EPC hex strings the reader types over USB-KB.

    SAFETY — why this is fussy about what it accepts:

    The `keyboard` hook is process-wide: it sees EVERY keystroke on the host,
    not just the reader's. The original filter accepted any hex-ish run of 8+
    characters, and digits are hex characters — so an 8-digit PIN, a card number
    or an account number typed by a guard on the gate PC was captured, treated
    as a tag, written to the offline queue as `raw_value` and synced to the
    cloud. Two cheap discriminators close that:

      1. EXACT LENGTH. A FASTag EPC is 24 hex chars (96-bit); some tags are 32
         (128-bit). Nothing else is a tag. "12345678" is no longer a candidate.
      2. BURST TIMING. A keyboard-wedge reader emits a whole frame in one
         machine-speed burst — single-digit milliseconds between characters. A
         human types two orders of magnitude slower. Any gap longer than
         `max_gap` starts a new buffer, so hand-typed input can never accumulate
         into a full-length frame.

    Neither is a substitute for binding to the reader's HID device (VID/PID via
    hidapi/evdev), which is the real fix and would remove the global hook
    entirely. These make the interim state safe rather than merely documented.

    Args:
        on_epc_callback: called with each fresh EPC (uppercase hex string).
        debounce: seconds to suppress a repeat of the SAME EPC (a tag sitting in
                  the field is read continuously; open the gate once, not 20x).
        epc_lengths: exact hex-character counts accepted as an EPC.
        max_gap: longest pause (seconds) allowed between characters of one frame.
    """

    def __init__(self, on_epc_callback, debounce: float = 8.0,
                 epc_lengths=(24, 32), max_gap: float = 0.05):
        if not _HAS_KB:
            raise ImportError("keyboard required. Install with: pip install keyboard")
        self.cb = on_epc_callback
        self.debounce = debounce
        self.epc_lengths = frozenset(epc_lengths)
        self.max_gap = max_gap
        self._buf: list[str] = []
        self._last_key_at: float = 0.0
        self._last: dict[str, float] = {}
        self._running = False
        self._lock = threading.Lock()
        log.info(f"USB UHF reader initialized (debounce={debounce}s, "
                 f"lengths={sorted(self.epc_lengths)}, max_gap={max_gap}s)")

    def _on_key(self, e):
        # Reader types hex characters then Enter. keyboard reports key *names*
        # ('3','a','enter'), lower-case regardless of shift — we upper-case on emit.
        name = e.name or ""
        now = time.time()

        if name == "enter":
            epc = "".join(self._buf).strip()
            self._buf.clear()
            if len(epc) in self.epc_lengths and all(c in _HEX for c in epc):
                self._emit(epc.upper())
            elif epc:
                # Deliberately does NOT log the rejected characters — they may be
                # exactly the PIN this filter exists to keep out of the logs.
                log.debug(f"ignored {len(epc)}-char input (not an EPC length)")
        elif len(name) == 1 and name in _HEX:
            # A pause longer than a machine burst means a human is typing, or a
            # new frame started; either way the previous partial buffer is not
            # part of this one.
            if self._buf and (now - self._last_key_at) > self.max_gap:
                self._buf.clear()
            self._buf.append(name)
            self._last_key_at = now
        else:
            # Any non-hex key (space, letters g-z, modifiers…) means this isn't a
            # clean tag read — drop the partial buffer so stray input can't merge
            # into the next EPC.
            self._buf.clear()

    def _emit(self, epc: str):
        now = time.time()
        with self._lock:
            if epc in self._last and (now - self._last[epc]) < self.debounce:
                return
            self._last[epc] = now
            for k in [k for k, t in list(self._last.items()) if now - t > 60]:
                del self._last[k]
        log.info(f"USB FASTag EPC read: {epc[:12]}…")
        try:
            self.cb(epc)
        except Exception as ex:
            log.error(f"USB EPC callback error: {ex}")

    def start(self):
        """Register the global key hook (keyboard runs its own listener thread)."""
        self._running = True
        keyboard.on_press(self._on_key)
        log.info("USB UHF reader started — reader must be in Active + USB-KB mode.")

    def run(self):
        """Blocking variant for running as the main thread."""
        self.start()
        try:
            while self._running:
                time.sleep(0.5)
        finally:
            self.stop()

    def stop(self):
        self._running = False
        try:
            keyboard.unhook_all()
        except Exception:
            pass
        log.info("USB UHF reader stopped")
