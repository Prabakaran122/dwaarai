import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

/**
 * Opening the camera, with every way it can fail turned into something the
 * valet can read.
 *
 * The screens used to call ImagePicker directly, with the await sitting
 * outside their try/catch. Anything the picker threw — a camera already held
 * by another surface, an activity torn down while the shot was being taken, a
 * vendor camera app that refuses the intent — became an unhandled rejection,
 * so the button did nothing at all. No error, no camera, no clue. That is the
 * worst failure a valet can hit at a stand with a guest waiting, because there
 * is nothing to report and nothing to try.
 *
 * Every path out of here is a value, never a throw.
 */

export type ShotResult =
  | { ok: true; uri: string }
  /** The valet backed out of the camera. Not a failure — say nothing. */
  | { ok: false; reason: 'cancelled' }
  /** Refused this time; asking again is still allowed. */
  | { ok: false; reason: 'denied' }
  /** Refused permanently. Only the OS settings screen can undo this. */
  | { ok: false; reason: 'blocked' }
  /** Something else broke. `detail` is shown on screen so it can be reported. */
  | { ok: false; reason: 'failed'; detail: string };

function describe(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'unknown error';
}

export async function takePhoto(): Promise<ShotResult> {
  let permission: ImagePicker.PermissionResponse;
  try {
    permission = await ImagePicker.requestCameraPermissionsAsync();
  } catch (err) {
    return { ok: false, reason: 'failed', detail: describe(err) };
  }

  if (!permission.granted) {
    // Android stops prompting once a permission is refused twice, and the
    // request then resolves instantly with granted false. Telling the valet to
    // "allow the camera" at that point is advice they cannot act on — the
    // prompt will never appear again.
    return { ok: false, reason: permission.canAskAgain === false ? 'blocked' : 'denied' };
  }

  try {
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
    if (shot.canceled) return { ok: false, reason: 'cancelled' };

    const uri = shot.assets?.[0]?.uri;
    // A result with no asset is not a cancel: the camera returned, and
    // treating it as one would silently drop a photo the valet believes they
    // took.
    if (!uri) return { ok: false, reason: 'failed', detail: 'camera returned no image' };

    return { ok: true, uri };
  } catch (err) {
    return { ok: false, reason: 'failed', detail: describe(err) };
  }
}

/** Opens this app's OS settings page, the only way back from 'blocked'. */
export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    /* Nothing useful to do if even the settings intent fails. */
  }
}
