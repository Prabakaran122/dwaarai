import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../src/theme/colors';
import { useAuthStore } from '../src/store/authStore';
import { useLangStore } from '../src/store/langStore';
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

  useEffect(() => {
    restore();
    rehydrateLang();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {restoring ? (
          // A stored shift token is read before deciding what to show, so a
          // signed-in valet never sees the login screen flash on launch.
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
