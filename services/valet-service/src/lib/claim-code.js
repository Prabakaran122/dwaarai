import crypto from 'crypto';

/**
 * The code a guest carries away when there is no printed card.
 *
 * Said out loud across a valet desk and typed on a phone, so the alphabet
 * drops every pair that gets misheard or mistyped: no O or 0, no I or 1, no S
 * or 5. What is left is 30 characters, and six of them give ~729 million
 * combinations — far beyond guessing at the handful of tickets a venue has
 * open, especially behind a rate limit.
 *
 * Unlike a card code this is globally unique among open tickets, because the
 * guest types it with no venue context: the code is the whole address.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ23456789';
const LENGTH = 6;

export function newClaimCode() {
  // Rejection sampling rather than % ALPHABET.length: the modulo would make
  // the first two letters measurably likelier than the rest, and a code space
  // is only as large as its least likely corner.
  const out = [];
  while (out.length < LENGTH) {
    for (const byte of crypto.randomBytes(LENGTH * 2)) {
      if (byte >= 248) continue; // 248 = 8 * 31, the largest usable multiple
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === LENGTH) break;
    }
  }
  return out.join('');
}

/**
 * Normalizes what a guest typed back.
 *
 * The alphabet omits O, I, S, 0 and 1 precisely because they are confusable —
 * so a guest typing one of them has misread a character that IS in the
 * alphabet. Folding each onto its survivor turns a near-miss into a match
 * instead of a dead end at the desk.
 */
const CONFUSABLE = { O: 'Q', '0': 'Q', I: 'J', '1': 'J', S: '5' };

export function normalizeClaimCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .split('')
    .map((ch) => CONFUSABLE[ch] ?? ch)
    .join('');
}
