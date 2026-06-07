import os, sqlite3, json, time, uuid as _uuid, logging, requests
log = logging.getLogger("offline_queue")

class OfflineQueue:
    def __init__(self, path):
        self.path = path
        # Ensure the parent directory exists (persistent paths like
        # /var/lib/communitygate/ won't exist on a fresh install).
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with sqlite3.connect(path) as c:
            c.execute("""CREATE TABLE IF NOT EXISTS pending_events (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL,
                created_at REAL NOT NULL, synced INTEGER DEFAULT 0)""")

    def enqueue(self, event: dict):
        eid = event.get("event_id") or str(_uuid.uuid4())
        with sqlite3.connect(self.path) as c:
            c.execute("INSERT OR IGNORE INTO pending_events VALUES(?,?,?,0)",
                      (eid, json.dumps(event), time.time()))

    def sync(self, api_url: str, token: str, batch=50) -> int:
        with sqlite3.connect(self.path) as c:
            rows = c.execute("SELECT id,payload FROM pending_events"
                             " WHERE synced=0 ORDER BY created_at LIMIT ?",
                             (batch,)).fetchall()
        if not rows: return 0
        events = [{"event_id":r[0], **json.loads(r[1])} for r in rows]
        try:
            resp = requests.post(f"{api_url}/events/sync",
                                 json={"events":events},
                                 headers={"X-Device-Token":token}, timeout=30)
            if resp.status_code == 200:
                with sqlite3.connect(self.path) as c:
                    c.executemany("DELETE FROM pending_events WHERE id=?",
                                 [(r[0],) for r in rows])
                log.info(f"Synced {len(rows)} offline events"); return len(rows)
        except Exception as e:
            log.warning(f"Sync failed: {e}")
        return 0

    def pending_count(self) -> int:
        with sqlite3.connect(self.path) as c:
            return c.execute("SELECT COUNT(*) FROM pending_events WHERE synced=0").fetchone()[0]
