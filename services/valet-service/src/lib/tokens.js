import { customAlphabet, nanoid } from 'nanoid';

// Unambiguous uppercase alphabet (no 0/O, no 1/I) for anything a human ever
// reads aloud or types at a counter.
const humanAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const humanId = customAlphabet(humanAlphabet, 6);

/** Long unguessable token embedded in the guest's QR / URL. */
export function newSessionToken() {
  return nanoid(32);
}

/** Short-lived token for the rotating pickup QR. */
export function newRotatingToken() {
  return nanoid(24);
}

/** Human-typeable discount code, e.g. read aloud or typed at a POS later. */
export function newDiscountCode() {
  return `SARTHI-${humanId()}`;
}

/**
 * Short, sequential-looking display id, scoped per community.
 *
 * Purely cosmetic: it is never used to look up a ticket, only `session_token`
 * resolves one, so incrementing this string cannot walk into another guest's
 * data. Derived from the highest existing sequence in the database rather
 * than an in-memory counter, so it survives a restart without colliding.
 *
 * `SRT-0001`. The caller runs this inside the same transaction as the insert
 * so two concurrent ticket creations cannot pick the same sequence; the
 * UNIQUE (community_id, display_id) constraint is the backstop if they do.
 */
export function nextDisplayId(lastDisplayId) {
  const lastSeq = lastDisplayId ? Number(String(lastDisplayId).split('-')[1]) || 0 : 0;
  return `SRT-${String(lastSeq + 1).padStart(4, '0')}`;
}
