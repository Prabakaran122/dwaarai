/**
 * Breadth data for the Greenfield demo tenant.
 *
 * `buildEvent` gives the platform depth — tens of thousands of gate reads. This
 * module gives it breadth: every other page in the admin portal, the resident
 * app and the guard app needs at least a handful of believable rows or the demo
 * lands on an empty state and the story stops.
 *
 * Every object returned here is keyed by its **database column name**, so the
 * seeder can insert it without a translation layer. Nothing in this file talks
 * to a database; it is deterministic given (pop, rand, now) and therefore
 * testable without one.
 */
import { randomUUID, createHash } from 'node:crypto';
import { DEMO_COMMUNITY_ID, GATES } from './config.js';
import { randomPlate } from './plates.js';

const COURIERS = ['Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'Swiggy Instamart',
                  'Zomato', 'BigBasket', 'Delhivery', 'Blue Dart'];

const NOTICE_SEEDS = [
  ['maintenance', 'Water tanker schedule revised',
   'Tankers will now arrive at 7:00 AM and 5:30 PM daily until the HUDA supply line is restored.'],
  ['event', 'Annual General Meeting — 9 August',
   'The AGM will be held in the clubhouse at 11:00 AM. Agenda: maintenance revision, security audit, parking policy.'],
  ['security', 'Visitor entry now requires OTP verification',
   'All visitors must be approved through the resident app. Guards will not admit anyone on a phone call alone.'],
  ['event', 'Diwali celebration — cultural evening',
   'Cultural programme in the central lawn from 6 PM. Residents are requested to park in the basement.'],
  ['maintenance', 'Lift servicing in Tower C',
   'Tower C lift will be unavailable on Sunday between 10 AM and 2 PM for its annual service.'],
];

const INCIDENT_SEEDS = [
  ['tailgating', 'Two-wheeler followed a car through the boom without a tag read.'],
  ['wrong_parking', 'Visitor car parked in a resident bay in the Tower B basement.'],
  ['damage', 'Boom barrier arm clipped by a delivery tempo at the service gate.'],
  ['dispute', 'Argument between a resident and a cab driver over entry charges.'],
];

const STAFF_ROLES = [
  ['Sunita Devi', 'maid', '08:00', '18:00'],
  ['Ramesh Kumar', 'driver', '07:00', '21:00'],
  ['Kamla Bai', 'cook', '09:00', '15:00'],
  ['Shyam Lal', 'gardener', '06:00', '12:00'],
];

const FACILITY_SEEDS = [
  ['Clubhouse', 'community', '06:00', '22:00', 60],
  ['Gymnasium', 'fitness', '05:00', '23:00', 45],
  ['Swimming Pool', 'swimming', '06:00', '20:00', 60],
  ['Banquet Hall', 'events', '09:00', '23:00', 120],
  ['Tennis Court', 'tennis', '06:00', '21:00', 60],
];

const VISITOR_FIRST = ['Arun', 'Bhavna', 'Chirag', 'Divya', 'Farhan', 'Geeta',
                       'Hemant', 'Ishita', 'Jatin', 'Komal', 'Lalit', 'Madhu',
                       'Nitin', 'Ojas', 'Payal', 'Rahul', 'Sneha', 'Tarun'];
const VISITOR_LAST = ['Arora', 'Batra', 'Chhabra', 'Dutta', 'Grover', 'Jain',
                      'Khanna', 'Mehra', 'Narang', 'Pandey', 'Sethi', 'Tandon'];

const DELIVERY_NOTES = [
  'Left at the guard desk — resident informed on the app.',
  'Two parcels, one fragile.',
  'Cold bag — collect within the hour.',
  'Courier waited 5 minutes, resident not reachable.',
  'Handed to the guard on duty.',
];

const PET_DOGS = ['Bruno', 'Simba', 'Rocky', 'Coco', 'Leo', 'Zara', 'Tiger', 'Buddy'];
const PET_CATS = ['Mishti', 'Snowy', 'Bella', 'Kaju', 'Pixie', 'Momo'];
const DOG_BREEDS = ['Labrador', 'Indie', 'Beagle', 'German Shepherd', 'Pug', 'Golden Retriever'];
const CAT_BREEDS = ['Persian', 'Indian Billi', 'Siamese', 'Bombay'];

const POLL_SEEDS = [
  ['Should the RWA install EV charging points in the basement?', 'open'],
  ['Do you approve the revised maintenance charge of Rs 3,200 per month?', 'closed'],
  ['Should visitor parking be capped at two hours on weekends?', 'closed'],
];

