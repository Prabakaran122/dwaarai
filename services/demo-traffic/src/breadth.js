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
import { IST_OFFSET_MS } from './rhythm.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

const COURIERS = ['Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'Swiggy Instamart',
                  'Zomato', 'BigBasket', 'Delhivery', 'Blue Dart'];

/*
 * [category, title, body].
 *
 * `category` is exactly 'official' | 'discussion' — migration 014 and the zod
 * enum at services/api-gateway/src/routes/notices.js:13 admit nothing else. The
 * topical framing (maintenance / event / security) therefore lives in the title
 * and body rather than in a column of its own.
 *
 * The board sorts pinned official notices first, so the pinned seed is official.
 */
const NOTICE_SEEDS = [
  ['official', 'Maintenance: water tanker schedule revised',
   'Tankers will now arrive at 7:00 AM and 5:30 PM daily until the HUDA supply line is restored.'],
  ['official', 'Annual General Meeting — 9 August',
   'The AGM will be held in the clubhouse at 11:00 AM. Agenda: maintenance revision, security audit, parking policy.'],
  ['official', 'Security: visitor entry now requires OTP verification',
   'All visitors must be approved through the resident app. Guards will not admit anyone on a phone call alone.'],
  ['discussion', 'Diwali cultural evening — who is volunteering?',
   'Cultural programme in the central lawn from 6 PM, and residents are requested to park in the basement. '
   + 'Anyone willing to help with the decoration and the children’s events, please reply on this thread.'],
  ['discussion', 'Lift servicing in Tower C — can we move it off Sunday?',
   'The Tower C lift will be unavailable on Sunday between 10 AM and 2 PM for its annual service. '
   + 'Sunday is when most of us have guests over — could the RWA ask the vendor for a weekday slot instead?'],
];

/*
 * [type, description].
 *
 * `type` is one of the six values apps/admin-portal/app/incidents/page.tsx maps
 * to a human label. Anything else inserts cleanly — there is no CHECK
 * constraint — and then renders as raw snake_case on the incidents page, which
 * is exactly the class of silent breakage this module exists to prevent. The
 * situation-specific colour therefore lives in the description, not in a type of
 * its own: a wrong-parking row is 'other', a boom-barrier knock is
 * 'vehicle_damage'. INCIDENT_TYPES pins the list for the test.
 */
export const INCIDENT_TYPES = ['unauthorized_entry', 'tailgating', 'suspicious_person',
                               'vehicle_damage', 'equipment_malfunction', 'other'];

