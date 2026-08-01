import jwt from 'jsonwebtoken';
import pg from 'pg';
import { DEMO_COMMUNITY_ID, GATES, assertDemoCommunity, config } from './config.js';
import { buildEvent } from './event.js';
import { ratePerHour, nextGapMs, mulberry32 } from './rhythm.js';
import { newDelivery, newPass, insertTrickle } from './trickle.js';

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
    `SELECT id, unit_number AS "unitNumber" FROM units WHERE community_id = $1`,
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

function pickGate(rand) {
  let roll = rand();
  for (const gate of GATES) {
    roll -= gate.share;
    if (roll <= 0) return gate;
  }
  return GATES[GATES.length - 1];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { apiBase, jwtSecret, databaseUrl, dryRun } = config(process.env);
  assertDemoCommunity(DEMO_COMMUNITY_ID);

  // Load the society from the database, NOT from buildPopulation(): ids are
  // minted per-run, so a rebuilt population would reference rows that were
  // never inserted. See the amendment note in this task.
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const pop = await loadPopulation(db);
  if (!pop.vehicles.length) {
    throw new Error('no vehicles found for the demo community — run src/seed.js first');
  }
  const rand = mulberry32(Date.now() % 2 ** 31);

  let tokens = Object.fromEntries(GATES.map((g) => [g.id, deviceToken(g.id, jwtSecret)]));
  let tokensMintedAt = Date.now();

  console.log(`[demo-traffic] started — ${dryRun ? 'DRY RUN' : apiBase}`);

  for (;;) {
    if (Date.now() - tokensMintedAt > TOKEN_REFRESH_MS) {
      tokens = Object.fromEntries(GATES.map((g) => [g.id, deviceToken(g.id, jwtSecret)]));
      tokensMintedAt = Date.now();
    }

    const now = new Date();
    const day = now.getDay();
    const rate = ratePerHour(now.getHours(), day === 0 || day === 6);
    const gate = pickGate(rand);
    const payload = buildEvent({ pop, gate, at: now, rand });

    if (dryRun) {
      console.log(JSON.stringify(payload));
    } else {
      await postEvent(payload, { apiBase, token: tokens[gate.id] });
    }

    // A few parcels and visitor passes an hour, independent of gate traffic.
    if (db && rand() < 0.03) {
      await insertTrickle(db, newDelivery(pop, rand, now), 'deliveries').catch((e) =>
        console.error('[demo-traffic] delivery insert failed:', e.message));
    }
    if (db && rand() < 0.02) {
      await insertTrickle(db, newPass(pop, rand, now), 'visitor_passes').catch((e) =>
        console.error('[demo-traffic] pass insert failed:', e.message));
    }

    await sleep(nextGapMs(rate, rand));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[demo-traffic] fatal:', err);
    process.exit(1);
  });
}
