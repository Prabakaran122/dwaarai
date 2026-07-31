"""USB keyboard-wedge FASTag reader.

This path shipped with no tests. It matters more than most because the
`keyboard` hook is PROCESS-WIDE: it sees every keystroke on the gate PC, not
just the reader's. The original filter accepted any run of 8+ hex characters,
and digits are hex — so a PIN or card number typed by a guard was captured,
treated as a tag, and synced to the cloud as `raw_value`.

The regression tests for that leak are
`test_rejects_hand_typed_numeric_input` and `test_rejects_non_epc_lengths`.
"""
import sys
import types
import time
import pytest


@pytest.fixture
def reader_mod(monkeypatch):
    """Import the reader with a stub `keyboard` module.

    The real package needs a display/root privileges and installs a global hook
    — neither is acceptable in a test run.
    """
    stub = types.ModuleType("keyboard")
    stub.on_press = lambda fn: None
    stub.unhook_all = lambda: None
    monkeypatch.setitem(sys.modules, "keyboard", stub)
    for name in [m for m in sys.modules if m.endswith("uhf_usb_reader")]:
        del sys.modules[name]
    import edge.uhf_usb_reader as mod
    return mod


class Key:
    """Minimal stand-in for the keyboard event object (only .name is read)."""
    def __init__(self, name):
        self.name = name


def type_frame(reader, text, gap=0.0, enter=True):
    """Feed characters as if typed, `gap` seconds apart."""
    for ch in text:
        if gap:
            time.sleep(gap)
        reader._on_key(Key(ch))
    if enter:
        reader._on_key(Key("enter"))


EPC = "34161FA820328972305B75E0"          # a real 96-bit FASTag EPC, 24 chars


def make(reader_mod, **kw):
    seen = []
    r = reader_mod.UHFUsbReader(on_epc_callback=seen.append, **kw)
    return r, seen


class TestFrameAcceptance:
    def test_accepts_a_full_epc_typed_at_machine_speed(self, reader_mod):
        r, seen = make(reader_mod)
        type_frame(r, EPC)
        assert seen == [EPC]

    def test_uppercases_a_lowercase_frame(self, reader_mod):
        r, seen = make(reader_mod)
        type_frame(r, EPC.lower())
        assert seen == [EPC]

    def test_accepts_the_128_bit_width_too(self, reader_mod):
        r, seen = make(reader_mod)
        type_frame(r, "A" * 32)
        assert seen == ["A" * 32]

    def test_a_non_hex_key_discards_the_partial_frame(self, reader_mod):
        """Stray input must not merge into the next tag read."""
        r, seen = make(reader_mod)
        for ch in "3416":
            r._on_key(Key(ch))
        r._on_key(Key("space"))
        type_frame(r, EPC)
        assert seen == [EPC]


class TestKeystrokeLeak:
    """The vulnerability the hardening exists to close."""

    def test_rejects_hand_typed_numeric_input(self, reader_mod):
        """A PIN typed on the gate PC must never reach the callback.

        Digits are hex characters, so length alone would not save us if someone
        typed 24 of them — the burst-timing gate is what does. Anything slower
        than a machine burst starts a fresh buffer, so a human cannot accumulate
        a full-length frame no matter how many characters they type.
        """
        r, seen = make(reader_mod, max_gap=0.02)
        type_frame(r, "9" * 24, gap=0.03)      # deliberately slower than max_gap
        assert seen == [], "hand-typed input was accepted as a tag"

    def test_rejects_non_epc_lengths(self, reader_mod):
        """The original filter took anything 8+ chars; an 8-digit PIN qualified."""
        r, seen = make(reader_mod)
        for text in ["12345678", "1234567890123456", "A" * 23, "A" * 25, "7"]:
            type_frame(r, text)
        assert seen == []

    def test_a_pause_mid_frame_does_not_accumulate(self, reader_mod):
        """Two half-frames typed slowly must not join into one valid EPC."""
        r, seen = make(reader_mod, max_gap=0.02)
        for ch in EPC[:12]:
            r._on_key(Key(ch))
        time.sleep(0.05)                        # human-scale pause
        type_frame(r, EPC[12:])                 # second half + Enter
        assert seen == [], "a paused frame was stitched together"

    def test_rejected_input_is_never_logged_verbatim(self, reader_mod, caplog):
        """Rejected characters may BE the secret — log the length, not the value."""
        import logging
        caplog.set_level(logging.DEBUG)
        r, seen = make(reader_mod)
        type_frame(r, "98765432")
        assert seen == []
        assert "98765432" not in caplog.text


class TestDebounce:
    def test_same_tag_within_the_window_fires_once(self, reader_mod):
        """A tag sitting in the field reads continuously; open the gate once."""
        r, seen = make(reader_mod, debounce=60)
        type_frame(r, EPC)
        type_frame(r, EPC)
        type_frame(r, EPC)
        assert seen == [EPC]

    def test_a_different_tag_is_not_debounced(self, reader_mod):
        r, seen = make(reader_mod, debounce=60)
        other = "34161FA820328972305B75E1"
        type_frame(r, EPC)
        type_frame(r, other)
        assert seen == [EPC, other]

    def test_a_failing_callback_does_not_kill_the_reader(self, reader_mod):
        """One bad decision must not take the gate's reader offline."""
        calls = []

        def boom(epc):
            calls.append(epc)
            raise RuntimeError("cloud unreachable")

        r = reader_mod.UHFUsbReader(on_epc_callback=boom, debounce=0)
        type_frame(r, EPC)
        type_frame(r, "34161FA820328972305B75E1")
        assert len(calls) == 2
