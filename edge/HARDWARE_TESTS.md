# Hardware bring-up tests (RFID tap + LPRC300)

Two one-command harnesses for the on-site tests that need real hardware. Both
were validated against the emulators; run them from the repo root once the
hardware is physically connected.

## Prerequisites (the rig)
The dev/edge PC and the C3 must be on the same LAN, and the C3 must point its
push server at `http://<edge-ip>:8080`. Verify the panel is reachable first:

```
ping 192.168.1.201            # the C3 — must reply, not time out
```

If it times out, the C3 is powered off / unplugged / not on the LAN — fix that
before testing (see C3_PUSH_SETUP.md for the networking).

## 1. RFID real-tap test — `rfid_tap_test.py`
**Needs:** the C3 reachable **and an RFID reader wired to the C3's Wiegand port.**

```
python -m edge.tools.rfid_tap_test --sn NDB7255000188 --known 1234567
```
1. Waits for the panel, provisions `--known` as an ALLOW tag.
2. Live-decodes every tap. Tap the known tag → **ALLOW**; tap any other tag →
   **DENY**. It prints the **real `event=` code** for each — which is what we
   use to lock the allow/deny codes and prove the offline local-decision path.

Verified on the emulator: known → `event=0` ALLOW, unknown → `event=27` DENY
(confirm these against the real panel — firmware codes can differ).

## 2. LPRC300 plate capture — `lprc_capture.py`
**Needs:** the LPRC300 powered, on the LAN, configured to POST plate events to
`http://<edge-ip>:8001/...` (any path).

```
python -m edge.tools.lprc_capture --port 8001 --out lprc_payloads.log
```
Trigger the camera on a plate (drive a vehicle past, or its test button). Every
push is appended to `lprc_payloads.log` with method, path, content-type and the
**raw body**, and it runs the current parser so you see whether we'd extract the
plate today. Use the captured payload to lock `anpr_receiver`'s parser to the
LPRC300's actual format.

> Tip: if the camera isn't on the `192.168.1.x` LAN yet, find it with an ARP
> scan (`arp -a`) after it powers up, then set its HTTP-push target to the edge.
