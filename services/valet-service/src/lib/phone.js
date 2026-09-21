/**
 * One shape for a phone number, whichever door it came in through.
 *
 * A guard types ten digits into the app. WhatsApp delivers twelve, country
 * code attached. Both end up in valet_tickets.phone_number, and the webhook
 * matched them with `=`, so a guest whose number a guard had typed could
 * never be found by their own message -- the WhatsApp flow simply did not
 * work for that ticket, silently, with a 200 telling the provider otherwise.
 */
const DEFAULT_CC = () => (process.env.WHATSAPP_COUNTRY_CODE || '91').replace(/\D/g, '');

/** Digits only, country code attached. Returns '' for anything unusable. */
export function normalizePhone(raw, cc = DEFAULT_CC()) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  if (digits.length === 10) return `${cc}${digits}`;
  return digits;
}

/**
 * The last ten digits, which is what two records of the same number always
 * share however they were written.
 *
 * Used for matching rather than the normalised form, because rows written
 * before this existed keep whatever shape they were given and a migration
 * cannot reach a number a guard typed years of tickets ago.
 */
export function phoneKey(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(-10);
}
