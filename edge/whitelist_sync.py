import os, sqlite3, requests, time, threading, logging, schedule, re
from edge.config import cfg
log = logging.getLogger("whitelist_sync")

_PLATE_RE = re.compile(r'[^A-Za-z0-9]')

def _norm_plate(p):
    """Match the ANPR receiver's normalization (strip non-alnum, uppercase)."""
    return _PLATE_RE.sub('', p or '').upper()

def _iso_ts(s):
    """ISO-8601 string (or None) -> epoch seconds (or None)."""
    if not s:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None

def _init_db():
    # Create the state dir first — on Windows there's no systemd StateDirectory to
    # make it, so sqlite3.connect() would otherwise fail with "unable to open
    # database file" on a fresh box. (offline_queue.py does the same for its DB.)
    d = os.path.dirname(cfg.OFFLINE_DB_PATH)
    if d:
        os.makedirs(d, exist_ok=True)
    with sqlite3.connect(cfg.OFFLINE_DB_PATH) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS whitelist(
            plate TEXT, rfid_uid_hash TEXT, fastag_tid_hash TEXT,
            unit_id TEXT, unit_number TEXT, resident_name TEXT)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_wl_p ON whitelist(plate)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_wl_r ON whitelist(rfid_uid_hash)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_wl_f ON whitelist(fastag_tid_hash)")
        c.execute("""CREATE TABLE IF NOT EXISTS blacklist_cache(
            plate TEXT, rfid_uid_hash TEXT, fastag_tid_hash TEXT)""")
        c.execute("CREATE TABLE IF NOT EXISTS sync_meta(id INT PRIMARY KEY,last_sync REAL)")
        c.execute("INSERT OR IGNORE INTO sync_meta VALUES(1,0)")
        c.execute("""CREATE TABLE IF NOT EXISTS rfid_cards_cache(
            uid_hash TEXT, card_type TEXT, unit_id TEXT,
            unit_number TEXT, expires_at REAL)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_rcc_uid ON rfid_cards_cache(uid_hash)")
        # Plate-based VISITOR passes: temporary, plate-only, with a validity
        # window. Separate from the (permanent) resident `whitelist` so expiry is
        # enforced locally/offline and these are never auto-paired.
        c.execute("""CREATE TABLE IF NOT EXISTS plate_passes_cache(
            plate TEXT, unit_id TEXT, unit_number TEXT, holder_name TEXT,
            valid_from REAL, expires_at REAL)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_ppc_p ON plate_passes_cache(plate)")

def sync_from_cloud():
    try:
        r = requests.get(f"{cfg.CLOUD_API_URL}/whitelist/sync",
                         headers={"X-Device-Token":cfg.DEVICE_TOKEN},
                         params={"community_id":cfg.COMMUNITY_ID}, timeout=30)
        d = r.json()["data"]
        with sqlite3.connect(cfg.OFFLINE_DB_PATH) as c:
            c.execute("DELETE FROM whitelist")
            c.executemany("INSERT INTO whitelist VALUES(?,?,?,?,?,?)",
                [(v["plate"],v.get("rfid_uid_hash"),v.get("fastag_tid_hash"),
                  v["unit_id"],v["unit_number"],v["resident_name"]) for v in d["vehicles"]])
            c.execute("DELETE FROM blacklist_cache")
            c.executemany("INSERT INTO blacklist_cache VALUES(?,?,?)",
                [(b.get("plate"),b.get("rfid_uid_hash"),b.get("fastag_tid_hash")) for b in d.get("blacklist",[])])
            c.execute("DELETE FROM rfid_cards_cache")
            for card in d.get("rfid_cards", []):
                exp = card.get("expires_at")
                exp_ts = None
                if exp:
                    from datetime import datetime, timezone
                    exp_ts = datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp()
                c.execute("INSERT INTO rfid_cards_cache VALUES(?,?,?,?,?)",
                    (card["uid_hash"], card.get("card_type"),
                     card.get("unit_id"), card.get("unit_number"), exp_ts))
            # Plate-based visitor passes (plate + validity window).
            c.execute("DELETE FROM plate_passes_cache")
            for vp in d.get("visitor_passes", []):
                c.execute("INSERT INTO plate_passes_cache VALUES(?,?,?,?,?,?)",
                    (_norm_plate(vp.get("plate")), vp.get("unit_id"), vp.get("unit_number"),
                     vp.get("holder_name") or vp.get("visitor_name"),
                     _iso_ts(vp.get("valid_from")), _iso_ts(vp.get("expires_at"))))
            c.execute("UPDATE sync_meta SET last_sync=? WHERE id=1",(time.time(),))
        log.info(f"Synced {len(d['vehicles'])} vehicles, {len(d.get('blacklist',[]))} blacklisted, "
                 f"{len(d.get('rfid_cards',[]))} rfid cards, {len(d.get('visitor_passes',[]))} visitor passes")
    except Exception as e:
        log.warning(f"Sync failed, using cache: {e}")

def load_local(db, method, value):
    if method == "anpr":
        col = "plate"; value = _norm_plate(value)
    elif method == "fastag":
        col = "fastag_tid_hash"
    else:
        col = "rfid_uid_hash"
    with sqlite3.connect(db) as c:
        row = c.execute(f"SELECT unit_id,unit_number,resident_name FROM whitelist WHERE {col}=?",(value,)).fetchone()
    if row:
        # Permanent resident record. For a plate this is a resident VEHICLE —
        # pairable (auto-pair) and no expiry.
        kind = "resident_vehicle" if method == "anpr" else "resident"
        return {"unit_id":row[0],"unit_number":row[1],"resident_name":row[2],"kind":kind}
    now = time.time()
    # Plate VISITOR pass: temporary, plate-only, validity-windowed, NOT pairable.
    # Enforced here so it expires correctly even OFFLINE (no cloud needed).
    if method == "anpr":
        with sqlite3.connect(db) as c:
            p = c.execute("SELECT unit_id,unit_number,holder_name,valid_from,expires_at "
                          "FROM plate_passes_cache WHERE plate=?", (value,)).fetchone()
        if p:
            valid_from, expires_at = p[3], p[4]
            if (valid_from is None or valid_from <= now) and (expires_at is None or expires_at > now):
                return {"unit_id":p[0],"unit_number":p[1],"resident_name":p[2] or "Visitor",
                        "kind":"visitor_pass","valid_from":valid_from,"expires_at":expires_at}
            # window not active -> not a match (denied/guard-review, even offline)
    # Fallback: standalone RFID/FASTag cards with their own expiry.
    if method in ("rfid", "fastag"):
        with sqlite3.connect(db) as c:
            card = c.execute(
                "SELECT unit_id,unit_number,card_type,expires_at FROM rfid_cards_cache WHERE uid_hash=?",
                (value,)).fetchone()
        if card:
            expires_at = card[3]
            if expires_at is None or expires_at > now:
                return {"unit_id":card[0],"unit_number":card[1],"resident_name":card[1] or "Card holder",
                        "card_type":card[2],"kind":"rfid_card"}
    return None

def is_blacklisted_local(db, method, value) -> bool:
    if method == "anpr":
        col = "plate"
    elif method == "fastag":
        col = "fastag_tid_hash"
    else:
        col = "rfid_uid_hash"
    with sqlite3.connect(db) as c:
        return c.execute(f"SELECT 1 FROM blacklist_cache WHERE {col}=?",(value,)).fetchone() is not None

def _fmt_c3_time(epoch):
    """Epoch seconds -> 'YYYY-MM-DD HH:MM:SS' (local) for the C3 StartTime/EndTime
    field, so the panel enforces a card's validity window itself — offline."""
    from datetime import datetime
    return datetime.fromtimestamp(epoch).strftime("%Y-%m-%d %H:%M:%S")

def classify_card(db, card_number):
    """Resolve a C3 card number (the hash we pushed) to (method, unit_id,
    unit_number). method is 'fastag' | 'rfid' | 'card' (unknown / roster lag).
    A single card can only be one of FASTag or RFID, so first match wins."""
    with sqlite3.connect(db) as c:
        row = c.execute("SELECT unit_id, unit_number FROM whitelist WHERE fastag_tid_hash=?",
                        (card_number,)).fetchone()
        if row:
            return ("fastag", row[0], row[1])
        row = c.execute("SELECT unit_id, unit_number FROM whitelist WHERE rfid_uid_hash=?",
                        (card_number,)).fetchone()
        if row:
            return ("rfid", row[0], row[1])
        row = c.execute("SELECT unit_id, unit_number FROM rfid_cards_cache WHERE uid_hash=?",
                        (card_number,)).fetchone()
        if row:
            return ("rfid", row[0], row[1])
    return ("card", None, None)

def push_cards_to_c3(db, c3):
    """Provision every resident credential onto the C3 so it matches LOCALLY
    (sub-second, works offline): FASTag TIDs + RFID UIDs (resident vehicles) +
    standalone RFID cards (bikes / house-help). Expiring RFID cards are pushed
    with a validity window so the panel self-enforces expiry offline (sync_cards
    only adds/updates — it never removes, so an un-windowed expired card would
    keep opening). Blacklisted FASTag + RFID hashes are removed from the panel.

    Returns the count of cards provisioned (permanent + still-valid expiring)."""
    if not c3 or not c3.is_connected():
        log.warning("C3 not connected — skipping card push")
        return 0
    with sqlite3.connect(db) as c:
        fastag = c.execute("SELECT fastag_tid_hash FROM whitelist "
                           "WHERE fastag_tid_hash IS NOT NULL AND fastag_tid_hash != ''").fetchall()
        rfid_res = c.execute("SELECT rfid_uid_hash FROM whitelist "
                           "WHERE rfid_uid_hash IS NOT NULL AND rfid_uid_hash != ''").fetchall()
        rfid_perm = c.execute("SELECT uid_hash FROM rfid_cards_cache "
                           "WHERE uid_hash IS NOT NULL AND uid_hash != '' AND expires_at IS NULL").fetchall()
        rfid_exp = c.execute("SELECT uid_hash, expires_at FROM rfid_cards_cache "
                           "WHERE uid_hash IS NOT NULL AND uid_hash != '' AND expires_at IS NOT NULL").fetchall()
    # Permanent credentials (no validity window) — one deduped bulk push.
    bulk = {r[0] for r in fastag} | {r[0] for r in rfid_res} | {r[0] for r in rfid_perm}
    count = c3.sync_cards(sorted(bulk))
    # Expiring standalone RFID cards — push with EndTime so the panel expires them.
    now = time.time()
    expiring = 0
    for uid, exp in rfid_exp:
        if exp is None or exp <= now or uid in bulk:
            continue  # already expired (don't provision) or superseded by a permanent card
        c3.add_card(uid, valid_until=_fmt_c3_time(exp))
        expiring += 1
    # Blacklist — remove FASTag AND RFID hashes from the panel.
    with sqlite3.connect(db) as c:
        blocked = c.execute("SELECT fastag_tid_hash, rfid_uid_hash FROM blacklist_cache").fetchall()
    nblk = 0
    for tid, uid in blocked:
        for v in (tid, uid):
            if v:
                c3.block_card(v); nblk += 1
    log.info(f"Pushed {count} permanent + {expiring} expiring card(s), {nblk} blocked to C3")
    return count + expiring

_c3_ref = None

def start_sync(c3=None):
    global _c3_ref
    _c3_ref = c3
    _init_db(); sync_from_cloud()
    if _c3_ref:
        push_cards_to_c3(cfg.OFFLINE_DB_PATH, _c3_ref)
    schedule.every(cfg.WHITELIST_SYNC_INTERVAL).seconds.do(_sync_and_push)
    def _loop():
        while True: schedule.run_pending(); time.sleep(10)
    threading.Thread(target=_loop, daemon=True).start()

def _sync_and_push():
    sync_from_cloud()
    if _c3_ref:
        push_cards_to_c3(cfg.OFFLINE_DB_PATH, _c3_ref)
