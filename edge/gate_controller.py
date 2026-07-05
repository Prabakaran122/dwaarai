#!/usr/bin/env python3
"""Main gate controller — C3-100 architecture.

Entry gate: C3 handles known FASTag cards locally. This service polls C3 for
events, handles unknown cards via ANPR correlation, and manages card sync.

Exit gate: Camera audit only, no C3.
"""
import os, time, json, threading, logging
from edge.config import cfg

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[logging.StreamHandler()])
log = logging.getLogger("gate")

# ── C3 controller: mock / push / pull ────────────────────────────────
if cfg.USE_C3_MOCK:
    from edge.emulators.c3_mock import C3Mock as C3Impl
    log.warning("C3 MOCK active")
elif cfg.USE_C3_PUSH:
    # PUSH protocol: panel dials into a server we host; supports card writes.
    from edge.c3_push_controller import C3PushController as C3Impl
    log.info(f"C3 PUSH protocol active (server on {cfg.C3_PUSH_BIND}:{cfg.C3_PUSH_PORT})")
else:
    # Legacy PULL (zkaccess-c3): TCP:4370 polling; cannot write cards.
    from edge.c3_controller import C3Controller as C3Impl

from edge.anpr_receiver import ANPRReceiver

import paho.mqtt.client as mqtt
import requests
from edge.offline_queue import OfflineQueue
from edge.whitelist_sync import load_local, is_blacklisted_local, start_sync

# ── Shared state ──────────────────────────────────────────────────────
_lock        = threading.Lock()
_online      = False
_seen_ids:   dict[str, float] = {}
_oq          = OfflineQueue(cfg.OFFLINE_QUEUE_PATH)
_mqtt_client = None
_c3          = None
_pending_unknown: dict[str, dict] = {}  # card_number → {ts, event}

# ── Cloud helpers ─────────────────────────────────────────────────────
def _cloud_check(method, value, conf=None):
    try:
        r = requests.post(f"{cfg.CLOUD_API_URL}/access/check",
                          json={"community_id":cfg.COMMUNITY_ID,"gate_id":cfg.GATE_ID,
                                "method":method,"value":value,"confidence":conf,"ts":time.time()},
                          headers={"X-Device-Token":cfg.DEVICE_TOKEN}, timeout=2.0)
        return r.json()["data"]
    except Exception as e:
        log.warning(f"Cloud check failed: {e}")
        return None

def _local_check(method, value):
    if is_blacklisted_local(cfg.OFFLINE_DB_PATH, method, value):
        return {"decision":"deny","source":"local","reason":"blacklisted"}
    row = load_local(cfg.OFFLINE_DB_PATH, method, value)
    if row:
        return {"decision":"allow","source":"local",**row}
    return {"decision":"guard_review","source":"local","reason":"unknown_offline"}

def _open_gate() -> bool:
    """Trigger the C3 barrier if connected. Returns True only if the open command
    succeeded — callers record this so the audit reflects whether the barrier
    actually moved (not just that access was granted)."""
    if _c3 and _c3.is_connected():
        ok = _c3.open_door()
        if not ok:
            log.error("C3 open_door FAILED — barrier may not have physically opened")
        return ok
    return False

def _try_auto_pair(tid_hash: str, plate: str):
    try:
        r = requests.post(f"{cfg.CLOUD_API_URL}/vehicles/auto-pair",
                          json={"community_id": cfg.COMMUNITY_ID,
                                "plate": plate, "fastag_tid_hash": tid_hash},
                          headers={"X-Device-Token": cfg.DEVICE_TOKEN}, timeout=3.0)
        if r.status_code == 200:
            log.info(f"AUTO-PAIRED: {plate} → {tid_hash[:12]}...")
            # Push newly paired card to C3 immediately
            if _c3 and _c3.is_connected():
                _c3.add_card(tid_hash)
        else:
            log.warning(f"Auto-pair failed ({r.status_code}): {r.text[:200]}")
    except Exception as e:
        log.warning(f"Auto-pair error: {e}")

# ── Dedup window — suppress duplicate reads within 2 seconds ────────
_last_read = {}  # card_number -> timestamp
DEDUP_WINDOW = 2.0

