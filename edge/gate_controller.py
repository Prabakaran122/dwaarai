#!/usr/bin/env python3
"""Main gate controller. Runs as: systemd service communitygate-gate.service."""
import os, sys, time, json, threading, logging
from edge.config import cfg

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[logging.StreamHandler()])
log = logging.getLogger("gate")

# ── Hardware abstraction: inject mock or real at import time ──────────
if cfg.USE_GPIO_MOCK:
    import edge.emulators.gpio_mock as GPIO
    log.warning("GPIO MOCK active")
else:
    import RPi.GPIO as GPIO

if cfg.USE_UHF_MOCK:
    from edge.emulators.uhf_mock import UHFMock as UHFImpl
    log.warning("UHF MOCK active")
else:
    from edge.uhf_reader import UHFReader as UHFImpl

if cfg.USE_CAMERA_MOCK:
    from edge.emulators.camera_mock import CameraMock as CameraImpl
    log.warning("CAMERA MOCK active")
else:
    from edge.anpr_client import ANPRClient as CameraImpl

import paho.mqtt.client as mqtt
import requests
from edge.offline_queue import OfflineQueue
from edge.whitelist_sync import load_local, is_blacklisted_local, start_sync

# ── GPIO init ─────────────────────────────────────────────────────────
GPIO.setmode(GPIO.BCM)
GPIO.setup(cfg.RELAY_PIN, GPIO.OUT, initial=GPIO.LOW)

# ── Shared state ──────────────────────────────────────────────────────
_lock        = threading.Lock()
_is_open     = False
_online      = False
_seen_ids:   dict[str, float] = {}   # event_id → ts, dedup window 60s
_oq          = OfflineQueue(cfg.OFFLINE_QUEUE_PATH)
_mqtt_client = None
_recent_fastag: dict[str, dict] = {}  # tid_hash → {ts, decision}
_recent_anpr:   dict[str, dict] = {}  # plate → {ts, confidence}

# ── Relay control ─────────────────────────────────────────────────────
_close_timer: threading.Timer | None = None

def open_gate(dur: float = None) -> bool:
    global _is_open, _close_timer
    d = dur or cfg.RELAY_OPEN_SECONDS
    with _lock:
        if _is_open:
            # Extend the open duration by resetting the close timer
            if _close_timer:
                _close_timer.cancel()
            _close_timer = threading.Timer(d, _close_gate)
            _close_timer.daemon = True
            _close_timer.start()
            log.info(f"GATE OPEN extended ({d}s)")
            return False
        _is_open = True
        GPIO.output(cfg.RELAY_PIN, GPIO.HIGH)
        _close_timer = threading.Timer(d, _close_gate)
        _close_timer.daemon = True
        _close_timer.start()
        log.info(f"GATE OPEN  ({d}s)")
    return True

def _close_gate():
    global _is_open, _close_timer
    with _lock:
        GPIO.output(cfg.RELAY_PIN, GPIO.LOW)
        _is_open = False
        _close_timer = None
        log.info("GATE CLOSED")

# ── Auto-pair helper ─────────────────────────────────────────────────
def _try_auto_pair(tid_hash: str, plate: str):
    """Attempt to auto-pair an unknown FASTag TID with a known plate."""
    try:
        r = requests.post(f"{cfg.CLOUD_API_URL}/vehicles/auto-pair",
                          json={"community_id": cfg.COMMUNITY_ID,
                                "plate": plate,
                                "fastag_tid_hash": tid_hash},
                          headers={"X-Device-Token": cfg.DEVICE_TOKEN}, timeout=3.0)
        if r.status_code == 200:
            log.info(f"AUTO-PAIRED: {plate} → {tid_hash[:12]}...")
        else:
            log.warning(f"Auto-pair failed ({r.status_code}): {r.text[:200]}")
    except Exception as e:
        log.warning(f"Auto-pair error: {e}")

