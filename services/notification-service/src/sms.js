export async function sendSMS(mobile, message) {
  const useMock = !process.env.MSG91_AUTH_KEY || process.env.MSG91_AUTH_KEY === 'your-msg91-key';
  if (useMock) {
    console.log(`[SMS MOCK] To ${mobile}: ${message}`);
    return { success: true, mock: true };
  }
  // Real MSG91 API call would go here
  return { success: true, mock: false };
}

export async function sendEntryNotification(mobile, visitorName, unitNumber) {
  return sendSMS(mobile, `CommunityGate: ${visitorName} has entered. Unit ${unitNumber}.`);
}

export async function sendOTP(mobile, otp) {
  return sendSMS(mobile, `Your CommunityGate visitor pass OTP is: ${otp}. Valid for 24 hours.`);
}