# ── C3 event poller ──────────────────────────────────────────────────
def _process_c3_event(event: dict):
    """Handle a single event from C3 polling."""
    card = event["card_number"]
    etype = event["event_type"]

    # Panel alarm (tamper / forced-open / door-held) from rtstate telemetry —
    # not a card read, so surface it directly as a security event, no dedup.
    if etype == "alarm":
        log.warning(f"C3 ALARM: {event.get('alarm')} door={event.get('door')}")
        _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                     "detection_method": "system", "raw_value": "c3_alarm",
                     "access_decision": "alarm", "deny_reason": f"alarm_{event.get('alarm')}",
                     "is_offline_event": not _online, "event_ts": time.time()})
        return

    # Deduplicate: skip if same card read within DEDUP_WINDOW seconds.
    # _last_read is shared with no other writer but is touched from this poll
    # thread; guard it under _lock alongside the other shared dicts.
    now = time.time()
    with _lock:
        if card in _last_read and (now - _last_read[card]) < DEDUP_WINDOW:
            log.debug(f"Dedup: ignoring repeat read for {card[:12]}... ({now - _last_read[card]:.1f}s)")
            return
        _last_read[card] = now
        # Clean old dedup entries periodically (snapshot keys — dict mutates here)
        for k in [k for k, ts in list(_last_read.items()) if now - ts > 30]:
            del _last_read[k]

    if etype == "allow":
        log.info(f"C3 ALLOWED (local): {card[:12]}...")
        _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                      "detection_method": "fastag", "raw_value": card,
                      "access_decision": "allow", "is_offline_event": not _online,
                      "event_ts": time.time()})
    elif etype == "deny":
        log.info(f"C3 DENIED (unknown card): {card[:12]}... — queuing for ANPR correlation")
        # _pending_unknown is mutated here (poll thread) and read/deleted in
        # handle_anpr_detection (ANPR HTTP thread) — guard under _lock.
        with _lock:
            _pending_unknown[card] = {"ts": time.time(), "event": event}
            for k in [k for k, v in list(_pending_unknown.items()) if now - v["ts"] > 30]:
                del _pending_unknown[k]

def _c3_poll_loop():
    """Continuously poll C3 for new events, reconnecting if the link drops."""
    reconnect_backoff = 1.0
    last_alert = 0.0
    alerted = False
    while True:
        try:
            if _c3 and _c3.is_connected():
                if alerted:
                    log.warning("C3 panel back in contact — clearing alert")
                    alerted = False
                events = _c3.poll_events()
                for event in events:
                    _process_c3_event(event)
            elif _c3:
                # Link is down (initial failure or dropped mid-run). Try to
                # re-establish with capped exponential backoff so the gate
                # recovers on its own instead of going dead until restart.
                log.warning("C3 not connected — attempting reconnect")
                # Alert (throttled) if the panel has been silent too long — it
                # may be wedged or the network is down. The C3 still makes local
                # decisions during the gap, but server sync/commands are stalled.
                silent = _c3.seconds_since_contact() if hasattr(_c3, "seconds_since_contact") else 0
                now = time.time()
                if silent >= cfg.C3_ALERT_SECONDS and (now - last_alert) > 60:
                    log.error(f"C3 PANEL UNREACHABLE for {silent:.0f}s "
                              f"(gate={cfg.GATE_ID}) — check panel power/network")
                    last_alert = now
                    alerted = True
                    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                                 "detection_method": "system", "raw_value": "c3_unreachable",
                                 "access_decision": "alert", "deny_reason": f"panel_silent_{int(silent)}s",
                                 "is_offline_event": not _online, "event_ts": now})
                if _c3.connect():
                    log.info("C3 reconnected")
                    reconnect_backoff = 1.0
                else:
                    time.sleep(reconnect_backoff)
                    reconnect_backoff = min(reconnect_backoff * 2, 30.0)
                    continue
        except Exception as e:
            log.error(f"C3 poll error: {e}")
        time.sleep(cfg.C3_POLL_INTERVAL)

def _offline_sync_loop():
    """Periodically flush queued gate events to the cloud when online.

    Without this the offline queue is never drained — local C3 'allow' events
    (which never hit the cloud check) and any events captured while MQTT was
    down would never reach the cloud audit/activity feed.
    """
    while True:
        try:
            if _online and _oq.pending_count() > 0:
                _oq.sync(cfg.CLOUD_API_URL, cfg.DEVICE_TOKEN)
        except Exception as e:
            log.error(f"Offline sync error: {e}")
        time.sleep(max(10, cfg.HEARTBEAT_INTERVAL))

