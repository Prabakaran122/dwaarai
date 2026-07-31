import os, sqlite3, json, time, uuid as _uuid, logging, requests
from datetime import datetime, timezone
log = logging.getLogger("offline_queue")

# HTTP statuses that mean "this payload will NEVER be accepted" — retrying the
# same bytes is pointless. Everything else (401/403/429/5xx/network) is treated
# as transient so a rotated token or a brief outage can't destroy the queue.
_PERMANENT_REJECT = {400, 422}

# A single event the cloud permanently rejects this many times is quarantined:
# kept in the DB for inspection but skipped by sync, so one malformed record
# can't hold every event behind it hostage forever.
MAX_ATTEMPTS = 3


def to_iso8601(ts) -> str:
    """Render an event timestamp the way the cloud contract requires.

    POST /events/sync validates `event_ts` with zod's `.datetime()`, which
    accepts ONLY UTC ISO-8601 ending in `Z`. Every edge call site naturally
    produces a float epoch (time.time()), which the API rejects with 400 — so
    normalise here, at the one boundary all events pass through, rather than
    trusting a dozen call sites to remember.
    """
    if isinstance(ts, str):
        return ts                      # caller already formatted it
    if ts is None:
        ts = time.time()
    dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


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
                created_at REAL NOT NULL, synced INTEGER DEFAULT 0,
                attempts INTEGER DEFAULT 0)""")
            # Existing gates in the field have the pre-attempts schema.
            cols = {r[1] for r in c.execute("PRAGMA table_info(pending_events)")}
            if "attempts" not in cols:
                c.execute("ALTER TABLE pending_events ADD COLUMN attempts INTEGER DEFAULT 0")

    def enqueue(self, event: dict):
        eid = event.get("event_id") or str(_uuid.uuid4())
        event = {**event, "event_ts": to_iso8601(event.get("event_ts"))}
        with sqlite3.connect(self.path) as c:
            c.execute("INSERT OR IGNORE INTO pending_events"
                      " (id, payload, created_at, synced, attempts) VALUES(?,?,?,0,0)",
                      (eid, json.dumps(event), time.time()))

    def sync(self, api_url: str, token: str, batch=50) -> int:
        with sqlite3.connect(self.path) as c:
            # rowid breaks created_at ties (clock resolution can collide on a
            # burst of events) so the drain order is strictly FIFO.
            rows = c.execute("SELECT id,payload FROM pending_events"
                             " WHERE synced=0 ORDER BY created_at, rowid LIMIT ?",
                             (batch,)).fetchall()
        if not rows: return 0

        result = self._post(api_url, token, rows)
        if result is True:
            self._delete(rows)
            log.info(f"Synced {len(rows)} offline events")
            return len(rows)
        if result is None:
            return 0                   # transient — keep the batch, try again later

        # Permanent rejection. The batch is validated as a whole, so ONE bad
        # event fails all 50 of its neighbours. Re-send individually to isolate
        # the offender instead of letting it block the queue indefinitely.
        if len(rows) == 1:
            self._reject(rows[0])
            return 0
        log.warning(f"Batch of {len(rows)} rejected — resending individually to isolate")
        synced = 0
        for row in rows:
            one = self._post(api_url, token, [row])
            if one is True:
                self._delete([row]); synced += 1
            elif one is False:
                self._reject(row)
            else:
                break                  # went transient mid-isolation; resume next cycle
        if synced:
            log.info(f"Synced {synced} offline events (isolated from a rejected batch)")
        return synced

    def _post(self, api_url: str, token: str, rows) -> bool | None:
        """POST one batch. True = accepted, False = permanently rejected,
        None = transient failure (retry the same payload later)."""
        events = [{"event_id": r[0], **json.loads(r[1])} for r in rows]
        try:
            resp = requests.post(f"{api_url}/events/sync",
                                 json={"events": events},
                                 headers={"X-Device-Token": token}, timeout=30)
        except Exception as e:
            log.warning(f"Sync failed: {e}")
            return None
        if resp.status_code == 200:
            return True
        if resp.status_code in _PERMANENT_REJECT:
            log.error(f"Cloud REJECTED {len(events)} event(s) — HTTP {resp.status_code}: "
                      f"{resp.text[:300]}")
            return False
        log.warning(f"Sync failed: HTTP {resp.status_code}")
        return None

    def _delete(self, rows):
        with sqlite3.connect(self.path) as c:
            c.executemany("DELETE FROM pending_events WHERE id=?", [(r[0],) for r in rows])

    def _reject(self, row):
        """Count a permanent rejection against one event; quarantine at the cap."""
        with sqlite3.connect(self.path) as c:
            cur = c.execute("SELECT attempts FROM pending_events WHERE id=?", (row[0],)).fetchone()
            n = (cur[0] or 0 if cur else 0) + 1
            if n >= MAX_ATTEMPTS:
                c.execute("UPDATE pending_events SET synced=-1, attempts=? WHERE id=?", (n, row[0]))
                log.error(f"Event {row[0]} rejected {n}x — QUARANTINED (kept for inspection, "
                          f"no longer blocking the queue): {row[1][:200]}")
            else:
                c.execute("UPDATE pending_events SET attempts=? WHERE id=?", (n, row[0]))

    def pending_count(self) -> int:
        with sqlite3.connect(self.path) as c:
            return c.execute("SELECT COUNT(*) FROM pending_events WHERE synced=0").fetchone()[0]

    def quarantined_count(self) -> int:
        """Events the cloud permanently refused. Non-zero means an edge/cloud
        contract mismatch that needs a human — surface it in monitoring."""
        with sqlite3.connect(self.path) as c:
            return c.execute("SELECT COUNT(*) FROM pending_events WHERE synced=-1").fetchone()[0]
