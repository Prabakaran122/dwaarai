# FASTag Auto-Pairing Access System

## Problem

Current RFID uses MFRC522 (13.56 MHz HF) which requires residents to tap a card at close range. Indian vehicles already have FASTag (UHF RFID, 865-867 MHz) on windshields. Using FASTag eliminates the need for separate tags, enables automatic long-range detection (2-5m), and allows zero-effort registration via auto-pairing with ANPR.

## Decision

Replace MFRC522 with UHF RFID reader that reads FASTag. Auto-pair FASTag TIDs to vehicles using ANPR on first drive-through. FASTag opens the gate instantly on subsequent visits. ANPR runs async for audit and pairing. No pedestrian gates.

## Architecture

### 3-Tier Access (FASTag-First, ANPR-Async)

```
TIER 1 — FASTag (instant, <500ms)
  UHF reader detects TID → hash → lookup
  Known → OPEN GATE immediately
  Unknown → hold, wait for Tier 2

TIER 2 — ANPR (async, 1-3s)
  Camera captures plate → OCR → normalize → lookup
  Plate known + FASTag unknown → OPEN GATE + auto-pair FASTag
  Plate known + FASTag known → OPEN GATE (normal)
  Plate unknown + FASTag unknown → Tier 3

TIER 3 — Guard review
  Guard App shows: snapshot + detected plate (if any) + "Unknown vehicle"
  Guard can: Approve once, Approve + enter plate to pair FASTag, or Deny
```

ANPR always runs in background regardless of FASTag result — for audit trail and auto-pairing.

### Gate Types

**Entry gate:**
- Raspberry Pi
- UHF RFID reader (serial/USB) — reads FASTag at 2-5m
- ANPR IP camera
- Relay module → boom barrier
- Cost: ~25-35K INR

**Exit gate:**
- ANPR IP camera (audit logging only)
- Vehicle presence sensor (IR beam / induction loop) → triggers boom open
- No UHF reader, no access check
- Always opens — camera logs departure
- Cost: ~12-18K INR

### Gate Configuration

```json
{
  "gate_id": "gate-main-entry",
  "type": "entry",
  "has_uhf_reader": true,
  "has_anpr_camera": true,
  "has_relay": true,
  "auto_open_exit": false
}
```

Exit gates: `type: "exit"`, `has_uhf_reader: false`, `auto_open_exit: true`.

## Data Model Changes

### `vehicles` table — new column

- `fastag_tid_hash` (VARCHAR 64, nullable, unique per community, indexed)
- Auto-populated on first drive-through via auto-pairing
- One vehicle = one FASTag. New FASTag overwrites old.

### `gate_events` table — new columns

- `fastag_tid_hash` (VARCHAR 64, nullable) — which FASTag was read
- `auto_paired` (BOOLEAN, default false) — was this event the auto-pair trigger
- `direction` (VARCHAR 10: 'entry' / 'exit')
- `correlation_id` (UUID, nullable) — links FASTag + ANPR events for same car

### Whitelist sync — updated vehicle payload

```json
{
  "plate": "KA05MF1234",
  "fastag_tid_hash": "a3f9c2d4...",
  "unit_id": "...",
  "unit_number": "301",
  "resident_name": "Priya Sharma"
}
```

### `rfid_cards` table

Kept in schema but no longer in the active access path (no pedestrian gates). Available for future use.

## Auto-Pairing Logic

```
On every entry gate detection:

  FASTag TID detected?
  +-- YES, known --> OPEN GATE. ANPR runs async for audit.
  +-- YES, unknown:
  |     ANPR result available?
  |     +-- YES, plate matches vehicle with no FASTag:
  |     |     --> OPEN GATE
  |     |     --> Auto-pair: vehicle.fastag_tid_hash = hash(TID)
  |     |     --> Notify guard: "FASTag paired for Unit 301"
  |     +-- YES, plate matches vehicle WITH existing FASTag:
  |     |     --> OPEN GATE (plate match)
  |     |     --> Alert guard: "Different FASTag for KA05MF1234"
  |     +-- YES, plate unknown:
  |     |     --> Guard review
  |     +-- NO (ANPR failed):
  |           --> Guard review + manual pairing option
  +-- NO (no FASTag, e.g. tag damaged/missing):
        ANPR result?
        +-- Plate known --> OPEN GATE
        +-- Plate unknown --> Guard review
```

## Edge Software Changes

### New: UHF reader driver (`edge/uhf_reader.py`)

Replaces `edge/rfid_reader.py` (MFRC522).

- Serial/USB protocol for UHF readers (e.g., ThingMagic M6e, Chafon CF-RU5102)
- Continuous inventory mode — reads all tags in range
- Filters by signal strength (RSSI) — strongest tag = closest car
- SHA-256 hash of TID (same hashing as current MFRC522 UID)
- Debounce: same TID within 8s ignored
- Emits: `{tid_hash, rssi, timestamp}`
- Mock: `edge/emulators/uhf_mock.py` replaces `rfid_mock.py`

### Updated: Gate controller (`edge/gate_controller.py`)

**Correlation logic — in-memory buffer:**

```python
_recent_fastag = {}   # tid_hash -> {timestamp, decision}
_recent_anpr = {}     # plate -> {timestamp, confidence}

# When FASTag detected:
#   -> lookup immediately, open if known
#   -> store in _recent_fastag

# When ANPR result arrives (async):
#   -> check _recent_fastag for unpaired unknown TID within 5s window
#   -> if plate known + TID unknown -> auto-pair via API call
#   -> always log event with both FASTag + plate if available
```

