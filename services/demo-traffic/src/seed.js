/**
 * Seed the Greenfield demo tenant.
 *
 * This is destructive but *only* inside one community: every DELETE is scoped to
 * DEMO_COMMUNITY_ID, and the id is a compile-time constant re-checked by
 * assertDemoCommunity() before a single statement runs. The whole thing is one
 * transaction, so a re-run either replaces the tenant completely or leaves it
 * exactly as it was.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DEMO_COMMUNITY_ID, GATES, assertDemoCommunity, config } from './config.js';
import { buildPopulation } from './population.js';
import { buildBreadth } from './breadth.js';
import { buildHistory } from './history.js';
import { mulberry32 } from './rhythm.js';

const SEED = 2043;

// Child tables first — FK order. Every statement is scoped to the demo tenant.
const TABLES_IN_DELETE_ORDER = [
  'facility_bookings', 'facilities', 'polls',
  'notice_replies', 'notices', 'due_payments', 'dues', 'pets', 'sos_alerts',
  'incidents', 'deliveries', 'shift_handovers', 'rfid_cards', 'visitor_passes',
  'gate_events', 'vehicles', 'residents', 'units', 'blocks', 'gates',
];

// poll_options and poll_votes carry no community_id of their own (migration 027)
// — they hang off polls. They still have to go first or the FK on polls blocks
// the delete, so they are scoped through their parent instead of directly.
const POLL_CHILD_DELETES = [
  'DELETE FROM poll_votes   WHERE poll_id IN (SELECT id FROM polls WHERE community_id = $1)',
  'DELETE FROM poll_options WHERE poll_id IN (SELECT id FROM polls WHERE community_id = $1)',
];

/**
 * Multi-row INSERT with explicit columns and numbered placeholders.
 *
 * Chunked because Postgres caps a statement at 65535 bind parameters, and a
 * 575-row vehicle insert with 12 columns is already 6,900 of them.
 */
async function insertRows(client, table, columns, rows) {
  if (rows.length === 0) return 0;
  const perChunk = Math.max(1, Math.floor(5000 / columns.length));
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += perChunk) {
    const chunk = rows.slice(offset, offset + perChunk);
    const values = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(row[column] === undefined ? null : row[column]);
        return `$${values.length}`;
      });
      return `(${placeholders.join(',')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')}`,
      values
    );
    written += chunk.length;
  }
  return written;
}

