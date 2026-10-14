import { describe, it, expect } from 'vitest';
import {
  viewCostPaise, gstPaise, withGst, monthlyCeilingPaise,
  balanceFromLedger, splitSpend, quotaFor,
} from '../lib/ads.js';

// ─────────────────────────────────────────────────────────────────────────────
// The commercial arithmetic.
//
// Every number here ends up on an invoice, so the tests are about the cases
// that would be argued over: rounding, which pot a spend comes from, and what
// a group is told it might owe.
// ─────────────────────────────────────────────────────────────────────────────

describe('viewCostPaise', () => {
  // The design is explicit: "900 views costs ₹1,350, never rounded up". A rate
  // card that rounded a part-thousand up to the next thousand would overcharge
  // every advertiser who did not fill a block, which is most of them.
  it('charges exact views, not rounded-up blocks', () => {
    expect(viewCostPaise(900, 150)).toBe(135000);
    expect(viewCostPaise(1000, 150)).toBe(150000);
    expect(viewCostPaise(1, 150)).toBe(150);
  });

  it('is zero for a promotion nobody saw', () => {
    expect(viewCostPaise(0, 150)).toBe(0);
  });
});

describe('gstPaise', () => {
  it('is 18% of the net, to the paisa', () => {
    expect(gstPaise(300000, 18)).toBe(54000);
  });

  // Rounded once on the whole amount. Per-view rounding and summing gives a
  // different total, and the one that matters is the one on the invoice.
  it('rounds once, at the end', () => {
    // 1 view at ₹1.50 → 150 paise; 18% is 27 paise exactly.
    expect(gstPaise(viewCostPaise(1, 150), 18)).toBe(27);
    // 7 views → 1050 paise; 18% is 189 paise. Seven separate roundings of
    // 27 paise would also be 189 here, so use a rate that actually differs:
    expect(gstPaise(viewCostPaise(7, 133), 18)).toBe(Math.round((7 * 133 * 18) / 100));
  });

  it('carries the rate rather than assuming one, because tax rates change', () => {
    expect(gstPaise(100000, 5)).toBe(5000);
    expect(gstPaise(100000, 0)).toBe(0);
  });
});

describe('withGst', () => {
  it('reports net, tax and total separately so an invoice can be read', () => {
    expect(withGst(300000, 18)).toEqual({
      netPaise: 300000, gstPaise: 54000, totalPaise: 354000,
    });
  });
});

describe('monthlyCeilingPaise', () => {
  // The question this answers is "what is the worst this can cost me", so the
  // minimum is a floor the spending limit cannot duck under.
  it('is the greater of the spending limit and the monthly minimum', () => {
    expect(monthlyCeilingPaise({
      spendLimitPaise: 300000, monthlyMinimumPaise: 200000, gstPercent: 18,
    }).totalPaise).toBe(354000);

    expect(monthlyCeilingPaise({
      spendLimitPaise: 100000, monthlyMinimumPaise: 200000, gstPercent: 18,
    }).netPaise).toBe(200000);
  });

  it('treats no limit as the minimum rather than as unlimited', () => {
    expect(monthlyCeilingPaise({
      spendLimitPaise: null, monthlyMinimumPaise: 200000, gstPercent: 18,
    }).netPaise).toBe(200000);
  });
});

describe('balanceFromLedger', () => {
  it('sums the ledger and keeps free credit separate from paid balance', () => {
    const b = balanceFromLedger([
      { amount_paise: 250000, is_credit: true },
      { amount_paise: 500000, is_credit: false },
      { amount_paise: -100000, is_credit: true },
    ]);

    expect(b).toEqual({ creditPaise: 150000, paidPaise: 500000, totalPaise: 650000 });
  });

  // A negative "free credit remaining" on a screen is worse than a zero: it
  // reads as the venue owing money they were given.
  it('never reports a negative pot', () => {
    expect(balanceFromLedger([{ amount_paise: -5000, is_credit: true }]).creditPaise).toBe(0);
  });

  it('is zero on an empty ledger, not undefined', () => {
    expect(balanceFromLedger([])).toEqual({ creditPaise: 0, paidPaise: 0, totalPaise: 0 });
  });
});

describe('splitSpend', () => {
  it('spends free credit first', () => {
    expect(splitSpend(100000, 250000)).toEqual({ fromCreditPaise: 100000, fromPaidPaise: 0 });
  });

  it('falls through to paid balance once the credit is gone', () => {
    expect(splitSpend(300000, 250000)).toEqual({ fromCreditPaise: 250000, fromPaidPaise: 50000 });
  });

  it('takes it all from paid when there is no credit', () => {
    expect(splitSpend(100000, 0)).toEqual({ fromCreditPaise: 0, fromPaidPaise: 100000 });
  });
});

describe('quotaFor', () => {
  const properties = [
    { status: 'live', carsThisMonth: 2700, holdBack: 0 },
    { status: 'live', carsThisMonth: 800, holdBack: 300 },
    { status: 'live', carsThisMonth: 1450, holdBack: 0 },
    // Signed but not open: contributes nothing and draws nothing.
    { status: 'setting_up', carsThisMonth: 0, holdBack: 0 },
  ];

  // A group that has signed four hotels and opened three is not paying for the
  // fourth, and counting it would hand them a pool they cannot use.
  it('counts only live properties toward the pool', () => {
    expect(quotaFor({ properties, carsPerProperty: 2000, mode: 'shared' }).includedCars)
      .toBe(6000);
  });

  it('reports what the group has actually used across every property', () => {
    expect(quotaFor({ properties, carsPerProperty: 2000, mode: 'shared' }).usedCars)
      .toBe(4950);
  });

  // Held-back cars are reserved out of the shared pool — that is the point of
  // holding them back — so they reduce what anybody else may draw on.
  it('keeps held-back cars out of the shared remainder', () => {
    const q = quotaFor({ properties, carsPerProperty: 2000, mode: 'shared' });

    expect(q.heldBackCars).toBe(300);
    expect(q.sharedRemaining).toBe(6000 - 4950 - 300);
  });

  // Under a fixed limit each property keeps to its own allocation, so there is
  // no shared remainder to report. Null, not zero: zero would read as "the
  // pool is empty", which is a different and alarming claim.
  it('reports no shared remainder under a fixed limit', () => {
    expect(quotaFor({ properties, carsPerProperty: 2000, mode: 'fixed' }).sharedRemaining)
      .toBe(null);
  });

  it('reports the overage once the group is past its pool', () => {
    const heavy = [{ status: 'live', carsThisMonth: 2700, holdBack: 0 }];

    expect(quotaFor({ properties: heavy, carsPerProperty: 2000, mode: 'shared' }).overageCars)
      .toBe(700);
  });

  it('has no overage while the group is inside its pool', () => {
    expect(quotaFor({ properties, carsPerProperty: 2000, mode: 'shared' }).overageCars).toBe(0);
  });
});
