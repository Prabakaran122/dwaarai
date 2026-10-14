/**
 * What a promotion costs, and what a group's cars cost.
 *
 * Money is integer paise. Floats do not survive a ledger, and a tenth of a
 * paisa compounded over a hundred thousand views is a number nobody can
 * reconcile.
 *
 * Nothing here knows a rate. Every figure arrives from the account row, so a
 * group on negotiated terms is representable and a price change is a settings
 * edit rather than a release. The defaults live in migration 069, which is the
 * one place a rate card belongs if it must live in the repo at all.
 */

/** Exact views, never rounded up: 900 views at ₹1.50 is ₹1,350, not ₹1,500. */
export function viewCostPaise(views, pricePerViewPaise) {
  return Math.max(0, Math.round(views * pricePerViewPaise));
}

/**
 * Tax on a figure, rounded to the paisa.
 *
 * Rounded once, at the end, on the whole amount — computing GST per view and
 * summing gives a different answer, and the one that matters is the one on the
 * invoice.
 */
export function gstPaise(amountPaise, gstPercent) {
  return Math.round((amountPaise * gstPercent) / 100);
}

export function withGst(amountPaise, gstPercent) {
  const gst = gstPaise(amountPaise, gstPercent);
  return { netPaise: amountPaise, gstPaise: gst, totalPaise: amountPaise + gst };
}

/**
 * What a venue could pay this month for one promotion, at most.
 *
 * The spending limit is a cap on DELIVERY, not a charge: a promotion that
 * reaches nobody costs the monthly minimum and no more. Said as a ceiling
 * because that is the question being asked — "what is the worst this can
 * cost me" — and an estimate dressed as a forecast is how somebody gets a
 * surprise.
 */
export function monthlyCeilingPaise({ spendLimitPaise, monthlyMinimumPaise, gstPercent }) {
  const net = Math.max(spendLimitPaise ?? 0, monthlyMinimumPaise ?? 0);
  return withGst(net, gstPercent);
}

/**
 * The balance, and how much of it is free credit.
 *
 * Summed from the ledger rather than read from a column: a running total is a
 * number somebody has to keep correct under concurrency, and the first time it
 * drifts nobody can say when or why. Free credit is reported separately
 * because it is spent first and cannot be refunded.
 */
export function balanceFromLedger(rows) {
  let credit = 0;
  let paid = 0;
  for (const r of rows) {
    const amount = Number(r.amount_paise);
    if (r.is_credit) credit += amount;
    else paid += amount;
  }
  // Spends are recorded against whichever pot they came from, so neither can
  // go negative on its own; clamped anyway, because a negative "free credit
  // remaining" on a screen is worse than a zero.
  return {
    creditPaise: Math.max(0, credit),
    paidPaise: Math.max(0, paid),
    totalPaise: Math.max(0, credit) + Math.max(0, paid),
  };
}

/**
 * Which pot a spend comes out of. Free credit first, always.
 *
 * Returns the split rather than one number, because the ledger records them as
 * separate rows — merging them would make "how much of my free credit is
 * left" unanswerable the moment a top-up lands.
 */
export function splitSpend(amountPaise, creditPaise) {
  const fromCredit = Math.min(amountPaise, Math.max(0, creditPaise));
  return { fromCreditPaise: fromCredit, fromPaidPaise: amountPaise - fromCredit };
}

/**
 * A group's car pool for the month.
 *
 * Only LIVE properties contribute. A group that has signed four hotels and
 * opened one is not paying for three empty porches, and counting them would
 * hand them a pool they cannot use and an alert threshold they never reach.
 *
 * Held-back cars come out of the shared pool but stay against the property
 * that reserved them — that is the whole point of holding them back.
 */
export function quotaFor({ properties, carsPerProperty, mode }) {
  const live = properties.filter((p) => p.status === 'live');
  const included = live.length * carsPerProperty;
  const used = properties.reduce((n, p) => n + p.carsThisMonth, 0);
  const heldBack = live.reduce((n, p) => n + (p.holdBack ?? 0), 0);

  return {
    mode,
    includedCars: included,
    usedCars: used,
    heldBackCars: heldBack,
    // What any property may still draw on. Under 'fixed' a property keeps to
    // its own allocation, so there is no shared remainder to report.
    sharedRemaining: mode === 'shared'
      ? Math.max(0, included - used - heldBack)
      : null,
    overageCars: Math.max(0, used - included),
  };
}