# ── ANPR handler (correlates with pending unknown FASTag) ─────────────
def handle_anpr_detection(plate: str, confidence: float = None):
    if not plate:
        return
    log.info(f"ANPR detection: plate={plate} conf={confidence}")
    now = time.time()

    # Unknown FASTag(s) still inside the correlation window, snapshotted under
    # lock (the poll thread mutates _pending_unknown concurrently).
    with _lock:
        candidates = [(cn, p) for cn, p in _pending_unknown.items()
                      if (now - p["ts"]) < cfg.FASTAG_CORRELATION_WINDOW]
    if candidates:
        # Pair with the tag read CLOSEST in time to this plate. If MORE THAN ONE
        # tag is pending the pairing is AMBIGUOUS (e.g. two cars tail-gating with
        # one plate read) — we still OPEN for a known resident plate, but we do
        # NOT auto-pair (a wrong tag↔plate bond would persist to the roster + C3)
        # and we LEAVE the tags pending for their own plate / to expire. A wrong
        # open is recoverable; a wrong pairing poisons the roster.
        ambiguous = len(candidates) > 1
        card_number, _pend = min(candidates, key=lambda c: now - c[1]["ts"])

        if is_blacklisted_local(cfg.OFFLINE_DB_PATH, "anpr", plate):
            log.info("DENIED (plate blacklisted during correlation)")
            _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                          "detection_method": "anpr", "raw_value": plate,
                          "access_decision": "deny", "deny_reason": "blacklisted",
                          "anpr_confidence": confidence, "is_offline_event": not _online,
                          "event_ts": time.time()})
            if not ambiguous:
                with _lock:
                    _pending_unknown.pop(card_number, None)
            return

        plate_result = None
        if _online:
            plate_result = _cloud_check("anpr", plate, confidence)
        if not plate_result or plate_result.get("decision") != "allow":
            plate_result = _local_check("anpr", plate)

        if plate_result and plate_result["decision"] == "allow":
            opened = _open_gate()  # record whether the barrier actually moved
            # Only bond a tag to a plate for a PERMANENT resident vehicle. A
            # visitor pass is temporary + plate-only — pairing the visitor's tag
            # would grant them permanent access and bypass the pass expiry. And
            # an ambiguous read (2+ tags) can't be paired safely at all.
            is_visitor = plate_result.get("kind") == "visitor_pass"
            do_pair = (not ambiguous) and (not is_visitor) and _online
            if ambiguous:
                log.warning(f"GRANTED (ANPR) {plate} → {plate_result.get('unit_number')} "
                            f"but {len(candidates)} tags pending — NOT auto-pairing "
                            f"(ambiguous; would corrupt roster). gate_opened={opened}")
            elif is_visitor:
                log.info(f"GRANTED (visitor pass) {plate} → {plate_result.get('unit_number')} "
                         f"— NOT auto-pairing (temporary). gate_opened={opened}")
            else:
                log.info(f"GRANTED (ANPR correlated) → {plate_result.get('unit_number')} "
                         f"gate_opened={opened}")
                if do_pair:
                    threading.Thread(target=_try_auto_pair,
                                     args=(card_number, plate), daemon=True).start()
            _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                          "detection_method": "anpr", "raw_value": plate,
                          "access_decision": "allow", "anpr_confidence": confidence,
                          "gate_opened": opened, "auto_paired": do_pair,
                          "ambiguous_correlation": ambiguous, "pass_kind": plate_result.get("kind"),
                          "is_offline_event": not _online, "event_ts": time.time()})
            if not ambiguous:
                with _lock:
                    _pending_unknown.pop(card_number, None)
            return
        else:
            log.info(f"GUARD REVIEW — unknown FASTag + unknown plate {plate}"
                     + (f" ({len(candidates)} tags pending)" if ambiguous else ""))
            _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                          "detection_method": "anpr", "raw_value": plate,
                          "access_decision": "guard_review", "deny_reason": "not_recognized",
                          "anpr_confidence": confidence, "is_offline_event": not _online,
                          "event_ts": time.time()})
            if not ambiguous:
                with _lock:
                    _pending_unknown.pop(card_number, None)
            return

    # No pending FASTag — standard ANPR-only access check
    if is_blacklisted_local(cfg.OFFLINE_DB_PATH, "anpr", plate):
        result = {"decision": "deny", "reason": "blacklisted"}
    elif _online:
        result = _cloud_check("anpr", plate, confidence) or _local_check("anpr", plate)
    else:
        result = _local_check("anpr", plate)

    decision = result["decision"]
    opened = False
    if decision == "allow":
        opened = _open_gate()
        log.info(f"GRANTED (ANPR) → {result.get('unit_number')} ({result.get('resident_name')}) gate_opened={opened}")
    else:
        log.info(f"DENIED (ANPR) — {result.get('reason')}")

    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                 "detection_method": "anpr", "raw_value": plate,
                 "access_decision": decision, "deny_reason": result.get("reason"),
                 "anpr_confidence": confidence, "gate_opened": opened,
                 "is_offline_event": not _online, "event_ts": time.time()})

# ── ANPR camera event handler ─────────────────────────────────────────
def _handle_anpr_event(plate: str, confidence: float = None):
    """Called when ANPR camera sends a plate event via HTTP."""
    if cfg.GATE_TYPE == "exit":
        # Exit gate: just log for audit
        log.info(f"EXIT audit: plate={plate}")
        _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                     "detection_method": "anpr", "raw_value": plate,
                     "access_decision": "allow", "anpr_confidence": confidence,
                     "is_offline_event": not _online, "event_ts": time.time()})
    else:
        # Entry gate: run through correlation logic
        handle_anpr_detection(plate, confidence)

