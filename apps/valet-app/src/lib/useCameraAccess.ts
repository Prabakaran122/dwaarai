import { useCallback, useEffect } from 'react';
import { AppState, Linking } from 'react-native';
import { useCameraPermissions } from 'expo-camera';

/**
 * Camera permission for the live viewfinders (card scan, plate, handover QR,
 * shift photo), with a button that always does something.
 *
 * `requestPermission()` alone is a dead button once the OS has stopped asking:
 * iOS after one refusal, Android after two. The valet taps "Allow camera" and
 * nothing happens -- no prompt, no error. So `ask()` requests while the OS will
 * still show the prompt, and otherwise opens this app's page in Settings where
 * the camera can be switched on. The permission is re-read whenever the app
 * comes back to the foreground, so returning from Settings turns the camera on
 * without leaving and re-entering the screen.
 */
export function useCameraAccess() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') getPermission?.();
    });
    return () => sub.remove();
  }, [getPermission]);

  const blocked = !!permission && !permission.granted && permission.canAskAgain === false;

  const ask = useCallback(async () => {
    if (permission?.granted) return true;
    if (blocked) {
      await Linking.openSettings();
      return false;
    }
    const result = await requestPermission();
    if (result?.granted) return true;
    // Refused just now and the OS will not ask again: take them to Settings
    // in the same tap rather than leaving a button that does nothing next time.
    if (result && result.canAskAgain === false) await Linking.openSettings();
    return false;
  }, [permission?.granted, blocked, requestPermission]);

  return { permission, granted: permission?.granted === true, blocked, ask, request: requestPermission };
}
