# C3-100 Controller Refactor: Pi GPIO to ZKTeco TCP/IP

## Problem

Current edge architecture requires a Raspberry Pi with GPIO relay, direct SPI/serial RFID reader, and custom Python drivers. This creates hardware complexity, SD card reliability risk, and limits deployment to Pi-only environments. The ZKTeco C3-100 Plus access controller handles reader input and relay output in a single industrial-grade box, controlled via TCP/IP.

## Decision

Replace the Pi GPIO architecture with ZKTeco C3-100 controller. The C3 handles Wiegand reader input and relay output locally. CommunityGate becomes a pure server-side service that manages the C3's card database, polls for events, handles ANPR correlation, and sends remote unlock commands — all over TCP/IP. Runs on any Linux PC, no Pi required.

## Architecture

### Before (Pi-based)
```
UHF Reader → Pi serial → Python decides → Pi GPIO relay → Boom
```

### After (C3-based)
```
UHF Reader → Wiegand → C3-100 (decides locally for known cards)
                            ↓ TCP/IP
                    CommunityGate Server
                    (card sync, event polling, ANPR, unknown card handling)
                            ↓ TCP/IP remote unlock
                        C3-100 relay → Boom
```

### Three Responsibilities

1. **Card Sync Service** — pushes FASTag whitelist to C3's internal card database every 5 minutes. On vehicle registration or auto-pair, immediate push of the single new card.

2. **Event Poller** — polls C3 for card events every 500ms. For known cards (allowed by C3 locally), logs to DB and emits WebSocket events. For unknown cards (denied by C3), triggers ANPR correlation flow.

3. **Gate Command API** — existing API endpoints now send remote unlock to C3 via SDK instead of MQTT → Pi → GPIO.

## Card Sync Flow

```
PostgreSQL (vehicles table, fastag_tid_hash)
    ↓ every 5 min or on-change
Card Sync Service (pyzkaccess SDK)
    ↓ TCP/IP
C3-100 internal card database (100K capacity)
    ↓
UHF Reader reads FASTag → C3 matches locally → relay opens (~30ms)
```

What gets synced:
- Each vehicle's `fastag_tid_hash` → C3 "card number"
- Blacklisted TIDs → C3 block list
- Card → door mapping (which relay to trigger)

Sync strategy: full replace every 5 minutes, same pattern as current SQLite whitelist sync. Immediate single-card push on registration/auto-pair.

## Event Polling + Unknown Card Handling

Poller runs every 500ms:

```
Poll C3 for new events via pyzkaccess
    ↓
Known card allowed:
    → Log to PostgreSQL + emit WebSocket gate:event
    → Done (resident entered)

Unknown card denied:
    → Store in _pending_unknown buffer with timestamp
    → Wait for ANPR correlation (up to FASTAG_CORRELATION_WINDOW seconds)

ANPR result arrives (async from camera):
    → Check _pending_unknown for recent denied FASTag within correlation window
    → Plate known + FASTag unknown:
        → Remote unlock: pyzkaccess open_door(door_number)
        → Auto-pair: push new card to C3 + update DB
        → Emit fastag:paired WebSocket event
    → Plate unknown + FASTag unknown:
        → Emit guard_review WebSocket event
        → Guard approves on Guard App → remote unlock via SDK
    → No pending FASTag (ANPR-only detection):
        → Standard access check (plate lookup)
        → If allowed → remote unlock
```

Remote unlock: `pyzkaccess` SDK `open_door(door_number)` sends TCP command to C3, C3 closes relay for configured duration.

Timing for unknown card + known plate: ~1-1.5s (C3 deny 0ms + poller 500ms + ANPR 500-800ms + unlock 10ms). Only happens on first visit — after auto-pairing, card is in C3 local list.

## Exit Gate Mode

Exit gates have no C3 — just an IP camera + vehicle presence sensor (IR beam triggers boom motor directly). Camera captures plate for audit logging. CommunityGate logs the departure event.

For exit gates, the gate controller only runs the ANPR client and event logger. No C3 interaction needed.

## Offline Behavior

### C3 handles known cards independently
- C3 has full card list in flash memory (survives power loss)
- Known FASTag → C3 opens relay locally, no network needed
- Events buffered on C3 (200K capacity), synced when server reconnects

### Server down scenarios
| Scenario | What happens |
|---|---|
| Server down, known FASTag | C3 opens gate locally (card in C3 memory) |
| Server down, unknown FASTag | C3 denies, no ANPR correlation possible, stays denied |
| Server down, no FASTag (visitor) | No ANPR processing, gate stays closed, guard manual override |
| Network between server and C3 down | Same as server down — C3 works independently |
| C3 power loss | Gate stays in last position, manual override on boom barrier |

### Recovery
When server reconnects to C3:
1. Pull all buffered events from C3 → log to PostgreSQL
2. Push latest card list to C3 (picks up any changes during downtime)
3. Resume normal polling

## File Changes

