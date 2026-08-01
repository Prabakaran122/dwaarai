import { randomUUID } from 'node:crypto';
import { DEMO_COMMUNITY_ID, GATES } from './config.js';

const COURIERS = ['Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'Swiggy Instamart',
                  'Zomato', 'BigBasket', 'Delhivery', 'Blue Dart'];

const VISITOR_NAMES = ['Ravi Kumar', 'Sandeep Singh', 'Anita Rani', 'Mohit Garg',
                       'Kiran Bala', 'Ajay Thakur', 'Poonam Devi', 'Sagar Mehta'];

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

function occupiedUnit(pop, rand) {
  const occupied = pop.units.filter((u) => u.status !== 'vacant');
  return pick(occupied, rand);
}

// Units carrying `status: undefined` (a query that forgot to select it) must
// not silently pass the `!== 'vacant'` filter above. Defense in depth: even if
// occupiedUnit somehow returns a unit with no resident, callers below must not
// dereference undefined — the query and the caller are each safe alone.
function primaryResidentOf(pop, unit) {
  return pop.residents.find((r) => r.unitId === unit.id && r.isPrimary);
}

export function newDelivery(pop, rand, now) {
  const unit = occupiedUnit(pop, rand);
  const guard = pick(pop.guards, rand);
  const serviceGate = GATES.find((g) => g.type === 'service') || GATES[0];
  return {
    id: randomUUID(),
    community_id: DEMO_COMMUNITY_ID,
    gate_id: serviceGate.id,
    unit_id: unit.id,
    company: pick(COURIERS, rand),
    note: `Parcel held at gate for ${unit.unitNumber}`,
    // Real vocabulary is 'waiting' | 'delivered' | 'left_at_gate' — every
    // consumer (deliveries.js, dashboard.js, handover.js, resident-home.js)
    // filters status = 'waiting' for parcels still at the desk.
    status: 'waiting',
    logged_by: guard.id,
    logged_by_name: guard.name,
    created_at: now.toISOString(),
  };
}

/**
 * Pick an occupied unit that actually has a primary resident to attribute the
 * pass to. Tries a bounded number of times before giving up, rather than
 * trusting a single draw + `.status` filter to always line up with the
 * residents array (see Critical 1: a unit whose `status` came back undefined
 * from an incomplete query would otherwise pass the vacancy filter and have
 * no residents, crashing on a synchronous throw that no `.catch` can see).
 */
function occupiedUnitWithHost(pop, rand) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const unit = occupiedUnit(pop, rand);
    if (!unit) return null;
    const host = primaryResidentOf(pop, unit);
    if (host) return { unit, host };
  }
  return null;
}

export function newPass(pop, rand, now) {
  const found = occupiedUnitWithHost(pop, rand);
  if (!found) return null;
  const { unit, host } = found;
  const otp = String(Math.floor(rand() * 900000) + 100000);
  return {
    id: randomUUID(),
    community_id: DEMO_COMMUNITY_ID,
    unit_id: unit.id,
    created_by: host.id,
    visitor_name: pick(VISITOR_NAMES, rand),
    visitor_mobile: `9${Math.floor(rand() * 900000000) + 100000000}`,
    otp,
    valid_from: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
    valid_until: new Date(now.getTime() + 4 * 3600 * 1000).toISOString(),
    max_uses: 1,
    uses_count: 0,
    status: 'active',
    visitor_vehicle: null,
  };
}

export async function insertTrickle(client, row, table) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    columns.map((c) => row[c])
  );
}
