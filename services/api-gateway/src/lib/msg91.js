import axios from 'axios';

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
  const res = await axios.post(
    `${MSG91_BASE}/otp`,
    { template_id: TEMPLATE_ID, mobile, otp_length: OTP_LENGTH },
    { headers: { authkey: AUTH_KEY }, timeout: 10000 }
  );
  if (res.data?.type === 'error') {
    throw new Error(res.data.message || 'MSG91 send failed');
  }
  return res.data;
}

/**
 * Verify OTP via MSG91.
 * Returns true if OTP is valid, false if invalid/expired.
 * Does NOT throw on invalid OTP.
 */
export async function verifyOTP(phone, otp) {
  const mobile = phone.startsWith('91') ? phone : `91${phone}`;
  try {
    const res = await axios.post(
      `${MSG91_BASE}/otp/verify`,
      { mobile, otp },
      { headers: { authkey: AUTH_KEY }, timeout: 10000 }
    );
    return res.data?.type === 'success';
  } catch (err) {
    // MSG91 returns 4xx for invalid OTP — treat as verification failure, not error
    if (err.response?.status >= 400 && err.response?.status < 500) {
      return false;
    }
    throw err;
  }
}
