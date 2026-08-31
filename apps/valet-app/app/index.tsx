import React, { useEffect } from 'react';
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

/**
 * Sarthi's entry point.
 *
 * The whole app is the valet flow — there is no tab bar, because a valet does
 * one job. That is the difference between this and folding valet into the gate
 * guard's app, where it would have been a fifth tab beside Gate, Visitors,
 * Parcels and Incidents that no valet would ever use.
 */
export default function App() {
  const { token, restoring, restore } = useAuthStore();
  const rehydrateLang = useLangStore((s) => s.rehydrate);

  // Every screen styles text through font(), which returns a fontFamily of
  // 'DMSans_*'. On Android, referencing a family that was never loaded is a
  // FATAL error, not a fallback — the app dies on first render. Web silently
  // substitutes a system font, which is why this was invisible until the APK
  // was installed on a real device.
  const fontsLoaded = useAppFonts();

  useEffect(() => {
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
        ) : token ? (
          <ValetFlow />
        ) : (
          <LoginScreen />
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
