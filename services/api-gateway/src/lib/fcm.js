/**
 * Push notifications via Expo Push API.
 * Works for both Android (FCM) and iOS (APNs) — Expo handles routing.
 * No Firebase project, no Apple certificates needed.
 * Free for all Expo accounts.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendExpoPush(messages) {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('[Push] Expo Push API error:', err.message);
    return null;
  }
}

export async function sendNotification(token, title, body, data = {}) {
  if (!token || !token.startsWith('ExponentPushToken[')) {
    console.log(`[Push-DEV] "${title}" — "${body}" → token:${token?.slice(0, 30)}...`);
    return null;
  }

  const result = await sendExpoPush([{
    to: token,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
    channelId: 'communitygate',
  }]);
  return result;
}

export async function sendVisitorAlert(token, visitorName, gateId) {
  if (!token || !token.startsWith('ExponentPushToken[')) {
    console.log(`[Push-DEV] Visitor alert: "${visitorName}" → token:${token?.slice(0, 30)}...`);
    return null;
  }

  const result = await sendExpoPush([{
    to: token,
    title: 'Visitor at Gate',
    body: `${visitorName} is at the gate — approve entry?`,
    data: { type: 'visitor_alert', gate_id: gateId, visitor_name: visitorName },
    sound: 'default',
    priority: 'high',
    channelId: 'communitygate',
    categoryId: 'visitor_alert',
  }]);
  return result;
}

export async function sendApprovalRequest(token, approvalId, visitorName, gateName, unitNumber) {
  if (!token || !token.startsWith('ExponentPushToken[')) {
    console.log(`[Push-DEV] Approval request: "${visitorName}" → token:${token?.slice(0, 30)}...`);
    return null;
  }

  const result = await sendExpoPush([{
    to: token,
    title: 'Visitor at Gate',
    body: `${visitorName} at ${gateName} — requesting entry to Unit ${unitNumber}`,
    data: {
      type: 'approval_request',
      approval_id: approvalId,
      visitor_name: visitorName,
      gate_name: gateName,
      unit_number: unitNumber,
    },
    sound: 'default',
    priority: 'high',
    channelId: 'communitygate',
    categoryId: 'approval_request',
  }]);
  return result;
}

export async function sendToMultiple(tokens, title, body, data = {}) {
  const validTokens = tokens.filter((t) => t && t.startsWith('ExponentPushToken['));
  if (validTokens.length === 0) {
    console.log(`[Push-DEV] "${title}" — "${body}" → ${tokens.length} tokens (none valid)`);
    return 0;
  }

  const messages = validTokens.map((token) => ({
    to: token,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
    channelId: 'communitygate',
  }));

  const result = await sendExpoPush(messages);
  return result ? validTokens.length : 0;
}
