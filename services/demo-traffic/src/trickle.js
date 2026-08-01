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
    status: 'pending',
    logged_by: guard.id,
    logged_by_name: guard.name,
    created_at: now.toISOString(),
  };
}

export function newPass(pop, rand, now) {
  const unit = occupiedUnit(pop, rand);
  const host = pop.residents.find((r) => r.unitId === unit.id && r.isPrimary);
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
