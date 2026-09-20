/**
 * Single source of truth for turning an as-entered plate into the form used
 * for repeat-vehicle matching. Used both at write time (ticket creation) and
 * at lookup time (the returning-vehicle banner, the plate-history report), so
 * the two can never drift apart.
 *
 * Deliberately does not touch the stored `plate` column, which keeps whatever
 * spacing and casing the guard typed, for display.
 *
 * "KA03NJ0435" and "KA 03 NJ 0435" both normalize to "KA03NJ0435".
 */
export function normalizePlate(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/\s+/g, '');
}