const SOS_SEEDS = [
  ['medical', 'Elderly resident felt breathless; ambulance called and guard escorted it in.'],
  ['fire', 'Smoke from a basement generator exhaust; maintenance shut it down.'],
  ['security', 'Unknown person loitering near the service gate; escorted out.'],
  ['medical', 'Child fell in the play area; first aid given at the guard room.'],
];

const HANDOVER_NOTES = [
  'All three gates normal. Boom barrier at the service gate needs greasing.',
  'Two visitor passes pending collection at the desk. CCTV recording verified.',
  'Torch batteries replaced. Night round completed at 02:00 and 04:00.',
];

/*
 * Status vocabularies, hoisted so they are one edit away.
 *
 * These are the values the task brief specifies. Two of them do NOT match what
 * the running platform reads back, so the corresponding pages will look empty
 * until these are flipped:
 *   - services/api-gateway/src/routes/deliveries.js filters `status = 'waiting'`
 *     for the guard's active-delivery list and the resident home badge, and only
 *     accepts 'delivered' | 'left_at_gate' as terminal states.
 *   - services/api-gateway/src/routes/facilities.js filters `status = 'booked'`
 *     for slot availability; the uniq_facility_slot index is partial on it too.
 * Likewise notices.category is 'official' | 'discussion' in migration 014 and in
 * the zod enum in routes/notices.js — the topical categories below are seeded as
 * given but are off-contract.
 */
const DELIVERY_PENDING = 'pending';    // platform reads 'waiting'
const DELIVERY_DONE = 'collected';     // platform writes 'delivered'
const BOOKING_STATUS = 'confirmed';    // platform reads 'booked'

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function dateOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function otp(rand) {
  return String(100000 + Math.floor(rand() * 900000));
}

function mobile(rand) {
  const first = 6 + Math.floor(rand() * 4);
  let rest = '';
  for (let i = 0; i < 9; i++) rest += Math.floor(rand() * 10);
  return `${first}${rest}`;
}

/** 'HH:MM' plus `minutes`, wrapped inside the day. */
function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Build every non-gate-event row the demo tenant needs.
 *
 * @param {Object} pop      output of buildPopulation()
 * @param {Function} rand   seeded PRNG (mulberry32)
 * @param {Date} now        the instant the demo is anchored to
 * @returns {Object} twelve arrays keyed by DB column name
 */
