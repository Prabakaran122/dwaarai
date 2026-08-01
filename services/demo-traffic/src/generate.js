import jwt from 'jsonwebtoken';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { DEMO_COMMUNITY_ID, GATES, assertDemoCommunity, config } from './config.js';
import { buildEvent } from './event.js';
import { ratePerHour, nextGapMs, mulberry32, istClock } from './rhythm.js';
import { newDelivery, newPass, insertTrickle } from './trickle.js';
import { buildPopulation } from './population.js';

const TOKEN_TTL_SECONDS = 24 * 3600;
const TOKEN_REFRESH_MS = 12 * 3600 * 1000;

/**
 * Read the seeded society back out of the database.
 *
 * The generator must reference the ids that actually exist in the rows, so it
 * queries them rather than regenerating a population whose ids would differ.
 * Shape matches what buildEvent expects from buildPopulation().
 */
export async function loadPopulation(client) {
  const { rows: units } = await client.query(
    `SELECT id, unit_number AS "unitNumber", status FROM units WHERE community_id = $1`,
    [DEMO_COMMUNITY_ID]
  );
  const { rows: residents } = await client.query(
    `SELECT id, unit_id AS "unitId", name, type, is_primary AS "isPrimary"
       FROM residents WHERE community_id = $1`,
    [DEMO_COMMUNITY_ID]
  );
  const { rows: vehicles } = await client.query(
    `SELECT id, unit_id AS "unitId", resident_id AS "residentId", plate
       FROM vehicles WHERE community_id = $1 AND is_active = true`,
    [DEMO_COMMUNITY_ID]
  );
  return {
    units,
    residents: residents.filter((r) => r.type !== 'guard'),
    vehicles,
    guards: residents.filter((r) => r.type === 'guard'),
  };
}

export function deviceToken(gateId, secret) {
  return jwt.sign(
    { community_id: DEMO_COMMUNITY_ID, gate_id: gateId },
    secret,
    { expiresIn: TOKEN_TTL_SECONDS }
  );
}

