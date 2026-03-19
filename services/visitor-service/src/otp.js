import crypto from 'crypto';

export function generateOTP(length = 6) {
  const digits = '0123456789';
  let otp = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[bytes[i] % 10];
  }
  return otp;
}

export async function sendOTPViaSMS(mobile, otp, visitorName) {
  // Mock mode for development — log to console instead of calling MSG91
  const useMock = process.env.MSG91_AUTH_KEY === 'your-msg91-key' || !process.env.MSG91_AUTH_KEY;
  if (useMock) {
    console.log(`[SMS MOCK] OTP ${otp} sent to ${mobile} for visitor ${visitorName}`);
    return { success: true, mock: true };
  }
  // Real MSG91 integration would go here
  // const response = await fetch(...)
  console.log(`[SMS] Sending OTP to ${mobile}`);
  return { success: true, mock: false };
}
