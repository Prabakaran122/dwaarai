import { describe, it, expect } from 'vitest';
import { randomPlate, randomVehicle } from '../plates.js';
import { mulberry32 } from '../rhythm.js';

const PLATE_RE = /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/;

describe('randomPlate', () => {
  it('produces a normalised Indian plate and a spaced display form', () => {
    const rand = mulberry32(3);
    const { plate, display } = randomPlate(rand);
    expect(plate).toMatch(PLATE_RE);
    expect(display.replace(/ /g, '')).toBe(plate);
  });

  it('is dominated by Faridabad series over many draws', () => {
    const rand = mulberry32(11);
    const counts = {};
    for (let i = 0; i < 4000; i++) {
      const { series } = randomPlate(rand);
      counts[series] = (counts[series] || 0) + 1;
    }
    const faridabad = (counts.HR51 || 0) + (counts.HR38 || 0);
    expect(faridabad / 4000).toBeGreaterThan(0.5);
    expect(counts.DL).toBeGreaterThan(0);
    expect(counts.HR26).toBeGreaterThan(0);
  });

  it('never emits a plate from outside the configured series', () => {
    const rand = mulberry32(5);
    const allowed = new Set(['HR51', 'HR38', 'DL', 'HR26', 'UP16']);
    for (let i = 0; i < 500; i++) {
      expect(allowed.has(randomPlate(rand).series)).toBe(true);
    }
  });
});

describe('randomVehicle', () => {
  it('returns a make, model, colour and type', () => {
    const rand = mulberry32(9);
    const v = randomVehicle(rand);
    expect(v.make).toBeTruthy();
    expect(v.model).toBeTruthy();
    expect(v.color).toBeTruthy();
    expect(['car', 'bike', 'commercial']).toContain(v.type);
  });

  it('is majority cars with a real two-wheeler population', () => {
    const rand = mulberry32(13);
    const counts = { car: 0, bike: 0, commercial: 0 };
    for (let i = 0; i < 2000; i++) counts[randomVehicle(rand).type]++;
    expect(counts.car / 2000).toBeGreaterThan(0.45);
    expect(counts.bike / 2000).toBeGreaterThan(0.25);
    expect(counts.commercial).toBeGreaterThan(0);
  });
});
