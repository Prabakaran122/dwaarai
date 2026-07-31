import { DEMO_COMMUNITY_ID } from './config.js';

/**
 * One gate event, shaped like something a real edge node would send.
 *
 * Most traffic is a resident the system already knows; the tail is what makes a
 * demo credible — the odd unreadable plate, an expired visitor pass, a guard
 * waving someone through.
 */

const DENY_REASONS = [
  'Vehicle not on whitelist',
  'Visitor pass expired',
  'Plate on blacklist',
  'Plate unreadable — manual check required',
  'Outside permitted access hours',
];

// Per-gate method weights: the service gate sees couriers and hand-entry, the
// main gate is mostly tags and camera reads.
const METHODS_BY_GATE = {
  entry:   [['rfid', 55], ['anpr', 30], ['qr', 8], ['manual', 5], ['face', 2]],
  exit:    [['rfid', 50], ['anpr', 40], ['manual', 8], ['qr', 2]],
  service: [['manual', 45], ['qr', 30], ['anpr', 20], ['rfid', 5]],
};

function weightedPick(pairs, rand) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, weight] of pairs) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

export function buildEvent({ pop, gate, at, rand }) {
  const method = weightedPick(METHODS_BY_GATE[gate.type] || METHODS_BY_GATE.entry, rand);

  // 88% of traffic is a resident vehicle the platform already knows.
  const known = rand() < 0.88;
  const vehicle = known ? pick(pop.vehicles, rand) : null;
  const unit = vehicle ? pop.units.find((u) => u.id === vehicle.unitId) : null;
  const resident = vehicle ? pop.residents.find((r) => r.id === vehicle.residentId) : null;

  const decisionRoll = rand();
  let decision;
  if (!known) {
    // Strangers are the source of most denies and reviews.
    decision = decisionRoll < 0.45 ? 'deny' : decisionRoll < 0.9 ? 'guard_review' : 'override';
  } else {
    decision = decisionRoll < 0.985 ? 'allow' : decisionRoll < 0.995 ? 'guard_review' : 'deny';
  }

  const direction = gate.type === 'exit'
    ? 'exit'
    : gate.type === 'entry'
      ? 'entry'
      : rand() < 0.5 ? 'entry' : 'exit';

  return {
    community_id: DEMO_COMMUNITY_ID,
    gate_id: gate.id,
    detection_method: method,
    raw_value: vehicle ? vehicle.plate : `UNKNOWN${Math.floor(rand() * 9000) + 1000}`,
    matched_vehicle_id: vehicle ? vehicle.id : null,
    matched_unit_id: unit ? unit.id : null,
    matched_unit_number: unit ? unit.unitNumber : null,
    resident_name: resident ? resident.name : null,
    access_decision: decision,
    direction,
    deny_reason: decision === 'deny' ? pick(DENY_REASONS, rand) : null,
    // Only the camera produces a confidence score.
    anpr_confidence: method === 'anpr'
      ? Math.round((0.72 + rand() * 0.27) * 100) / 100
      : null,
    processing_ms: 80 + Math.floor(rand() * 520),
    is_offline_event: false,
    event_ts: at.toISOString(),
  };
}
