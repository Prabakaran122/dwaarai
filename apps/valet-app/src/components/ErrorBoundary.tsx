import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { colors } from '../theme/colors';

/**
 * Catches anything thrown while rendering and puts it on the screen.
 *
 * A crash on a sideloaded APK is otherwise completely opaque: the app closes,
 * and without adb there is no way to see why. Showing the error and its stack
 * on the device turns "it crashes" into a specific, reportable fact.
 *
 * Deliberately styles nothing through the app's `font()` helper — the first
 * Sarthi crash WAS a missing font family, and a boundary that dies for the
 * same reason as the thing it is reporting is worse than useless. Everything
 * here uses system fonts and literal colours.
 */

interface State {
  error: Error | null;
  info: string | null;
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Also logged so `adb logcat` picks it up when a cable is available.
    console.error('[Sarthi] render crash:', error?.message, info?.componentStack);
    this.setState({ info: info?.componentStack ?? null });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>Sarthi hit an error</Text>
          <Text style={styles.hint}>
            Please screenshot this and send it to the team — it names the exact failure.
          </Text>

          <Text style={styles.label}>Message</Text>
          <Text style={styles.mono}>{String(error?.message || error)}</Text>

          {error?.stack ? (
            <>
              <Text style={styles.label}>Stack</Text>
              <Text style={styles.monoSmall}>{String(error.stack).slice(0, 2000)}</Text>
            </>
          ) : null}

          {info ? (
            <>
              <Text style={styles.label}>Component</Text>
              <Text style={styles.monoSmall}>{info.slice(0, 1200)}</Text>
            </>
          ) : null}

          <Pressable style={styles.retry} onPress={() => this.setState({ error: null, info: null })}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D2535' },
  scroll: { padding: 20, paddingTop: 60, gap: 8 },
  title: { color: '#F0F4F8', fontSize: 20, fontWeight: '700' },
  hint: { color: '#8BAABB', fontSize: 13, marginBottom: 12 },
  label: {
    color: '#F59E0B', fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 14,
  },
  mono: { color: '#F0F4F8', fontSize: 13, fontFamily: 'monospace' },
  monoSmall: { color: '#8BAABB', fontSize: 10, fontFamily: 'monospace' },
  retry: {
    marginTop: 24, backgroundColor: '#F59E0B', borderRadius: 8,
    paddingVertical: 14, alignItems: 'center',
  },
  retryText: { color: '#0D2535', fontSize: 15, fontWeight: '700' },
});
