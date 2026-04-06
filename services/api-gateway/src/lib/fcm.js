let admin = null;
let initialized = false;

async function getApp() {
  if (initialized) return admin;
  initialized = true;

  const credJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const credPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!credJson && !credPath) {
    console.log('[FCM] No Firebase credentials configured — notifications will be logged only');
    return null;
  }

  try {
    const firebaseAdmin = await import('firebase-admin');
    const credential = credJson
      ? firebaseAdmin.default.credential.cert(JSON.parse(credJson))
      : firebaseAdmin.default.credential.cert(credPath);
    admin = firebaseAdmin.default.initializeApp({ credential });
    console.log('[FCM] Firebase Admin initialized');
    return admin;
  } catch (err) {
    console.error('[FCM] Firebase init failed:', err.message);
    return null;
  }
}

export function isConfigured() {
  return !!(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
}

export async function sendNotification(token, title, body, data = {}) {
  const app = await getApp();
  if (!app) {
    console.log(`[FCM-DEV] Push: "${title}" — "${body}" → token:${token?.slice(0, 20)}...`);
    return null;
  }

  try {
    const { getMessaging } = await import('firebase-admin/messaging');
    const result = await getMessaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',
        notification: {
          channelId: 'communitygate',
          priority: 'high',
        },
      },
    });
    return result;
  } catch (err) {
    console.error(`[FCM] Send failed for token ${token?.slice(0, 20)}:`, err.message);
    return null;
  }
}

export async function sendVisitorAlert(token, visitorName, gateId) {
  const app = await getApp();
  if (!app) {
    console.log(`[FCM-DEV] Visitor alert: "${visitorName}" → token:${token?.slice(0, 20)}...`);
    return null;
  }

  try {
    const { getMessaging } = await import('firebase-admin/messaging');
    const result = await getMessaging().send({
      token,
      notification: {
        title: 'Visitor at Gate',
        body: `${visitorName} is at the gate — approve entry?`,
      },
      data: {
        type: 'visitor_alert',
        gate_id: gateId,
        visitor_name: visitorName,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'communitygate',
          priority: 'high',
        },
      },
    });
    return result;
  } catch (err) {
    console.error(`[FCM] Visitor alert failed for token ${token?.slice(0, 20)}:`, err.message);
    return null;
  }
}

export async function sendToMultiple(tokens, title, body, data = {}) {
  const results = await Promise.allSettled(
    tokens.map((t) => sendNotification(t, title, body, data))
  );
  return results.filter((r) => r.status === 'fulfilled' && r.value).length;
}
