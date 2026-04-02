import sqlite3, requests, time, threading, logging, schedule
from edge.config import cfg
log = logging.getLogger("whitelist_sync")

def _init_db():
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
            c.execute("UPDATE sync_meta SET last_sync=? WHERE id=1",(time.time(),))
        log.info(f"Synced {len(d['vehicles'])} vehicles, {len(d.get('blacklist',[]))} blacklisted, {len(d.get('rfid_cards',[]))} rfid cards")
    except Exception as e:
        log.warning(f"Sync failed, using cache: {e}")

def load_local(db, method, value):
    if method == "anpr":
        col = "plate"
    elif method == "fastag":
        col = "fastag_tid_hash"
    else:
        col = "rfid_uid_hash"
    with sqlite3.connect(db) as c:
        row = c.execute(f"SELECT unit_id,unit_number,resident_name FROM whitelist WHERE {col}=?",(value,)).fetchone()
    if row: return {"unit_id":row[0],"unit_number":row[1],"resident_name":row[2]}
    # Fallback: check rfid_cards_cache for standalone RFID/FASTag cards
    if method in ("rfid", "fastag"):
        import time as _time
        with sqlite3.connect(db) as c:
            card = c.execute(
                "SELECT unit_id,unit_number,card_type,expires_at FROM rfid_cards_cache WHERE uid_hash=?",
                (value,)).fetchone()
        if card:
            expires_at = card[3]
            if expires_at is None or expires_at > _time.time():
                return {"unit_id":card[0],"unit_number":card[1],"resident_name":card[1] or "Card holder","card_type":card[2]}
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

def start_sync():
    _init_db(); sync_from_cloud()
    schedule.every(cfg.WHITELIST_SYNC_INTERVAL).seconds.do(sync_from_cloud)
    def _loop():
        while True: schedule.run_pending(); time.sleep(10)
    threading.Thread(target=_loop, daemon=True).start()