const INCIDENT_SEEDS = [
  ['tailgating', 'Two-wheeler followed a car through the boom without a tag read.'],
  ['other', 'Visitor car parked in a resident bay in the Tower B basement.'],
  ['vehicle_damage', 'Boom barrier arm clipped by a delivery tempo at the service gate.'],
  ['other', 'Argument between a resident and a cab driver over entry charges.'],
  ['unauthorized_entry', 'Cab drove in behind a resident car without an approved visitor pass.'],
  ['suspicious_person', 'Unidentified man photographing parked cars in the Tower A basement.'],
  ['equipment_malfunction', 'ANPR camera at the exit gate stopped returning reads for 20 minutes.'],
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

/*
 * [question, status, options, weights].
 *
 * A poll with no options renders as an unvotable empty card with "0 votes", so
 * every seed carries its own ballot. `weights` is the relative pull of each
 * option — a real vote is lopsided, and three evenly-split results in a row read
 * as generated data.
 */
const POLL_SEEDS = [
  ['Should the RWA install EV charging points in the basement?', 'open',
   ['Yes, in visitor parking', 'Yes, one per tower', 'No, not yet'], [5, 6, 2]],
  ['Do you approve the revised maintenance charge of Rs 3,200 per month?', 'closed',
   ['Approve', 'Approve only with an audit', 'Reject'], [7, 4, 3]],
  ['Should visitor parking be capped at two hours on weekends?', 'closed',
   ['Yes, two hours', 'Yes, but four hours', 'No cap', 'Undecided'], [6, 5, 3, 1]],
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
 * Status vocabularies, taken from the API rather than invented here. The routes
 * are the source of truth — seeding anything else inserts cleanly (there are no
 * CHECK constraints) but renders as an empty page, which is the one outcome this
 * whole module exists to prevent.
 *
 *   - deliveries: services/api-gateway/src/routes/deliveries.js filters
 *     `status = 'waiting'` for the guard's active-delivery list (:125) and
 *     validates the terminal states as 'delivered' | 'left_at_gate' (:170).
 *   - facility_bookings: services/api-gateway/src/routes/facilities.js filters
 *     `status = 'booked'` for slot availability (:64, :146, :241, :255), and the
 *     uniq_facility_slot index is partial on that same value.
 *
 * breadth.test.js pins all three so a future edit cannot quietly drift off them.
 */
const DELIVERY_WAITING = 'waiting';    // still at the desk — what the guard screen lists
const DELIVERY_DONE = 'delivered';     // handed over
const BOOKING_STATUS = 'booked';

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
  // Every fourth one is left 'waiting' — 15 parcels still at the desk, which is
  // what the guard's active-delivery list and the resident home badge read. The
  // other 45 are 'delivered'. Waiting parcels are all from today: a courier drop
  // still unclaimed after three days would look like a stuck demo, not a busy one.
  const deliveries = [];
  for (let i = 0; i < 60; i++) {
    const unit = pick(livedIn, rand);
    const guard = pick(pop.guards, rand);
    const waiting = i % 4 === 0;
    // Couriers arrive across the working day, not uniformly around the clock.
    const daysAgo = waiting ? 0 : Math.floor(rand() * 3);
    const at = t - daysAgo * DAY_MS - (Math.floor(rand() * 11) + 1) * HOUR_MS;
    deliveries.push({
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      gate_id: rand() < 0.75 ? serviceGate.id : mainGate.id,
      unit_id: unit.id,
      company: pick(COURIERS, rand),
      note: rand() < 0.5 ? pick(DELIVERY_NOTES, rand) : null,
      status: waiting ? DELIVERY_WAITING : DELIVERY_DONE,
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
    const official = category === 'official';
    const author = committee.length ? committee[i % committee.length] : pop.residents[i];
    const authorUnit = pop.units.find((u) => u.id === author.unitId);
    const created = t - (i + 1) * 2 * DAY_MS;
    return {
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      category,
      title,
      body,
      // routes/notices.js:114 posts 'official' as the RWA and 'discussion' as a
      // resident, and migration 014 notes author_unit is NULL on an RWA post.
      author_name: official ? 'RWA Office' : author.name,
      author_unit: official ? null : (authorUnit ? authorUnit.unitNumber : null),
      posted_by_role: official ? 'admin' : 'resident',
      is_pinned: i === 0,
      is_removed: false,
      created_at: iso(created),
      last_activity_at: iso(created + Math.floor(rand() * 12) * HOUR_MS),
    };
  });

  // ---- dues: the current month's maintenance bill per inhabited flat ---------
  // Derived from `now`, never hardcoded: the generator runs for months and a
  // pinned "July 2026" bill silently turns into a stale demo.
  const istNow = new Date(t + IST_OFFSET_MS);
  const period = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, '0')}`;
  const periodLabel = `${MONTH_NAMES[istNow.getUTCMonth()]} ${istNow.getUTCFullYear()}`;
  const dueDate = `${period}-10`;

  const dues = livedIn.map((unit) => {
    const pending = rand() < 0.15;
    const base = 2800 + Math.floor(rand() * 1401); // 2800–4200
    return {
      id: randomUUID(),
      community_id: DEMO_COMMUNITY_ID,
      unit_id: unit.id,
      period,
      description: `Monthly maintenance — ${periodLabel}`,
      base_amount: base,
      penalty_amount: pending ? 250 : 0,
      due_date: dueDate,
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
  // Columns per migration 027 (polls, poll_options, poll_votes) and 029, which
  // added poll_votes.unit_id and swapped the one-vote-per-resident primary key
  // for the uniq_poll_unit UNIQUE index on (poll_id, unit_id). Voting is
  // therefore per flat: each poll draws a distinct set of units and casts one
  // vote per unit through that unit's primary resident, which satisfies the
  // surviving unit constraint and the dropped resident one alike.
  const polls = [];
  const pollOptions = [];
  const pollVotes = [];

  POLL_SEEDS.forEach(([question, status, labels, weights], i) => {
    const author = committee.length ? committee[i % committee.length] : pop.residents[i];
    const pollId = randomUUID();
    const createdAt = t - (i + 1) * 14 * DAY_MS;

    polls.push({
      id: pollId,
      community_id: DEMO_COMMUNITY_ID,
      created_by: author.id,
      author_name: author.name,
      question,
      status,
      closes_at: iso(status === 'open' ? t + 5 * DAY_MS : t - (i + 1) * 6 * DAY_MS),
      created_at: iso(createdAt),
    });

    const options = labels.map((label, position) => ({
      id: randomUUID(),
      poll_id: pollId,
      label,
      position,
    }));
    pollOptions.push(...options);

    // Turnout: a closed poll has run its course, a live one is still filling up.
    const turnout = status === 'closed' ? 0.55 : 0.3;
    const voters = livedIn.filter(() => rand() < turnout);
    for (const unit of voters) {
      const voter = primaryOf(unit);
      if (!voter) continue;
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      let roll = rand() * totalWeight;
      let chosen = options[options.length - 1];
      for (let n = 0; n < options.length; n++) {
        roll -= weights[n];
        if (roll <= 0) { chosen = options[n]; break; }
      }
      pollVotes.push({
        poll_id: pollId,
        option_id: chosen.id,
        resident_id: voter.id,
        unit_id: unit.id,
        created_at: iso(createdAt + Math.floor(rand() * 5 * DAY_MS)),
      });
    }
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
      // Shift changes are wall-clock events in the society's own zone, so the
      // hour is set in IST and converted back.
      const istMidnight = new Date(t - day * DAY_MS + IST_OFFSET_MS);
      istMidnight.setUTCHours(hour, 0, 0, 0);
      const at = new Date(istMidnight.getTime() - IST_OFFSET_MS);
      // Today's later shifts have not happened yet — a handover note stamped in
      // the future is the sort of detail that unpicks a whole demo.
      if (at.getTime() > t) return;
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
    bookings, polls, pollOptions, pollVotes, sosAlerts, pets, rfidCards, handovers,
  };
}