export function buildBreadth(pop, rand, now) {
  const t = now.getTime();

  // "Occupied" here means inhabited — owner-occupied or rented. Vacant flats get
  // no residents from buildPopulation, so they get no dues, pets or passes either.
  const livedIn = pop.units.filter((u) => u.status !== 'vacant');
  const unitResidents = new Map();
  for (const r of pop.residents) {
    if (!unitResidents.has(r.unitId)) unitResidents.set(r.unitId, []);
    unitResidents.get(r.unitId).push(r);
  }
  const primaryOf = (unit) => {
    const list = unitResidents.get(unit.id) || [];
    return list.find((r) => r.isPrimary) || list[0];
  };

  const serviceGate = GATES.find((g) => g.type === 'service') || GATES[0];
  const mainGate = GATES.find((g) => g.type === 'entry') || GATES[0];

  // ---- visitor passes: 40, half still valid, half already lapsed -------------
  const passes = [];
  for (let i = 0; i < 40; i++) {
    const unit = pick(livedIn, rand);
    const host = primaryOf(unit);
    const active = i % 2 === 0;
    // Active passes straddle `now`; expired ones closed before it.
    const validFrom = active
      ? t - (1 + Math.floor(rand() * 6)) * HOUR_MS
      : t - (1 + Math.floor(rand() * 9)) * DAY_MS;
    const validUntil = active
      ? t + (2 + Math.floor(rand() * 20)) * HOUR_MS
      : validFrom + (4 + Math.floor(rand() * 8)) * HOUR_MS;
    const maxUses = rand() < 0.75 ? 1 : 2 + Math.floor(rand() * 3);
    passes.push({
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      unit_id: unit.id,
      created_by: host.id,
      visitor_name: `${pick(VISITOR_FIRST, rand)} ${pick(VISITOR_LAST, rand)}`,
      visitor_mobile: mobile(rand),
      otp: otp(rand),
      valid_from: iso(validFrom),
      valid_until: iso(validUntil),
      max_uses: maxUses,
      uses_count: active ? (rand() < 0.4 ? 1 : 0) : Math.min(maxUses, 1),
      status: active ? 'active' : 'expired',
      visitor_vehicle: rand() < 0.7 ? randomPlate(rand).display : null,
    });
  }

  // ---- deliveries: 60 over the last three days ------------------------------
  const deliveries = [];
  for (let i = 0; i < 60; i++) {
    const unit = pick(livedIn, rand);
    const guard = pick(pop.guards, rand);
    const collected = rand() < 0.7;
    // Couriers arrive across the working day, not uniformly around the clock.
    const daysAgo = Math.floor(rand() * 3);
    const at = t - daysAgo * DAY_MS - (Math.floor(rand() * 11) + 1) * HOUR_MS;
    deliveries.push({
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      gate_id: rand() < 0.75 ? serviceGate.id : mainGate.id,
      unit_id: unit.id,
      company: pick(COURIERS, rand),
      note: rand() < 0.5 ? pick(DELIVERY_NOTES, rand) : null,
      status: collected ? DELIVERY_DONE : DELIVERY_PENDING,
      logged_by: guard.id,
      logged_by_name: guard.name,
      created_at: iso(at),
    });
  }

  // ---- incidents: every seed at least once, padded to 12 --------------------
  const incidents = [];
  for (let i = 0; i < 12; i++) {
    const [type, description] = INCIDENT_SEEDS[i % INCIDENT_SEEDS.length];
    const guard = pick(pop.guards, rand);
    incidents.push({
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      gate_id: pick(GATES, rand).id,
      reported_by: guard.id,
      reported_by_name: guard.name,
      type,
      description,
      status: i % 3 === 0 ? 'open' : 'reviewed',
      created_at: iso(t - (i + 1) * 9 * HOUR_MS),
    });
  }

  // ---- notices --------------------------------------------------------------
  const committee = pop.residents.filter((r) => r.isCommittee);
  const notices = NOTICE_SEEDS.map(([category, title, body], i) => {
    const author = committee.length ? committee[i % committee.length] : pop.residents[i];
    const authorUnit = pop.units.find((u) => u.id === author.unitId);
    const created = t - (i + 1) * 2 * DAY_MS;
    return {
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      category,
      title,
      body,
      author_name: author.name,
      author_unit: authorUnit ? authorUnit.unitNumber : null,
      posted_by_role: 'admin',
      is_pinned: i === 0,
      is_removed: false,
      created_at: iso(created),
      last_activity_at: iso(created + Math.floor(rand() * 12) * HOUR_MS),
    };
  });

  // ---- dues: July 2026 maintenance bill per inhabited flat -------------------
  const dues = livedIn.map((unit) => {
    const pending = rand() < 0.15;
    const base = 2800 + Math.floor(rand() * 1401); // 2800–4200
    return {
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      unit_id: unit.id,
      period: '2026-07',
      description: 'Monthly maintenance — July 2026',
      base_amount: base,
      penalty_amount: pending ? 250 : 0,
      due_date: '2026-07-10',
      status: pending ? 'pending' : 'paid',
      created_at: iso(t - 25 * DAY_MS),
    };
  });

  // ---- facilities and their bookings ----------------------------------------
  const facilities = FACILITY_SEEDS.map(([name, sport, openTime, closeTime, slot]) => ({
    id: randomUUID(),
    community_id: DEMO_COMMUNITY_ID,
    name,
    sport,
    open_time: openTime,
    close_time: closeTime,
    slot_minutes: slot,
    is_active: true,
  }));

  const bookings = [];
  // uniq_facility_slot is a UNIQUE index on (facility_id, booking_date, start_time),
  // so two residents may not hold the same slot — draw again on a collision.
  const takenSlots = new Set();
  for (let attempt = 0; bookings.length < 30 && attempt < 600; attempt++) {
    const facility = pick(facilities, rand);
    const unit = pick(livedIn, rand);
    const resident = primaryOf(unit);
    // Slots start on the hour from the facility's opening time onward.
    const openHour = Number(facility.open_time.split(':')[0]);
    const startHour = openHour + Math.floor(rand() * Math.max(1, 20 - openHour));
    const startTime = `${String(startHour).padStart(2, '0')}:00`;
    const bookingDate = dateOnly(t + (1 + Math.floor(rand() * 7)) * DAY_MS);
    const slotKey = `${facility.id}|${bookingDate}|${startTime}`;
    if (takenSlots.has(slotKey)) continue;
    takenSlots.add(slotKey);
    bookings.push({
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      facility_id: facility.id,
      unit_id: unit.id,
      resident_id: resident.id,
      booking_date: bookingDate,
      start_time: startTime,
      end_time: addMinutes(startTime, facility.slot_minutes),
      status: BOOKING_STATUS,
    });
  }

  // ---- polls: one live, two decided ----------------------------------------
  const polls = POLL_SEEDS.map(([question, status], i) => {
    const author = committee.length ? committee[i % committee.length] : pop.residents[i];
    return {
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      created_by: author.id,
      author_name: author.name,
      question,
      status,
      closes_at: iso(status === 'open' ? t + 5 * DAY_MS : t - (i + 1) * 6 * DAY_MS),
      created_at: iso(t - (i + 1) * 14 * DAY_MS),
    };
  });

  // ---- SOS: all resolved. A live red alert on a demo board reads as a fault. --
  const sosAlerts = SOS_SEEDS.map(([type, note], i) => {
    const unit = pick(livedIn, rand);
    const resident = primaryOf(unit);
    const raised = t - (i + 1) * 3 * DAY_MS;
    return {
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      gate_id: pick(GATES, rand).id,
      raised_by: resident.id,
      raised_by_name: resident.name,
      type,
      note,
      status: 'resolved',
      created_at: iso(raised),
      resolved_at: iso(raised + (8 + Math.floor(rand() * 40)) * 60 * 1000),
    };
  });

  // ---- pets -----------------------------------------------------------------
  const pets = [];
  for (let i = 0; i < 25; i++) {
    const unit = pick(livedIn, rand);
    const isDog = rand() < 0.65;
    pets.push({
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      unit_id: unit.id,
      name: isDog ? pick(PET_DOGS, rand) : pick(PET_CATS, rand),
      species: isDog ? 'dog' : 'cat',
      breed: isDog ? pick(DOG_BREEDS, rand) : pick(CAT_BREEDS, rand),
      notes: rand() < 0.4 ? 'Registered with the RWA; vaccination record on file.' : null,
      is_active: true,
    });
  }

  // ---- RFID cards: one per tagged vehicle, plus the household staff ----------
  const rfidCards = [];
  for (const vehicle of pop.vehicles) {
    if (!vehicle.rfidCardNo) continue;   // untagged vehicles have no card
    const owner = pop.residents.find((r) => r.id === vehicle.residentId);
    rfidCards.push({
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      uid_hash: vehicle.rfidUidHash,
      card_number: vehicle.rfidCardNo,
      issued_to_unit: vehicle.unitId,
      card_type: 'resident',
      is_active: true,
      issued_at: iso(t - (30 + Math.floor(rand() * 300)) * DAY_MS),
      holder_name: owner ? owner.name : null,
      // Resident cards work around the clock — no daily window.
      access_start: null,
      access_end: null,
    });
  }
  STAFF_ROLES.forEach(([holder, role, start, end], i) => {
    const unit = pick(livedIn, rand);
    const cardNo = String(43900000 + i);
    rfidCards.push({
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      uid_hash: sha256(cardNo),
      card_number: cardNo,
      issued_to_unit: unit.id,
      card_type: 'staff',
      is_active: true,
      issued_at: iso(t - (60 + i * 11) * DAY_MS),
      holder_name: `${holder} (${role})`,
      // Staff cards only open the gate during their working hours.
      access_start: start,
      access_end: end,
    });
  });

  // ---- shift handovers: three shifts a day for three days -------------------
  const handovers = [];
  const SHIFT_HOURS = [6, 14, 22];
  for (let day = 2; day >= 0; day--) {
    SHIFT_HOURS.forEach((hour, shift) => {
      const guard = pop.guards[(day * 3 + shift) % pop.guards.length];
      const at = new Date(t - day * DAY_MS);
      at.setUTCHours(hour, 0, 0, 0);
      handovers.push({
        id: randomUUID(),
        community_id: DEMO_COMMUNITY_ID,
        gate_id: mainGate.id,
        guard_id: guard.id,
        guard_name: guard.name,
        note: HANDOVER_NOTES[shift % HANDOVER_NOTES.length],
        created_at: at.toISOString(),
      });
    });
  }

  return {
    passes, deliveries, incidents, notices, dues, facilities,
    bookings, polls, sosAlerts, pets, rfidCards, handovers,
  };
}
