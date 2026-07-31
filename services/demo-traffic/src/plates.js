/**
 * Vehicle identity generation weighted to Faridabad's catchment area.
 *
 * HR-51 and HR-38 are the Faridabad RTO series; DL, HR-26 (Gurgaon) and UP-16
 * appear because a large share of this belt commutes across state lines.
 */

const SERIES = [
  { code: 'HR51', prefix: 'HR', district: '51', weight: 45 },
  { code: 'DL',   prefix: 'DL', district: '01', weight: 20 },
  { code: 'HR38', prefix: 'HR', district: '38', weight: 15 },
  { code: 'HR26', prefix: 'HR', district: '26', weight: 10 },
  { code: 'UP16', prefix: 'UP', district: '16', weight: 10 },
];

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // no I/O/Q — not used on Indian plates

const CARS = [
  ['Maruti Suzuki', 'Swift'], ['Maruti Suzuki', 'Baleno'], ['Maruti Suzuki', 'Brezza'],
  ['Maruti Suzuki', 'WagonR'], ['Hyundai', 'i20'], ['Hyundai', 'Creta'],
  ['Hyundai', 'Venue'], ['Tata', 'Nexon'], ['Tata', 'Punch'], ['Honda', 'City'],
  ['Honda', 'Amaze'], ['Mahindra', 'Scorpio'], ['Mahindra', 'XUV700'],
  ['Toyota', 'Innova Crysta'], ['Kia', 'Seltos'], ['Kia', 'Sonet'],
];

const BIKES = [
  ['Honda', 'Activa'], ['Hero', 'Splendor Plus'], ['Hero', 'HF Deluxe'],
  ['Bajaj', 'Pulsar 150'], ['TVS', 'Jupiter'], ['Royal Enfield', 'Classic 350'],
  ['Suzuki', 'Access 125'], ['Yamaha', 'FZ'],
];

const COMMERCIAL = [
  ['Mahindra', 'Bolero Pickup'], ['Tata', 'Ace'], ['Piaggio', 'Ape E-City'],
  ['Mahindra', 'Treo'],
];

const COLORS = ['White', 'Silver', 'Grey', 'Red', 'Blue', 'Black', 'Brown', 'Maroon'];

function weightedPick(items, rand, weightOf) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

export function randomPlate(rand) {
  const series = weightedPick(SERIES, rand, (s) => s.weight);
  const letters = LETTERS[Math.floor(rand() * LETTERS.length)]
    + LETTERS[Math.floor(rand() * LETTERS.length)];
  const digits = String(Math.floor(rand() * 9000) + 1000);
  const plate = `${series.prefix}${series.district}${letters}${digits}`;
  const display = `${series.prefix} ${series.district} ${letters} ${digits}`;
  return { plate, display, series: series.code };
}

export function randomVehicle(rand) {
  const roll = rand();
  let make, model, type;
  if (roll < 0.55) {
    [make, model] = pick(CARS, rand);
    type = 'car';
  } else if (roll < 0.90) {
    [make, model] = pick(BIKES, rand);
    type = 'bike';
  } else {
    [make, model] = pick(COMMERCIAL, rand);
    type = 'commercial';
  }
  return { make, model, color: pick(COLORS, rand), type };
}
