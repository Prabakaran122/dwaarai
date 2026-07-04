# CommunityGate — C3 push setup for a new apartment

Set up a new gate in ~15 minutes. The ZKTeco C3 panel dials into a push server
we host on the edge (Windows mini-PC or Raspberry Pi); this enables **card
writes** the old PULL library couldn't do.

## 0. Hardware (installer)
- Mount the **C3 access panel**; wire **FASTag/RFID readers → Wiegand**, **relay
  output → barrier trigger input** (dry contact — closing is the barrier's own
  auto-close/loop, never software).
- Put the **C3, ANPR camera, and the edge box** on the **same gate-LAN switch,
  same subnet**. Give the edge a **static IP** (e.g. `192.168.1.50`).

## 1. Provision the panel — one command
Point the panel at the edge and verify end-to-end:

```
provision-gate.exe --panel <panel-ip> --password <admin-pw> ^
                   --edge-ip <edge-ip> --port 8080 --verify
```
It backs up the panel's current config (`panel_backup_<ip>.json`), sets its
Cloud Server to `edge-ip:8080` (HTTP), reboots it, then confirms it registers
and accepts a test card write. (`--source-ip` only if the edge has a subnet
alias; normally omit.)

> One-time on the panel web UI (`https://<panel-ip>`, admin login): note the
> serial number for the edge `.env`. Default web password is on the device
> label; generic defaults (`admin@123`) are usually disabled.

## 2. Firewall (edge)
Allow inbound TCP `8080` from the panel's subnet.
- Windows: `New-NetFirewallRule -DisplayName "C3 Push" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow -RemoteAddress <subnet>/24`
- Linux: `ufw allow from <subnet>/24 to any port 8080 proto tcp`

## 3. Edge config (`.env`) + auto-start
```
USE_C3_MOCK=false
USE_C3_PUSH=true
C3_PUSH_PORT=8080
C3_SERIAL=<panel serial>
C3_DOOR_NUMBER=1
C3_OPEN_DURATION_SECONDS=5
GATE_ID=…  COMMUNITY_ID=…  DEVICE_TOKEN=…  CLOUD_API_URL=…  MQTT_BROKER=…
```
Run `gate_controller.py` as an auto-start service (Windows Service / Task
Scheduler, or systemd on Pi) so it survives reboots.

## 4. Cloud onboarding (admin portal)
Create the community + gate + device (issues `DEVICE_TOKEN` + MQTT topic). Load
the resident/vehicle roster → `whitelist_sync` auto-pushes all cards to the C3
(~2.8 cards/s → ~6 min for 1000 cards).

## 5. Verify
Edge shows panel online → tap a resident tag → gate opens → the event appears on
the community **Events** page (filter method = RFID).

## Notes / limits (from real-device testing)
- **One command per poll** — the panel drops multi-command batches. The server
  handles this; provisioning is throttled to ~1 card/poll (fast on backlog).
- **No command priority** — a bulk card sync can delay an urgent open. Prefer
  syncing rosters when idle.
- **Server-initiated opens** carry the poll latency (~0.85 s at `RequestDelay=1`).
  Known-card taps decided **locally on the C3** are sub-second (poll not involved).
- The push protocol is **plain HTTP on the LAN** — keep the panel on a private
  segment; do not expose it to the internet.