# ── FASTag detection (Tier 1 — instant) ──────────────────────────────
def handle_fastag(event: dict):
    tid_hash = event["tid_hash"]
    if not tid_hash:
        return
    log.info(f"FASTag detected: {tid_hash[:12]}... RSSI={event.get('rssi')}")

    # Store for correlation with ANPR
    _recent_fastag[tid_hash] = {"ts": time.time(), "decision": None}
    # Clean old entries
    now = time.time()
    for k in [k for k, v in _recent_fastag.items() if now - v["ts"] > 30]:
        del _recent_fastag[k]

    # Immediate lookup
    if is_blacklisted_local(cfg.OFFLINE_DB_PATH, "fastag", tid_hash):
        _recent_fastag[tid_hash]["decision"] = "deny"
        log.info(f"DENIED (blacklisted FASTag)")
        _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                      "detection_method": "fastag", "raw_value": tid_hash,
                      "access_decision": "deny", "deny_reason": "blacklisted",
                      "is_offline_event": not _online, "event_ts": time.time()})
        return

    if _online:
        result = _cloud_check("fastag", tid_hash)
        if result and result["decision"] == "allow":
            _recent_fastag[tid_hash]["decision"] = "allow"
            threading.Thread(target=open_gate, daemon=True).start()
            log.info(f"GRANTED (FASTag) → {result.get('unit_number')} ({result.get('resident_name')})")
            _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                          "detection_method": "fastag", "raw_value": tid_hash,
                          "access_decision": "allow", "is_offline_event": False,
                          "event_ts": time.time()})
            return

    # Offline or cloud miss — try local
    local = load_local(cfg.OFFLINE_DB_PATH, "fastag", tid_hash)
    if local:
        _recent_fastag[tid_hash]["decision"] = "allow"
        threading.Thread(target=open_gate, daemon=True).start()
        log.info(f"GRANTED (FASTag local) → {local.get('unit_number')}")
        _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                      "detection_method": "fastag", "raw_value": tid_hash,
                      "access_decision": "allow", "is_offline_event": not _online,
                      "event_ts": time.time()})
        return

    # Unknown FASTag — wait for ANPR correlation
    _recent_fastag[tid_hash]["decision"] = "pending"
    log.info(f"Unknown FASTag {tid_hash[:12]}... — waiting for ANPR correlation")

# ── Access decision ───────────────────────────────────────────────────
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

def handle_detection(method: str, value: str, confidence: float = None):
    if not value: return
    log.info(f"Detection method={method} value={value} conf={confidence}")

    # For ANPR: check correlation with recent unknown FASTag
    if method == "anpr":
        _recent_anpr[value] = {"ts": time.time(), "confidence": confidence}
        # Clean old ANPR entries
        now = time.time()
        for k in [k for k, v in _recent_anpr.items() if now - v["ts"] > 30]:
            del _recent_anpr[k]

        # Try to correlate with pending FASTag
        for tid_hash, ftag in list(_recent_fastag.items()):
            if ftag["decision"] == "pending" and (now - ftag["ts"]) < cfg.FASTAG_CORRELATION_WINDOW:
                # We have an unknown FASTag + ANPR result — check if plate is known
                if is_blacklisted_local(cfg.OFFLINE_DB_PATH, "anpr", value):
                    ftag["decision"] = "deny"
                    log.info(f"DENIED (plate blacklisted during FASTag correlation)")
                    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                                  "detection_method": "anpr", "raw_value": value,
                                  "access_decision": "deny", "deny_reason": "blacklisted",
                                  "anpr_confidence": confidence, "is_offline_event": not _online,
                                  "event_ts": time.time()})
                    return

                plate_result = None
                if _online:
                    plate_result = _cloud_check("anpr", value, confidence)
                if not plate_result:
                    plate_result = _local_check("anpr", value)

                if plate_result and plate_result["decision"] == "allow":
                    ftag["decision"] = "allow"
                    threading.Thread(target=open_gate, daemon=True).start()
                    log.info(f"GRANTED (ANPR correlated) → {plate_result.get('unit_number')}")
                    # Auto-pair in background
                    if _online:
                        threading.Thread(target=_try_auto_pair, args=(tid_hash, value), daemon=True).start()
                    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                                  "detection_method": "anpr", "raw_value": value,
                                  "access_decision": "allow", "anpr_confidence": confidence,
                                  "is_offline_event": not _online, "event_ts": time.time()})
                    return
                else:
                    ftag["decision"] = "guard_review"
                    log.info(f"GUARD REVIEW — unknown FASTag + unknown plate {value}")
                    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                                  "detection_method": "anpr", "raw_value": value,
                                  "access_decision": "guard_review", "deny_reason": "not_recognized",
                                  "anpr_confidence": confidence, "is_offline_event": not _online,
                                  "event_ts": time.time()})
                    return

    # Standard (non-correlated) access check — for ANPR without pending FASTag
    if is_blacklisted_local(cfg.OFFLINE_DB_PATH, method, value):
        result = {"decision": "deny", "reason": "blacklisted"}
    elif _online:
        result = _cloud_check(method, value, confidence) or _local_check(method, value)
    else:
        result = _local_check(method, value)
    decision = result["decision"]
    if decision == "allow":
        threading.Thread(target=open_gate, daemon=True).start()
        log.info(f"GRANTED → {result.get('unit_number')} ({result.get('resident_name')})")
    else:
        log.info(f"DENIED — {result.get('reason')}")
    _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                 "detection_method": method, "raw_value": value,
                 "access_decision": decision, "deny_reason": result.get("reason"),
                 "anpr_confidence": confidence, "is_offline_event": not _online,
                 "event_ts": time.time()})

