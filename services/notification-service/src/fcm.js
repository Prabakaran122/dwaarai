export async function sendPushNotification(fcmToken, title, body, data = {}) {
  const useMock = !process.env.FCM_PROJECT_ID || process.env.FCM_PROJECT_ID === 'your-firebase-project-id';
  if (useMock) {
    console.log(`[FCM MOCK] Push to ${fcmToken?.slice(0, 20)}...: ${title} — ${body}`);
    return { success: true, mock: true, messageId: `mock-${Date.now()}` };
  }
  // Real FCM would go here using firebase-admin SDK
  return { success: true, mock: false };
}

export async function sendToResident(db, residentId, title, body, data = {}) {
  const result = await db.query(
    'SELECT fcm_token FROM residents WHERE id = $1 AND fcm_token IS NOT NULL',
    [residentId]
  );
  if (!result.rows[0]?.fcm_token) {
    return { success: false, reason: 'no_fcm_token' };
  }
  return sendPushNotification(result.rows[0].fcm_token, title, body, data);
}