export async function seedAll(client) {
  assertDemoCommunity(DEMO_COMMUNITY_ID);
  await client.query('BEGIN');
  try {
    for (const sql of POLL_CHILD_DELETES) {
      await client.query(sql, [DEMO_COMMUNITY_ID]);
    }
    for (const table of TABLES_IN_DELETE_ORDER) {
      await client.query(`DELETE FROM ${table} WHERE community_id = $1`, [DEMO_COMMUNITY_ID]);
    }
    await client.query('DELETE FROM communities WHERE id = $1', [DEMO_COMMUNITY_ID]);

    await client.query(
      `INSERT INTO communities (id, name, city, total_units, address, contact_name, contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [DEMO_COMMUNITY_ID, 'Greenfield Faridabad Sector 43', 'Faridabad', 432,
       'Sector 43, Greenfield Colony, Faridabad, Haryana 121010',
       'RWA Office', '9812345600']
    );

    for (const gate of GATES) {
      await client.query(
        `INSERT INTO gates (id, community_id, name, type) VALUES ($1,$2,$3,$4)`,
        [gate.id, DEMO_COMMUNITY_ID, gate.name, gate.type]
      );
    }

    const pop = buildPopulation(SEED);

    await insertRows(client, 'blocks', ['id', 'community_id', 'name'],
      pop.blocks.map((block) => ({
        id: block.id,
        community_id: DEMO_COMMUNITY_ID,
        name: block.name,
      })));

    await insertRows(client, 'units',
      ['id', 'community_id', 'block_id', 'unit_number', 'floor', 'owner_name',
       'status', 'wing', 'ownership_type'],
      pop.units.map((unit) => ({
        id: unit.id,
        community_id: DEMO_COMMUNITY_ID,
        block_id: unit.blockId,
        unit_number: unit.unitNumber,
        floor: unit.floor,
        owner_name: unit.ownerName,
        status: unit.status,
        wing: unit.wing,
        ownership_type: unit.ownershipType,
      })));

    // residents.unit_id is NOT NULL, but a guard belongs to the society rather
    // than to any flat, so buildPopulation gives them unitId: null. Rather than
    // distort the population model, we attach every guard to the first unit at
    // insert time — the same convention the live platform already uses, where
    // the guard1/guard2 accounts hang off a real unit instead of standing alone.
    const guardUnitId = pop.units[0].id;
    const residentRows = [...pop.residents, ...pop.guards].map((person) => ({
      id: person.id,
      community_id: DEMO_COMMUNITY_ID,
      unit_id: person.unitId ?? guardUnitId,
      name: person.name,
      mobile: person.mobile,
      type: person.type,
      is_primary: person.isPrimary,
      is_committee: person.isCommittee,
    }));
    await insertRows(client, 'residents',
      ['id', 'community_id', 'unit_id', 'name', 'mobile', 'type', 'is_primary', 'is_committee'],
      residentRows);

    await insertRows(client, 'vehicles',
      ['id', 'community_id', 'unit_id', 'resident_id', 'plate', 'plate_display',
       'make', 'model', 'color', 'type', 'rfid_uid_hash', 'rfid_card_no'],
      pop.vehicles.map((vehicle) => ({
        id: vehicle.id,
        community_id: DEMO_COMMUNITY_ID,
        unit_id: vehicle.unitId,
        resident_id: vehicle.residentId,
        plate: vehicle.plate,
        plate_display: vehicle.plateDisplay,
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color,
        type: vehicle.type,
        rfid_uid_hash: vehicle.rfidUidHash,
        rfid_card_no: vehicle.rfidCardNo,
      })));

    const breadth = buildBreadth(pop, mulberry32(SEED + 1), new Date());

    await insertRows(client, 'visitor_passes',
      ['id', 'community_id', 'unit_id', 'created_by', 'visitor_name', 'visitor_mobile',
       'otp', 'valid_from', 'valid_until', 'max_uses', 'uses_count', 'status',
       'visitor_vehicle'],
      breadth.passes);

    await insertRows(client, 'deliveries',
      ['id', 'community_id', 'gate_id', 'unit_id', 'company', 'note', 'status',
       'logged_by', 'logged_by_name', 'created_at'],
      breadth.deliveries);

    await insertRows(client, 'incidents',
      ['id', 'community_id', 'gate_id', 'reported_by', 'reported_by_name', 'type',
       'description', 'status', 'created_at'],
      breadth.incidents);

    await insertRows(client, 'notices',
      ['id', 'community_id', 'category', 'title', 'body', 'author_name', 'author_unit',
       'posted_by_role', 'is_pinned', 'is_removed', 'created_at', 'last_activity_at'],
      breadth.notices);

    await insertRows(client, 'dues',
      ['id', 'community_id', 'unit_id', 'period', 'description', 'base_amount',
       'penalty_amount', 'due_date', 'status', 'created_at'],
      breadth.dues);

    await insertRows(client, 'facilities',
      ['id', 'community_id', 'name', 'sport', 'open_time', 'close_time',
       'slot_minutes', 'is_active'],
      breadth.facilities);

    await insertRows(client, 'facility_bookings',
      ['id', 'community_id', 'facility_id', 'unit_id', 'resident_id', 'booking_date',
       'start_time', 'end_time', 'status'],
      breadth.bookings);

    await insertRows(client, 'polls',
      ['id', 'community_id', 'created_by', 'author_name', 'question', 'status',
       'closes_at', 'created_at'],
      breadth.polls);

    await insertRows(client, 'sos_alerts',
      ['id', 'community_id', 'gate_id', 'raised_by', 'raised_by_name', 'type', 'note',
       'status', 'created_at', 'resolved_at'],
      breadth.sosAlerts);

    await insertRows(client, 'pets',
      ['id', 'community_id', 'unit_id', 'name', 'species', 'breed', 'notes', 'is_active'],
      breadth.pets);

    await insertRows(client, 'rfid_cards',
      ['id', 'community_id', 'uid_hash', 'card_number', 'issued_to_unit', 'card_type',
       'is_active', 'issued_at', 'holder_name', 'access_start', 'access_end'],
      breadth.rfidCards);

    await insertRows(client, 'shift_handovers',
      ['id', 'community_id', 'gate_id', 'guard_id', 'guard_name', 'note', 'created_at'],
      breadth.handovers);

    const history = buildHistory({ pop, days: 10, until: new Date(), rand: mulberry32(SEED + 2) });
    for (let i = 0; i < history.length; i += 500) {
      const batch = history.slice(i, i + 500);
      const values = [];
      const params = [];
      batch.forEach((e, n) => {
        const b = n * 15;
        values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15})`);
        params.push(
          randomUUID(), e.community_id, e.gate_id, e.detection_method, e.raw_value,
          e.matched_vehicle_id, e.matched_unit_id, e.matched_unit_number,
          e.resident_name, e.access_decision, e.direction, e.deny_reason, e.anpr_confidence,
          e.processing_ms, e.event_ts
        );
      });
      await client.query(
        `INSERT INTO gate_events
           (id, community_id, gate_id, detection_method, raw_value,
            matched_vehicle_id, matched_unit_id, matched_unit_number,
            resident_name, access_decision, direction, deny_reason, anpr_confidence,
            processing_ms, event_ts)
         VALUES ${values.join(',')}`,
        params
      );
    }

    await client.query('COMMIT');
    return pop;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { databaseUrl } = config(process.env);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const pop = await seedAll(client);
  console.log(`seeded ${pop.units.length} units, ${pop.vehicles.length} vehicles`);
  await client.end();
}
