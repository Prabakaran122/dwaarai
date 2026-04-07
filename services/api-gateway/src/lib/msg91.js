const MSG91_BASE = 'https://control.msg91.com/api/v5';
const AUTH_KEY = process.env.MSG91_AUTH_KEY || '';
const TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID || '';
const OTP_LENGTH = parseInt(process.env.MSG91_OTP_LENGTH || '6', 10);

/**
 * Returns true if MSG91 credentials are configured.
 * When false, callers should fall back to Redis-based OTP for dev mode.
 */
export function isConfigured() {
  return !!(AUTH_KEY && TEMPLATE_ID);
}

/**
 * Send OTP via MSG91. MSG91 generates the OTP and sends it via SMS.
 * Phone should be 10-digit Indian mobile (without country code).
 * Throws on failure.
 */
export async function sendOTP(phone) {
  const mobile = phone.startsWith('91') ? phone : `91${phone}`;
  const res = await fetch(`${MSG91_BASE}/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: AUTH_KEY },
    body: JSON.stringify({ template_id: TEMPLATE_ID, mobile, otp_length: OTP_LENGTH }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (data?.type === 'error') {
    throw new Error(data.message || 'MSG91 send failed');
  }
  return data;
}

/**
 * Verify OTP via MSG91.
 * Returns true if OTP is valid, false if invalid/expired.
 * Does NOT throw on invalid OTP.
 */
export async function verifyOTP(phone, otp) {
  const mobile = phone.startsWith('91') ? phone : `91${phone}`;
  try {
    const res = await fetch(`${MSG91_BASE}/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: AUTH_KEY },
      body: JSON.stringify({ mobile, otp }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return data?.type === 'success';
  } catch (err) {
    // Network errors should propagate, but treat HTTP errors as OTP failure
    if (err.name === 'AbortError') throw err;
    return false;
  }
}
