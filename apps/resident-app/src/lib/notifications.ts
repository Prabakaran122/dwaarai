import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { registerFCMToken, sendGateCommand } from '../api/client';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[Notifications] Not a physical device — skipping registration');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission not granted');
    return null;
  }

  // Set up Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('communitygate', {
      name: 'CommunityGate',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3b82f6',
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: 'communitygate-resident',
  });
  const token = tokenData.data;

  // Register with our server
  try {
    await registerFCMToken(token);
    console.log('[Notifications] Token registered:', token.slice(0, 20) + '...');
  } catch (err) {
    console.error('[Notifications] Token registration failed:', err);
  }

  return token;
}

export function setupNotificationListeners() {
  // Handle notification actions (approve/deny buttons)
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    async (response) => {
      const data = response.notification.request.content.data;
      const actionId = response.actionIdentifier;

      if (data?.type === 'visitor_alert' && data?.gate_id) {
        if (actionId === 'approve') {
          try {
            await sendGateCommand(data.gate_id as string, 'open');
          } catch (err) {
            console.error('[Notifications] Approve action failed:', err);
          }
        } else if (actionId === 'deny') {
          try {
            await sendGateCommand(data.gate_id as string, 'deny');
          } catch (err) {
            console.error('[Notifications] Deny action failed:', err);
          }
        }
      }
    }
  );

  return () => {
    responseSubscription.remove();
  };
}