export async function postEvent(payload, { apiBase, token, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${apiBase}/events/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
      body: JSON.stringify({ events: [payload] }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    // Never throw: the API restarting must not take the generator with it.
    console.error('[demo-traffic] post failed:', err.message);
    return { ok: false, status: 0 };
  }
}

// Rate-limits the "posts are failing" log so a sustained API outage cannot
// flood the systemd journal: log the first failure, then at most one line per
// minute, and log once when posting recovers.
const FAILURE_LOG_INTERVAL_MS = 60 * 1000;
let lastFailureLogAt = 0;
let wasFailing = false;

function logPostResult(result) {
  if (!result.ok) {
    const now = Date.now();
    if (!wasFailing || now - lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS) {
      console.error(`[demo-traffic] event post failed — status ${result.status}`);
      lastFailureLogAt = now;
    }
    wasFailing = true;
  } else if (wasFailing) {
    console.log('[demo-traffic] event posting recovered');
    wasFailing = false;
  }
}

function pickGate(rand) {
  let roll = rand();
  for (const gate of GATES) {
    roll -= gate.share;
    if (roll <= 0) return gate;
  }
  return GATES[GATES.length - 1];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// How long to wait before trying to re-open a dropped database connection.
const DB_RETRY_MS = 60 * 1000;

/**
 * A pg.Client with an 'error' listener attached.
 *
 * node-postgres emits 'error' on the Client whenever the backend connection
 * drops — a Postgres restart, a network blip, an idle-session timeout. An
 * 'error' event with no listener is thrown by EventEmitter and, being emitted
 * asynchronously outside any await, becomes an uncaught exception that kills
 * the process. The generator is a long-running always-on feed; it must outlive
 * a database restart, so the listener logs and notifies the caller instead.
 */
export function connectDb(databaseUrl, onLost) {
  const client = new pg.Client({ connectionString: databaseUrl });
  client.on('error', (err) => {
    console.error('[demo-traffic] database connection lost:', err.message);
    onLost(err);
  });
  return client;
}

async function main() {
  const { apiBase, jwtSecret, databaseUrl, dryRun, communityId } = config(process.env);
  // Assert the *resolved* id, not the module constant: COMMUNITY_ID can be
  // overridden from the environment, and a misconfigured unit must fail loudly
  // here rather than have this process write traffic into a real society.
  assertDemoCommunity(communityId);

  // Load the society from the database, NOT from buildPopulation(): ids are
  // minted per-run, so a rebuilt population would reference rows that were
  // never inserted. See the amendment note in this task.
  //
  // The one exception: a standalone DRY_RUN with no DATABASE_URL, where nothing
  // is ever posted or inserted, so a mismatched id can never leave this process.
  // The `!db && !dryRun` guard below makes that a structural impossibility
  // rather than a convention someone could accidentally violate — buildPopulation
  // is only reachable when dryRun is true and there is no db to write ids into.
  //
  // The database is used *only* for the delivery/visitor trickle. Gate traffic
  // goes out over HTTP and needs no database at all, so a dead Postgres pauses
  // the trickle and nothing else — see the loop below.
  let dbUp = false;
  let db = databaseUrl ? connectDb(databaseUrl, () => { dbUp = false; }) : null;
  if (db) {
    await db.connect();
    dbUp = true;
  }
  if (!db && !dryRun) {
    throw new Error('DATABASE_URL is required unless DRY_RUN=true');
  }
  const pop = db ? await loadPopulation(db) : buildPopulation(2043);
  if (db && !pop.vehicles.length) {
    throw new Error('no vehicles found for the demo community — run src/seed.js first');
  }
  const rand = mulberry32(Date.now() % 2 ** 31);

  let tokens = Object.fromEntries(GATES.map((g) => [g.id, deviceToken(g.id, jwtSecret)]));
  let tokensMintedAt = Date.now();
  let nextDbRetryAt = 0;

  console.log(`[demo-traffic] started — ${dryRun ? 'DRY RUN' : apiBase}`);

  for (;;) {
    if (Date.now() - tokensMintedAt > TOKEN_REFRESH_MS) {
      tokens = Object.fromEntries(GATES.map((g) => [g.id, deviceToken(g.id, jwtSecret)]));
      tokensMintedAt = Date.now();
    }

    const now = new Date();
    // Asia/Kolkata, never the server's zone: the box runs on UTC and the
    // dashboard buckets in IST, so a local-time read would put the morning
    // peak on screen at half past one in the afternoon.
    const { hour, isWeekend } = istClock(now);
    const rate = ratePerHour(hour, isWeekend);
    const gate = pickGate(rand);
    const payload = buildEvent({ pop, gate, at: now, rand });

    if (dryRun) {
      console.log(JSON.stringify(payload));
    } else {
      const result = await postEvent(payload, { apiBase, token: tokens[gate.id] });
      logPostResult(result);
    }

    // A dropped connection cannot be re-opened on the same pg.Client, so build a
    // fresh one, at most once a minute. Failing to reconnect is logged and
    // shrugged off — the gate feed above has already been posted regardless.
    if (databaseUrl && !dbUp && Date.now() >= nextDbRetryAt) {
      nextDbRetryAt = Date.now() + DB_RETRY_MS;
      db.end().catch(() => {});                       // best effort on the dead one
      db = connectDb(databaseUrl, () => { dbUp = false; });
      try {
        await db.connect();
        dbUp = true;
        console.log('[demo-traffic] database reconnected — trickle resumed');
      } catch (err) {
        console.error('[demo-traffic] database reconnect failed:', err.message);
      }
    }

    // A few parcels and visitor passes an hour, independent of gate traffic.
    // Skipped entirely while the database is down: this is the only part of the
    // loop that needs it, and gate events must keep flowing without it.
    if (db && dbUp && rand() < 0.03) {
      await insertTrickle(db, newDelivery(pop, rand, now), 'deliveries').catch((e) =>
        console.error('[demo-traffic] delivery insert failed:', e.message));
    }
    if (db && dbUp && rand() < 0.02) {
      const pass = newPass(pop, rand, now);
      if (pass) {
        await insertTrickle(db, pass, 'visitor_passes').catch((e) =>
          console.error('[demo-traffic] pass insert failed:', e.message));
      }
    }

    await sleep(nextGapMs(rate, rand));
  }
}

// pathToFileURL handles Windows drive-letter paths and backslashes correctly;
// a plain `file://${process.argv[1]}` string comparison silently never matches
// on Windows (backslashes, missing extra leading slash), so `main()` would
// never run when this file is executed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[demo-traffic] fatal:', err);
    process.exit(1);
  });
}