# ── MQTT (gate commands from admin portal) ────────────────────────────
def _on_command(client, userdata, msg):
    try:
        cmd = json.loads(msg.payload)
        eid = cmd.get("event_id","")
        ttl = cmd.get("ttl")
        if ttl is not None and ttl < time.time():
            log.warning(f"TTL expired — command {eid} rejected"); return
        now = time.time()
        with _lock:
            if _seen_ids.get(eid,0) > now-60:
                log.warning(f"Duplicate command {eid} ignored"); return
            _seen_ids[eid] = now
            for k in [k for k,v in list(_seen_ids.items()) if v < now-60]: del _seen_ids[k]
        if cmd.get("action") == "open":
            opened = _open_gate()
            if client:
                client.publish(f"cg/{cfg.COMMUNITY_ID}/gates/{cfg.GATE_ID}/ack",
                               json.dumps({"event_id":eid,
                                           "status":"opened" if opened else "open_failed",
                                           "gate_id":cfg.GATE_ID,"ts":time.time()}), qos=1)
    except Exception as e:
        log.error(f"Command error: {e}")

def start_mqtt():
    global _mqtt_client, _online
    c = mqtt.Client(client_id=f"gate-{cfg.GATE_ID}", clean_session=False)
    if cfg.MQTT_USE_TLS:
        import ssl
        c.tls_set(cfg.MQTT_CA_PATH, cfg.MQTT_CERT_PATH, cfg.MQTT_KEY_PATH,
                  tls_version=ssl.PROTOCOL_TLSv1_2)
    def on_connect(c,u,f,rc):
        global _online
        if rc==0:
            _online = True; log.info("MQTT connected — online mode")
            c.subscribe(f"cg/{cfg.COMMUNITY_ID}/gates/{cfg.GATE_ID}/commands", qos=1)
            c.subscribe(f"cg/{cfg.COMMUNITY_ID}/admin/broadcast", qos=1)
    def on_disconnect(c,u,rc):
        global _online; _online=False
        log.warning(f"MQTT disconnected rc={rc} — offline mode")
    c.on_connect=on_connect; c.on_disconnect=on_disconnect
    c.message_callback_add(f"cg/{cfg.COMMUNITY_ID}/gates/{cfg.GATE_ID}/commands",_on_command)
    c.connect_async(cfg.MQTT_BROKER, cfg.MQTT_PORT, keepalive=30)
    c.loop_start(); _mqtt_client = c

# ── Entry point ───────────────────────────────────────────────────────
def main():
    global _c3
    log.info(f"CommunityGate starting — gate={cfg.GATE_ID} type={cfg.GATE_TYPE}")
    start_mqtt()

    # Drain queued events to the cloud in the background (online only).
    threading.Thread(target=_offline_sync_loop, daemon=True).start()
    log.info(f"Offline event sync started (interval={max(10, cfg.HEARTBEAT_INTERVAL)}s)")

    # Start ANPR camera event receiver (listens for HTTP POST from any ANPR camera)
    anpr = ANPRReceiver(port=cfg.ANPR_RECEIVER_PORT, on_plate_callback=_handle_anpr_event)
    anpr.start()

    if cfg.GATE_TYPE == "exit":
        log.info("EXIT gate mode — ANPR audit only, no C3")
        start_sync()
    else:
        # Entry gate: C3 controller + ANPR
        c3_kwargs = dict(ip=cfg.C3_IP, port=cfg.C3_PORT,
                         serial_number=cfg.C3_SERIAL,
                         door_number=cfg.C3_DOOR_NUMBER,
                         open_duration=cfg.C3_OPEN_DURATION)
        if cfg.USE_C3_PUSH and not cfg.USE_C3_MOCK:
            # Push controller also needs where to bind its server for the panel,
            # plus the bulk-sync throttle so a big roster can't hang the panel.
            c3_kwargs.update(listen_host=cfg.C3_PUSH_BIND, listen_port=cfg.C3_PUSH_PORT,
                             sync_chunk=cfg.C3_SYNC_CHUNK, sync_pause=cfg.C3_SYNC_PAUSE)
        _c3 = C3Impl(**c3_kwargs)
        if not _c3.connect():
            log.error("C3 connection failed — running in degraded mode (ANPR only)")

        start_sync(c3=_c3)

        # Start C3 event poller thread
        threading.Thread(target=_c3_poll_loop, daemon=True).start()
        log.info(f"C3 event poller started (interval={cfg.C3_POLL_INTERVAL}s)")

    log.info("Gate controller running. CTRL+C to stop.")
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        anpr.stop()
        if _c3: _c3.disconnect()
        if _mqtt_client: _mqtt_client.loop_stop()

if __name__ == "__main__": main()
