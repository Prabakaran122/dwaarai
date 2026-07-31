import { randomUUID, createHash } from 'node:crypto';
import { mulberry32 } from './rhythm.js';
import { randomPlate, randomVehicle } from './plates.js';

const FIRST_NAMES = [
  'Rajesh', 'Sunita', 'Amit', 'Priya', 'Vikram', 'Neha', 'Sanjay', 'Kavita',
  'Deepak', 'Anjali', 'Manoj', 'Pooja', 'Rohit', 'Meenakshi', 'Ashok', 'Ritu',
  'Naveen', 'Shalini', 'Gaurav', 'Preeti', 'Yogesh', 'Rekha', 'Ankit', 'Suman',
  'Harish', 'Jyoti', 'Mukesh', 'Nisha', 'Pankaj', 'Seema',
];

const SURNAMES = [
  'Sharma', 'Yadav', 'Chauhan', 'Gupta', 'Bhardwaj', 'Singh', 'Verma', 'Aggarwal',
  'Malik', 'Rathi', 'Tyagi', 'Khatri', 'Saini', 'Dahiya', 'Nagar', 'Chopra',
  'Kaushik', 'Bansal', 'Ahuja', 'Sehgal',
];

const TOWERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const FLOORS = 12;
const UNITS_PER_FLOOR = 6;   // 6 towers x 12 floors x 6 = 432 units
const GUARD_NAMES = [
  'Ram Kishan', 'Dharmveer Singh', 'Satish Kumar', 'Bijender Pal',
  'Om Prakash', 'Jaipal Yadav', 'Mahesh Chand', 'Kuldeep Rana',
];

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

function personName(rand) {
  return `${pick(FIRST_NAMES, rand)} ${pick(SURNAMES, rand)}`;
}

function mobile(rand) {
  // Indian mobile numbers start 6-9; the DB column is VARCHAR(15).
  const first = 6 + Math.floor(rand() * 4);
  let rest = '';
  for (let i = 0; i < 9; i++) rest += Math.floor(rand() * 10);
  return `${first}${rest}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Generate a complete society population for the Greenfield demo.
 *
 * All seeded content (plates, names, vehicle types, occupancy status, etc.) is reproducible:
 * the same seed always produces the same data structure.
 *
 * IMPORTANT: Entity IDs (blocks, units, residents, vehicles, guards) are freshly minted
 * with randomUUID() on every call and are NOT stable across processes or runs. Do not rely
 * on id values for cross-process referencing. Any consumer needing to reference persisted
 * rows must read the ids back from the database after insert, not rebuild the population.
 *
 * @param {number} seed - Seed for the PRNG controlling all randomness in content generation
 * @returns {Object} Population object with arrays: blocks, units, residents, vehicles, guards
 */
export function buildPopulation(seed) {
  const rand = mulberry32(seed);

  const blocks = TOWERS.map((letter) => ({ id: randomUUID(), name: `Tower ${letter}`, letter }));

  const units = [];
  for (const block of blocks) {
    for (let floor = 1; floor <= FLOORS; floor++) {
      for (let n = 1; n <= UNITS_PER_FLOOR; n++) {
        const roll = rand();
        const status = roll < 0.90 ? 'occupied' : roll < 0.97 ? 'rented' : 'vacant';
        units.push({
          id: randomUUID(),
          blockId: block.id,
          unitNumber: `${block.letter}-${floor}${String(n).padStart(2, '0')}`,
          floor,
          ownerName: personName(rand),
          status,
          wing: block.letter,
          ownershipType: status === 'rented' ? 'tenant' : 'owner',
        });
      }
    }
  }

  const residents = [];
  for (const unit of units) {
    if (unit.status === 'vacant') continue;
    const primary = {
      id: randomUUID(),
      unitId: unit.id,
      name: unit.ownerName,
      mobile: mobile(rand),
      type: unit.ownershipType,
      isPrimary: true,
      isCommittee: rand() < 0.02,
    };
    residents.push(primary);
    // Roughly half the homes register a second adult.
    if (rand() < 0.5) {
      residents.push({
        id: randomUUID(),
        unitId: unit.id,
        name: personName(rand),
        mobile: mobile(rand),
        type: 'family',
        isPrimary: false,
        isCommittee: false,
      });
    }
  }

  const vehicles = [];
  const seenPlates = new Set();
  for (const unit of units) {
    if (unit.status === 'vacant') continue;
    const owner = residents.find((r) => r.unitId === unit.id && r.isPrimary);
    const count = rand() < 0.35 ? 2 : 1;  // ~1.35 vehicles per home
    for (let i = 0; i < count; i++) {
      let plate = randomPlate(rand);
      while (seenPlates.has(plate.plate)) plate = randomPlate(rand);
      seenPlates.add(plate.plate);

      const spec = randomVehicle(rand);
      const tagged = rand() < 0.8;
      const cardNo = tagged ? String(43000000 + vehicles.length) : null;
      vehicles.push({
        id: randomUUID(),
        unitId: unit.id,
        residentId: owner.id,
        plate: plate.plate,
        plateDisplay: plate.display,
        make: spec.make,
        model: spec.model,
        color: spec.color,
        type: spec.type,
        rfidUidHash: cardNo ? sha256(cardNo) : null,
        rfidCardNo: cardNo,
      });
    }
  }

  const guards = GUARD_NAMES.map((name) => ({
    id: randomUUID(),
    unitId: null,
    name,
    mobile: mobile(rand),
    type: 'guard',
    isPrimary: false,
    isCommittee: false,
  }));

  return { blocks, units, residents, vehicles, guards };
}