### New files
- `edge/c3_controller.py` — C3 SDK wrapper: connect, sync cards, poll events, open door, get status
- `edge/emulators/c3_mock.py` — Mock C3 for development/testing without hardware

### Modified files
- `edge/gate_controller.py` — Rewrite: remove GPIO/UHF imports, use C3 controller for card events + relay commands, keep ANPR correlation logic
- `edge/config.py` — Replace GPIO/UHF/RFID config with C3 TCP/IP config
- `edge/whitelist_sync.py` — After cloud sync, also push cards to C3 via c3_controller

### Removed (kept in repo, no longer imported)
- `edge/rfid_reader.py` — superseded by C3 Wiegand input
- `edge/uhf_reader.py` — superseded by C3 Wiegand input
- `edge/emulators/gpio_mock.py` — no GPIO needed
- `edge/emulators/rfid_mock.py` — superseded by c3_mock
- `edge/emulators/uhf_mock.py` — superseded by c3_mock

### No changes
- `edge/anpr_client.py` — still captures frames from IP camera over HTTP
- `edge/offline_queue.py` — still queues events for cloud sync
- API gateway (all endpoints) — no changes
- Guard App — no changes (same WebSocket events)
- Admin Portal — no changes
- ANPR service — no changes

## Config Changes

### Remove
```
RELAY_PIN, RFID_SPI_BUS, RFID_RESET_PIN, RFID_DEBOUNCE
UHF_READER_PORT, UHF_READER_BAUD, UHF_RSSI_THRESHOLD
USE_GPIO_MOCK, USE_RFID_MOCK, USE_UHF_MOCK
EXIT_PRESENCE_PIN
```

### Add
```
C3_IP: str              — C3-100 IP address (default "192.168.1.201")
C3_PORT: int            — C3 SDK port (default 4370)
C3_SERIAL: str          — C3 serial number (blank = auto-detect)
C3_POLL_INTERVAL: float — seconds between event polls (default 0.5)
C3_CARD_SYNC_INTERVAL: int — seconds between full card syncs (default 300)
C3_DOOR_NUMBER: int     — which relay/door on the C3 (default 1)
C3_OPEN_DURATION: int   — relay open seconds (default 5)
USE_C3_MOCK: bool       — mock mode for development (default true)
```

### Keep
```
GATE_ID, COMMUNITY_ID, DEVICE_TOKEN, CLOUD_API_URL
GATE_TYPE, ANPR_SERVICE_URL, ANPR_THRESHOLD, ANPR_COOLDOWN
MQTT_*, OFFLINE_*, WHITELIST_SYNC_INTERVAL
FASTAG_CORRELATION_WINDOW, USE_CAMERA_MOCK, MOCK_CAMERA_*
```

## C3 Controller Module (`edge/c3_controller.py`)

Interface:
```python
class C3Controller:
    def __init__(ip, port, serial_number, door_number, open_duration)
    def connect() -> bool
    def disconnect()
    def is_connected() -> bool
    def sync_cards(cards: list[str]) -> int        # push FASTag TID hashes, returns count
    def clear_cards() -> bool                       # remove all cards
    def add_card(card_number: str) -> bool          # add single card
    def remove_card(card_number: str) -> bool       # remove single card
    def block_card(card_number: str) -> bool        # add to block list
    def poll_events() -> list[dict]                 # get new events since last poll
    def open_door() -> bool                         # remote unlock relay
    def get_status() -> dict                        # connection status, card count, etc.
```

Event dict from poll_events:
```python
{
    "card_number": "c95ceb59...",   # FASTag TID hash
    "event_type": "allow" | "deny", # C3's local decision
    "door": 1,
    "timestamp": "2026-04-04T10:30:00",
}
```

## C3 Mock Module (`edge/emulators/c3_mock.py`)

Simulates C3 behavior for development:
- Maintains in-memory card list
- `sync_cards()` stores cards in memory
- `open_door()` logs the action
- `poll_events()` returns events from scenario playback
- Scenario: known card (allow), unknown card (deny), no card (empty)

Same interface as C3Controller — drop-in replacement.

## Testing

### Unit tests (`tests/unit/test_c3_controller.py`)
- C3 mock: sync cards, poll events, open door
- Card sync: push list, add single, remove single
- Event polling: known card → allow, unknown → deny

### Integration tests (`tests/integration/test_gate_loop.py`)
- Known FASTag → C3 allows locally → event logged
- Unknown FASTag → C3 denies → ANPR correlates → remote unlock + auto-pair
- Unknown FASTag + unknown plate → guard_review event
- Exit gate → ANPR audit only, no C3 interaction
- Card sync pushes whitelist to C3 mock
- Offline: C3 mock has cards, server down, still allows known cards

## Dependencies

### Add
- `pyzkaccess` — Python library for ZKTeco C3 controllers

### Remove
- `mfrc522` — MFRC522 SPI library (no longer needed)
- `pyserial` — serial communication (no longer needed for UHF)
- `RPi.GPIO` — Raspberry Pi GPIO (no longer needed)
