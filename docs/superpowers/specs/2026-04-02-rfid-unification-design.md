# RFID Unification: Dual-Path Access Check

## Problem

Two disconnected RFID storage paths exist:
- `vehicles.rfid_uid_hash` — used by `/access/check` and `/whitelist/sync` (actual gate decisions)
- `rfid_cards` table — managed by admin UI with expiry/card_type/is_active, but never consulted during access checks

The `rfid_cards` table is effectively dead data. Card expiry is never enforced.

## Decision

**Both paths (Option C):** Check vehicles first (fast lane for known car+RFID combos), fall back to `rfid_cards` for standalone RFID (staff, visitors without vehicles, pedestrian gates).

## Design

### 1. Cloud Access Check (`/access/check` in vehicles.js)

Current RFID flow:
1. Check blacklist
2. Look up `vehicles.rfid_uid_hash` → allow/guard_review

New RFID flow:
1. Check blacklist (unchanged)
2. Look up `vehicles.rfid_uid_hash` (unchanged — fast lane)
3. **If no vehicle match**, look up `rfid_cards` where:
   - `uid_hash = value`
   - `community_id = community_id`
   - `is_active = true`
   - `expires_at IS NULL OR expires_at > NOW()`
4. If card found → `allow` with card's `issued_to_unit` info and `card_type`
5. If neither match → `guard_review` (unchanged)

Cache key remains `access:{community_id}:rfid:{value}` — the response just may come from either source.

### 2. Whitelist Sync Endpoint (`/whitelist/sync` in vehicles.js)

Add `rfid_cards` to the sync response:

```json
{
  "vehicles": [...],
  "blacklist": [...],
  "rfid_cards": [
    {
      "uid_hash": "abc...",
      "card_type": "staff",
      "unit_id": "...",
      "unit_number": "A-101",
      "expires_at": "2026-12-31T00:00:00Z"
    }
  ]
}
```

Query: active, non-expired cards with unit join. Only cards for the requesting community.

### 3. Edge Whitelist Sync (`edge/whitelist_sync.py`)

Add `rfid_cards_cache` SQLite table:
- Schema: `uid_hash TEXT, card_type TEXT, unit_id TEXT, unit_number TEXT, expires_at REAL`
- Index on `uid_hash`
- Full replace on each sync (same pattern as existing whitelist/blacklist)

Update `sync_from_cloud()` to store `rfid_cards` from response.

### 4. Edge Local Lookup (`load_local` in whitelist_sync.py)

For `method == "rfid"`:
1. Check `whitelist` table (vehicle RFID) — existing behavior
2. **If no match**, check `rfid_cards_cache` where `uid_hash = value` and `expires_at IS NULL OR expires_at > current_time`
3. Return unit info if found, else None

### 5. Expiry Enforcement

- **Cloud:** SQL `WHERE expires_at IS NULL OR expires_at > NOW()`
- **Edge:** Python check `expires_at is None or expires_at > time.time()`
- **Deactivated cards** (`is_active = false`): excluded by both cloud query and sync (only active cards synced)

### 6. No Schema Changes

The `rfid_cards` table already has all needed columns: `uid_hash`, `community_id`, `is_active`, `expires_at`, `issued_to_unit`, `card_type`.

## Files Changed

- `services/api-gateway/src/routes/vehicles.js` — access check fallback + whitelist sync addition
- `edge/whitelist_sync.py` — new table, sync rfid_cards, dual lookup
- `services/api-gateway/src/__tests__/gateway.test.js` — new RFID test cases
- `tests/integration/test_gate_loop.py` — edge RFID fallback tests

## Tests

### API Tests
- RFID access check with vehicle-linked RFID → allow
- RFID access check with card-only (no vehicle) → allow
- RFID access check with expired card → guard_review
- RFID access check with deactivated card → guard_review
- Whitelist sync includes rfid_cards array

### Edge Tests
- Local check falls back to rfid_cards_cache when no vehicle match
- Expired card in cache → not found (deny/guard_review)
- Valid card in cache → allowed with unit info