# ── MQTT ──────────────────────────────────────────────────────────────
def _on_command(client, userdata, msg):
    try:
        cmd = json.loads(msg.payload)
        eid = cmd.get("event_id","")
        ttl = cmd.get("ttl")
        if ttl is not None and ttl < time.time():
            log.warning(f"TTL expired — command {eid} rejected"); return
        now = time.time()
        if _seen_ids.get(eid,0) > now-60:
            log.warning(f"Duplicate command {eid} ignored"); return
        _seen_ids[eid] = now
        for k in [k for k,v in _seen_ids.items() if v < now-60]: del _seen_ids[k]
        if cmd.get("action") == "open":
            threading.Thread(target=open_gate, daemon=True).start()
            if client:
                client.publish(f"cg/{cfg.COMMUNITY_ID}/gates/{cfg.GATE_ID}/ack",
                               json.dumps({"event_id":eid,"status":"opened",
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
    log.info(f"CommunityGate starting — gate={cfg.GATE_ID} type={cfg.GATE_TYPE}")
    start_sync()   # whitelist sync scheduler
    start_mqtt()

    if cfg.GATE_TYPE == "exit":
        # Exit gate: auto-open on presence, camera for audit only
        log.info("EXIT gate mode — auto-open, camera audit only")
        if cfg.USE_CAMERA_MOCK:
            cam = CameraImpl(anpr_url=cfg.ANPR_SERVICE_URL,
                             plates_dir=cfg.MOCK_CAMERA_PLATE_DIR,
                             interval=cfg.MOCK_CAMERA_INTERVAL)
        else:
            cam = CameraImpl(rtsp_url=os.environ["RTSP_CAMERA_URL"],
                             anpr_url=cfg.ANPR_SERVICE_URL)
        cam.start(on_detection=lambda r:
            _oq.enqueue({"community_id": cfg.COMMUNITY_ID, "gate_id": cfg.GATE_ID,
                         "detection_method": "anpr", "raw_value": r.get("plate", ""),
                         "access_decision": "allow", "deny_reason": None,
                         "anpr_confidence": r.get("confidence"),
                         "is_offline_event": not _online, "event_ts": time.time()})
            if r.get("plate") else None)
    else:
        # Entry gate: UHF FASTag + ANPR
        # UHF reader
        if cfg.USE_UHF_MOCK:
            uhf = UHFImpl(on_tag_callback=handle_fastag)
            uhf.run_scenario([{"tag": "RESIDENT_301", "delay": 8},
                              {"tag": "VISITOR", "delay": 12},
                              {"tag": "UNKNOWN", "delay": 15}], loop=True)
        else:
            uhf = UHFImpl(on_tag_callback=handle_fastag,
                          port=cfg.UHF_READER_PORT, baud=cfg.UHF_READER_BAUD,
                          debounce=cfg.UHF_DEBOUNCE, rssi_threshold=cfg.UHF_RSSI_THRESHOLD)
            threading.Thread(target=uhf.run, daemon=True).start()

        # Camera / ANPR (async)
        if cfg.USE_CAMERA_MOCK:
            cam = CameraImpl(anpr_url=cfg.ANPR_SERVICE_URL,
                             plates_dir=cfg.MOCK_CAMERA_PLATE_DIR,
                             interval=cfg.MOCK_CAMERA_INTERVAL)
        else:
            cam = CameraImpl(rtsp_url=os.environ["RTSP_CAMERA_URL"],
                             anpr_url=cfg.ANPR_SERVICE_URL)
        cam.start(on_detection=lambda r:
            handle_detection("anpr", r["plate"], r.get("confidence"))
            if r.get("plate") and r.get("confidence", 0) >= cfg.ANPR_THRESHOLD else None)

    log.info("Gate controller running. CTRL+C to stop.")
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        if 'cam' in dir(): cam.stop()
        GPIO.cleanup()
        if _mqtt_client: _mqtt_client.loop_stop()

if __name__ == "__main__": main()
