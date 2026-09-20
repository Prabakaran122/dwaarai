/**
 * Texting a guest the code that gets them back to their car.
 *
 * A guest with no printed card leaves holding six characters. Reading them
 * across a desk works until the lobby is loud, the guest is in a hurry, or the
 * code goes onto a bill that ends up in a bin -- and then the car has no route
 * back to its owner, which is the exact problem the claim code was invented to
 * solve.
 *
 * Every path returns a status instead of throwing. The car has already been
 * taken in by the time this runs; a failed text must never fail the intake.
 * And it reports `skipped` rather than success when MSG91 is unconfigured,
 * because the alternative -- telling a guard the message went when nothing
 * left the building -- is worse than telling them it did not.
 */

const MSG91_BASE = 'https://control.msg91.com/api/v5';

// Read per call, not at import: the service is long-lived and the tests need
// to exercise both the configured and unconfigured paths.
const authKey = () => process.env.MSG91_AUTH_KEY || '';

export async function sendClaimCode({ phoneNumber, claimCode, claimUrl, venueName }) {
  if (!authKey()) return { status: 'skipped' };

  const digits = String(phoneNumber || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return { status: 'failed' };

  // Both the code and the link. The link is the useful one -- it opens the
  // live ticket with the ETA and the pickup QR -- but a URL in an Indian SMS
  // is also the shape of every phishing text, and a guest who will not tap it
  // can still type six characters at /valet.
  const message =
    `${venueName}: your valet code is ${claimCode}. ` +
    `Track your car and request it at ${claimUrl}`;

  try {
    const res = await fetch(`${MSG91_BASE}/flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: authKey() },
      body: JSON.stringify({
        sender: process.env.MSG91_SENDER_ID || '',
        short_url: '0',
        mobiles: `91${digits}`,
        message,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return data?.type === 'error' ? { status: 'failed' } : { status: 'sent' };
  } catch {
    return { status: 'failed' };
  }
}
