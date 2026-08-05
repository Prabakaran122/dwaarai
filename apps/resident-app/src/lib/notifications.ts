import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { registerFCMToken, sendGateCommand, respondToApproval } from '../api/client';

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

  // Register actionable notification categories
  await Notifications.setNotificationCategoryAsync('approval_request', [
    {
      identifier: 'approve',
      buttonTitle: 'Approve',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'deny',
      buttonTitle: 'Deny',
      options: { isDestructive: true, opensAppToForeground: false },
    },
  ]);

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

/**
 * Decide what a tapped push should open. Split out as a pure function so the
 * routing is testable without standing up expo-notifications.
 *
 * The server sends `approval_id` (snake_case) on `approval_request` pushes
 * (see `sendApprovalRequest` in services/api-gateway/src/lib/fcm.js) but
 * `issueId` (camelCase) on `issue_resolved` pushes (see `notifyIssueResolved`
 * in services/api-gateway/src/routes/issues.js). Both spellings of the
 * approval field are accepted here so real approval_request pushes keep
 * routing correctly.
 */
export function routeNotificationData(
  data: Record<string, unknown> | undefined,
  onApproval: (approvalId: string, data: Record<string, unknown>) => void,
  onIssueResolved?: (issueId: string) => void
): void {
  if (!data) return;
  if (data.type === 'issue_resolved') {
    if (typeof data.issueId === 'string' && data.issueId) onIssueResolved?.(data.issueId);
    return;
  }
  const approvalId = data.approvalId ?? data.approval_id;
  if (typeof approvalId === 'string' && approvalId) {
    onApproval(approvalId, data);
  }
}

export function setupNotificationListeners(
  onApprovalReceived?: (approvalId: string, data: any) => void,
  onIssueResolved?: (issueId: string) => void
) {
  // Handle notification actions (approve/deny buttons from banner)
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    async (response) => {
      const data = response.notification.request.content.data;
      const actionId = response.actionIdentifier;

      if (data?.type === 'approval_request' && data?.approval_id && (actionId === 'approve' || actionId === 'deny')) {
        // Quick action from notification banner
        try {
          await respondToApproval(data.approval_id as string, actionId);
        } catch (err) {
          console.error(`[Notifications] ${actionId} action failed:`, err);
        }
        return;
      }

      // Legacy visitor_alert handling
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
        return;
      }

      // Tapped notification body (approval_request or issue_resolved) — route it.
      routeNotificationData(
        data as Record<string, unknown> | undefined,
        (approvalId, d) => onApprovalReceived?.(approvalId, d),
        onIssueResolved
      );
    }
  );

  // Handle foreground notifications — show approval screen
  const foregroundSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      const data = notification.request.content.data;
      if (data?.type === 'approval_request' && data?.approval_id) {
        onApprovalReceived?.(data.approval_id as string, data);
      }
    }
  );

  return () => {
    responseSubscription.remove();
    foregroundSubscription.remove();
  };
}
