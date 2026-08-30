import { queryOne } from '../db.js';
import { newDiscountCode } from './tokens.js';

const DISCOUNT_EXPIRY_DAYS = Number(process.env.DISCOUNT_EXPIRY_DAYS || 30);

/**
 * Issues a discount code tied to a phone number and community, kept separate
 * from any vehicle or valet record.
 *
 * Retries on the rare nanoid collision against the UNIQUE constraint on
 * valet_discount_optins.code — 23505 is Postgres' unique_violation.
 */
export async function issueDiscountCode({ phoneNumber, communityId, ticketId, consentAt }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newDiscountCode();
    try {
      const row = await queryOne(
        `INSERT INTO valet_discount_optins
           (code, phone_number, community_id, ticket_id, consent_at, expiry)
         VALUES ($1, $2, $3, $4, $5, NOW() + $6::interval)
         RETURNING id, code, issued_at, expiry`,
        [code, phoneNumber, communityId, ticketId, consentAt, `${DISCOUNT_EXPIRY_DAYS} days`]
      );
      return row;
    } catch (err) {
      if (err?.code !== '23505') throw err;
    }
  }
  throw new Error('Could not generate a unique discount code after 5 attempts');
}
