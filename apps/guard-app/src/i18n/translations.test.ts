import { translations } from './translations';

describe('Nazar home/nav translations (BRD 8.4 — en/hi/kn complete on Day 1)', () => {
  const requiredKeys = [
    'navGate',
    'navVisitors',
    'navParcels',
    'navIncident',
    'quickNewVisitor',
    'quickVehicleEntry',
    'quickDelivery',
    'quickIncident',
    'vehicleApproaching',
    'comingInThisRedesign',
  ];

  it.each(requiredKeys)('%s has non-empty en, hi, and kn strings', (key) => {
    const entry = translations[key];
    expect(entry).toBeDefined();
    expect(entry.en.length).toBeGreaterThan(0);
    expect(entry.hi.length).toBeGreaterThan(0);
    expect(entry.kn.length).toBeGreaterThan(0);
  });
});