**Exit gate mode:**
- Presence sensor triggers relay open (no access check)
- Camera capture → log departure event
- No UHF reader

### Updated: Config (`edge/config.py`)

```python
GATE_TYPE: str = "entry"                    # entry | exit
UHF_READER_PORT: str = "/dev/ttyUSB0"      # serial port
UHF_READER_BAUD: int = 115200
UHF_READER_POWER: int = 20                  # dBm, controls read range
UHF_DEBOUNCE: float = 8.0                   # seconds
UHF_RSSI_THRESHOLD: float = -60.0           # filter weak signals
FASTAG_ANPR_CORRELATION_WINDOW: float = 5.0 # seconds to match FASTag + ANPR
USE_UHF_MOCK: bool = True
EXIT_PRESENCE_PIN: int = 27                  # GPIO for IR beam sensor
```

### Updated: Whitelist sync (`edge/whitelist_sync.py`)

- Whitelist table adds `fastag_tid_hash` column
- `load_local()` supports `method="fastag"` — looks up by `fastag_tid_hash`
- Blacklist supports FASTag TID hash

## API Changes

### Updated: `/access/check`

Schema accepts new method:

```javascript
{
  community_id, gate_id,
  method: "fastag" | "anpr" | "otp",   // "rfid" becomes "fastag"
  value: "tid_hash_or_plate_or_otp",
  confidence: 0.92,                     // ANPR only
  correlation_id: "uuid",              // links FASTag + ANPR for same car
  direction: "entry" | "exit"
}
```

FASTag lookup: `vehicles.fastag_tid_hash = value` (same pattern as current RFID lookup on `rfid_uid_hash`).

Backwards compatible: `method: "rfid"` still works, treated as `"fastag"`.

### New: `POST /vehicles/auto-pair`

```javascript
POST /api/v1/vehicles/auto-pair
Authorization: X-Device-Token
{
  "community_id": "uuid",
  "plate": "KA05MF1234",
  "fastag_tid_hash": "abc123..."
}
// Response: updated vehicle with fastag_tid_hash set
// Emits WebSocket event: "fastag_paired"
// Invalidates access cache for plate + tid
```

Device-token authenticated (called by edge device, not user).

### New: `POST /vehicles/register-at-gate`

```javascript
POST /api/v1/vehicles/register-at-gate
Authorization: Bearer (guard JWT)
{
  "community_id": "uuid",
  "plate": "KA05MF1234",
  "fastag_tid_hash": "abc123...",
  "unit_number": "301"
}
// Creates vehicle + links FASTag in one step
// For completely unknown vehicles (guard manual registration)
```

Guard-authenticated (called from Guard App).

### Updated: `GET /whitelist/sync`

Vehicle objects include `fastag_tid_hash`:

```json
{
  "vehicles": [
    {
      "plate": "KA05MF1234",
      "fastag_tid_hash": "a3f9c2d4...",
      "rfid_uid_hash": null,
      "unit_id": "...",
      "unit_number": "301",
      "resident_name": "Priya Sharma"
    }
  ],
  "blacklist": [...],
  "rfid_cards": [...]
}
```

## Guard App Changes

### New alerts (push notification + in-app):
- "Unknown vehicle — FASTag not registered" (with camera snapshot if available)
- "FASTag auto-paired for Unit 301, KA05MF1234" (info)
- "FASTag mismatch — different tag for known vehicle KA05MF1234" (security alert)

### New actions on unknown vehicle alert:
- **Approve Once** — open gate, no registration, one-time
- **Approve + Register** — open gate + enter plate + unit number → creates vehicle + links FASTag
- **Deny** — reject entry, log event

## What Stays the Same

- ANPR service (FastAPI + EasyOCR) — unchanged, just called async
- Admin portal — vehicle CRUD still works, `fastag_tid_hash` visible as read-only field
- Offline queue — same pattern, new fields in event payload
- Blacklist — works with plate OR fastag_tid_hash (already supports both)
- Visitor passes / OTP flow — unchanged
- WebSocket events — same pattern, new event types added

## Migration Path

1. Add `fastag_tid_hash` column to `vehicles` table (nullable, no breaking change)
2. Add `direction`, `correlation_id`, `auto_paired` to `gate_events`
3. Update API: `/access/check` accepts `method: "fastag"`, new auto-pair + register endpoints
4. Update edge: new UHF driver, correlation logic, exit gate mode
5. Update whitelist sync: include `fastag_tid_hash` in vehicle payload
6. Update Guard App: new alert types + register action
7. Deploy UHF reader hardware at entry gates
8. Existing vehicles have no FASTag → auto-pairs on first visit over 2-3 weeks

## Files Changed

### Database
- `services/api-gateway/src/db/migrations/` — new migration for columns

### API Gateway
- `services/api-gateway/src/routes/vehicles.js` — access check update, auto-pair endpoint, register-at-gate endpoint, whitelist sync update

### Edge
- `edge/uhf_reader.py` — new UHF reader driver
- `edge/emulators/uhf_mock.py` — new mock
- `edge/gate_controller.py` — correlation logic, exit gate mode, FASTag-first flow
- `edge/config.py` — new UHF and exit gate config
- `edge/whitelist_sync.py` — fastag_tid_hash in whitelist

### Guard App
- `apps/guard-app/` — new alert types, register vehicle screen

### Tests
- `services/api-gateway/src/__tests__/gateway.test.js` — FASTag access, auto-pair, register
- `tests/integration/test_gate_loop.py` — FASTag-first flow, correlation, exit gate
- `tests/unit/test_uhf_reader.py` — UHF reader + mock tests
