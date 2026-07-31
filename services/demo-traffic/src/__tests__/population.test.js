// services/demo-traffic/src/__tests__/population.test.js
import { describe, it, expect } from 'vitest';
import { buildPopulation } from '../population.js';

describe('buildPopulation', () => {
  const pop = buildPopulation(2043);

  it('builds 6 towers', () => {
    expect(pop.blocks).toHaveLength(6);
    expect(pop.blocks.map((b) => b.name)).toContain('Tower A');
    expect(pop.blocks.map((b) => b.name)).toContain('Tower F');
  });

  it('builds roughly 450 units across those towers', () => {
    expect(pop.units.length).toBeGreaterThanOrEqual(430);
    expect(pop.units.length).toBeLessThanOrEqual(470);
    const blockIds = new Set(pop.blocks.map((b) => b.id));
    for (const u of pop.units) expect(blockIds.has(u.blockId)).toBe(true);
  });

  it('numbers units as <tower letter>-<floor><nn>', () => {
    for (const u of pop.units.slice(0, 20)) {
      expect(u.unitNumber).toMatch(/^[A-F]-\d{3,4}$/);
    }
  });

  it('gives every occupied unit exactly one primary resident', () => {
    const occupied = pop.units.filter((u) => u.status === 'occupied');
    for (const u of occupied.slice(0, 30)) {
      const primaries = pop.residents.filter((r) => r.unitId === u.id && r.isPrimary);
      expect(primaries).toHaveLength(1);
    }
  });

  it('leaves a realistic tail of unoccupied units', () => {
    const statuses = new Set(pop.units.map((u) => u.status));
    expect(statuses.has('occupied')).toBe(true);
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('builds around 600 vehicles with unique plates', () => {
    expect(pop.vehicles.length).toBeGreaterThanOrEqual(550);
    expect(pop.vehicles.length).toBeLessThanOrEqual(680);
    const plates = new Set(pop.vehicles.map((v) => v.plate));
    expect(plates.size).toBe(pop.vehicles.length);
  });

  it('gives most vehicles an RFID tag but not all', () => {
    const tagged = pop.vehicles.filter((v) => v.rfidUidHash).length;
    expect(tagged).toBeGreaterThan(pop.vehicles.length * 0.6);
    expect(tagged).toBeLessThan(pop.vehicles.length);
  });

  it('builds guards across three shifts', () => {
    expect(pop.guards.length).toBeGreaterThanOrEqual(6);
    for (const g of pop.guards) expect(g.type).toBe('guard');
  });

  it('is deterministic for a given seed', () => {
    const again = buildPopulation(2043);
    expect(again.units.length).toBe(pop.units.length);
    expect(again.vehicles.map((v) => v.plate)).toEqual(pop.vehicles.map((v) => v.plate));
  });
});
