import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../src/theme/colors';
import { useAuthStore } from '../src/store/authStore';
import { useLangStore } from '../src/store/langStore';
import { useAppFonts } from '../src/lib/fonts';
import ErrorBoundary from '../src/components/ErrorBoundary';
import LoginScreen from '../src/screens/LoginScreen';
import ValetFlow from '../src/screens/ValetFlow';
import ShiftStartScreen from '../src/screens/ShiftStartScreen';
import { installAuthRefresh } from '../src/api/valet';

/**
 * DwaarAI Valet's entry point.
 *
 * The whole app is the valet flow — there is no tab bar, because a valet does
 * one job. That is the difference between this and folding valet into the gate
 * guard's app, where it would have been a fifth tab beside Gate, Visitors,
 * Parcels and Incidents that no valet would ever use.
 */
export default function App() {
  const { token, restoring, restore } = useAuthStore();
  /**
   * BRD Screen 1b sits between sign-in and the queue, once per shift.
   *
   * Held in memory on purpose. A restored token means the app was reopened
   * mid-shift -- backgrounded between two cars -- and asking for the selfie
   * again there would be a photograph every few minutes rather than once. So
   * the check belongs to a fresh sign-in, which is what starting a shift
   * actually is.
   */
  const [shiftChecked, setShiftChecked] = useState(false);

  // A token that was already in storage when the app opened means the shift
  // is underway and the app was merely backgrounded between two cars. Asking
  // for the selfie there would mean a photograph every few minutes instead of
  // one per shift, so the check is skipped and belongs to a fresh sign-in --
  // which is what starting a shift actually is.
  useEffect(() => {
    if (!restoring && useAuthStore.getState().token) setShiftChecked(true);
  }, [restoring]);
  const rehydrateLang = useLangStore((s) => s.rehydrate);

  // Every screen styles text through font(), which returns a fontFamily of
  // 'DMSans_*'. On Android, referencing a family that was never loaded is a
  // FATAL error, not a fallback — the app dies on first render. Web silently
  // substitutes a system font, which is why this was invisible until the APK
  // was installed on a real device.
  const fontsLoaded = useAppFonts();

  useEffect(() => {
    // Before restore(), so a stored token that expired during the night is
    // refreshed on the first call rather than failing it.
    installAuthRefresh();
    restore();
    rehydrateLang();
  }, []);

  return (
    <ErrorBoundary>
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {(restoring || !fontsLoaded) ? (
          // Nothing renders until the fonts are in and the stored shift token
          // has been read — the first avoids the Android crash above, the
          // second stops a signed-in valet seeing the login screen flash.
          <View style={styles.center}>
            <ActivityIndicator color={colors.actionPrimary} />
          </View>
        ) : !token ? (
          <LoginScreen />
        ) : shiftChecked ? (
          <ValetFlow />
        ) : (
          <ShiftStartScreen onDone={() => setShiftChecked(true)} />
        )}
      </View>
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
