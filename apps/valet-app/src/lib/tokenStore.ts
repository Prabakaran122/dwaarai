import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Where the access and refresh tokens live.
 *
 * Not AsyncStorage. That is a plain file in the app's sandbox, readable from
 * an unencrypted device backup or a rooted stand phone, and the refresh token
 * in it is a week of a valet's identity -- enough to hand cars over as them.
 * SecureStore keeps them in the Android Keystore / iOS Keychain instead.
 *
 * Web has no SecureStore, and the web build is a development convenience
 * rather than something a stand runs, so it falls back to AsyncStorage there
 * instead of failing to sign in at all.
 *
 * Builds before 0.9.0 wrote the tokens to AsyncStorage. A read that finds
 * nothing in SecureStore looks there once, moves what it finds and deletes the
 * plaintext copy -- otherwise every valet mid-shift on the day of the update
 * would be signed out, and the old copy would sit on disk forever.
 */

const secure = Platform.OS !== 'web';

export async function getToken(key: string): Promise<string | null> {
  if (!secure) return AsyncStorage.getItem(key);

  const stored = await SecureStore.getItemAsync(key);
  if (stored) return stored;

  // One-time migration from the plaintext store.
  let legacy: string | null = null;
  try {
    legacy = await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
  if (!legacy) return null;
  try {
    await SecureStore.setItemAsync(key, legacy);
    await AsyncStorage.removeItem(key);
  } catch {
    /* still usable this launch; the move is retried on the next read */
  }
  return legacy;
}

export async function setToken(key: string, value: string): Promise<void> {
  if (!secure) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteTokens(keys: string[]): Promise<void> {
  // Both stores, always: a migration interrupted halfway can leave a copy in
  // AsyncStorage, and signing out must not leave a token behind anywhere.
  if (secure) {
    await Promise.all(keys.map((k) => SecureStore.deleteItemAsync(k).catch(() => undefined)));
  }
  try {
    await AsyncStorage.multiRemove(keys);
  } catch {
    /* nothing left to do about it */
  }
}
