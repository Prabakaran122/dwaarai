# Bike / two-wheeler RFID access at the C3 gate — design

**Date:** 2026-07-08
**Status:** Implemented (edge) — pending hardware verification of CardNo format
**Scope:** Edge-only (`edge/whitelist_sync.py`, `edge/gate_controller.py`, mock). No backend or DB change.

## Problem

Two-wheelers (bikes) are issued **RFID tags**, not FASTag. In the C3 architecture a
bike's RFID reader wires into the panel over Wiegand exactly like the car FASTag/UHF
reader, so a *known* bike tag should be matched **locally by the C3 in hardware**
(sub-second, works offline) — the same clean path as a paired FASTag.

That path was broken: **RFID card UIDs were never written to the C3 panel.** They
synced from the cloud into local SQLite and were used only for the ANPR/local decision
path — the panel never learned them, so a bike tap was an *unknown* card at the C3. For
a bike, the ANPR fallback is weakest (small rear plate, poor angle), so bikes could be
wrongly denied. Secondary: every C3 `allow` event was logged as `fastag` with no unit.

## Fixes implemented

### Fix 1 — push RFID UIDs to the C3 (`whitelist_sync.push_cards_to_c3`)
- Bulk-push (deduped) `whitelist.fastag_tid_hash` + `whitelist.rfid_uid_hash` +
  `rfid_cards_cache.uid_hash` (non-expiring) so all permanent credentials match locally.
- Expiring standalone RFID cards (`rfid_cards_cache.expires_at` in the future) are pushed
  via `add_card(uid, valid_until=<EndTime>)` so the **panel self-enforces expiry offline**.
  Already-expired cards are not provisioned at all. This matters because `sync_cards` is
  add/update-only (`clear_cards` is a no-op) — an un-windowed expired card would keep opening.
- Blacklist push now covers `rfid_uid_hash` as well as `fastag_tid_hash`.

### Fix 2 — correct method + unit labeling (`gate_controller._process_c3_event`)
- New `whitelist_sync.classify_card(db, card_number)` resolves the card against the local
  roster (`fastag_tid_hash` → `rfid_uid_hash` → `rfid_cards_cache`) → `(method, unit_id,
  unit_number)`. The panel can't distinguish RFID from FASTag (both are Wiegand card
  reads), so this local lookup — not the wiring — is the source of truth.
- The `allow` event now carries the resolved `detection_method` (`fastag`/`rfid`) and unit.
  Unknown (roster lag) logs as `card` with no unit rather than a wrong label.

## Edge cases: bike + car arriving together (site = SINGLE SHARED LANE)

Confirmed the pilot uses a **single shared lane**, so these are live risks:

| Scenario | Behavior after fixes | Residual risk |
|---|---|---|
| Both known (car FASTag + bike RFID) | Both matched locally by the C3; panel serializes (one command per poll); barrier opens. | Barrier auto-close timing could clip the 2nd vehicle. Hardware/loop concern. |
| Known bike + unknown car | Bike opens locally; car's unpaired FASTag → ANPR correlation. | **ANPR plate mis-attribution**: if the camera reads the *bike's* plate while the *car's* tag is the single pending one, it can auto-pair the wrong plate. The ambiguity guard only trips at **2+ pending tags**, not a single wrong plate. |
| Both unknown | 2 pending tags → `ambiguous=True` → opens for a known plate, does **not** auto-pair (safe). | Non-matched vehicle tailgates on the same opening. |
| Both in camera frame | ANPR receiver handles one plate per detection; picks one, the other expires. | Second vehicle relies on its own tag/plate. |

**Not solved here (structural / follow-up):**
- **Tailgating** and **ANPR plate mis-attribution** are inherent to one shared lane. The
  durable fix is physical: separate two-wheeler / four-wheeler lanes (one class + one
  reader per lane). Recommended for sites that can support it; not available at this pilot.
- **Roster removal gap (pre-existing, affects FASTag too):** `sync_cards` never *removes*
  a card that dropped off the roster (only blacklist does). A deactivated-but-not-expired,
  not-blacklisted card lingers on the panel until its EndTime (if any). Out of scope here;
  worth a diff-based reconcile later (the push server already mirrors pushed cards in
  `dev.users`).

## Decisions (from product)
1. **Lane layout:** single shared lane at the pilot → the bike+car edge cases above apply.
2. **Reader wiring:** TBD at install → labeling uses the local card lookup (Fix 2), which
   is wiring-independent. If bike/car readers land on different C3 doors, `event.door`
   is an available secondary signal (not required).
3. **CardNo format (OPEN):** confirm on real hardware that the pushed hash is accepted as
   a C3 `CardNo` for RFID as it (assumedly) is for FASTag. Blocks full hardware sign-off.

## Tests
`tests/integration/test_gate_realworld.py`:
- `test_local_allow_is_queued_and_tagged_offline` (updated) — seeds the FASTag, asserts
  method `fastag` + unit.
- `test_local_allow_rfid_bike_is_tagged_rfid` — bike RFID → method `rfid` + unit.
- `test_local_allow_unknown_card_is_tagged_card` — roster lag → `card`, no unit.
- `test_rfid_cards_pushed_to_panel` — resident + standalone RFID reach the panel and open.
- `test_expiring_rfid_pushed_with_window_expired_skipped` — future expiry pushed with an
  EndTime window; expired one skipped.
- `test_blocked_rfid_removed_from_panel` — blacklisted RFID blocked on the panel.
Full edge suite: 123 passed.
