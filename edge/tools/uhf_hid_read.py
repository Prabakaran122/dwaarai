"""Capture reads from a USB keyboard-wedge UHF reader (e.g. ZKTeco, VID_FFFF).

The reader "types" each tag number into the focused window + Enter. Run this in
a terminal, keep that terminal focused, and present tags — each read is captured
and analysed so we know the EXACT number format to provision into the C3.

    python -m edge.tools.uhf_hid_read     # then scan tags; Ctrl+C to finish
"""
import sys


def analyse(v: str) -> str:
    if v.isdigit():
        return f"decimal (int={int(v)}, hex={int(v):X})"
    if all(c in "0123456789abcdefABCDEF" for c in v):
        return "hex"
    return "text/other"


def main():
    print("Focus THIS window and scan UHF tags. Ctrl+C when done.\n", flush=True)
    seen = []
    try:
        while True:
            line = input().strip()
            if not line:
                continue
            seen.append(line)
            print(f"  read #{len(seen):>2}: '{line}'  len={len(line)}  {analyse(line)}", flush=True)
    except (KeyboardInterrupt, EOFError):
        pass
    uniq = sorted(set(seen))
    print(f"\nCaptured {len(seen)} read(s), {len(uniq)} unique: {uniq}")
    if uniq:
        print("Use one of these as the tag number to provision the C3, e.g.:")
        print(f"  python -m edge.tools.rfid_tap_test --sn NDB7255000188 --known {uniq[0]}")


if __name__ == "__main__":
    main()
