import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, Easing } from 'react-native';
import { colors } from '../theme/colors';

/**
 * The live indicator on the gate card (Home BRD §3.4, P0):
 * "Pulsing green dot confirming data freshness".
 *
 * The point is the *confirming* — a dot that is always on says nothing about
 * whether what is on screen is current. So it pulses only while the data is
 * actually fresh, and goes flat and grey once it is not, which is exactly when
 * a resident should stop trusting the counts above it.
 */

const STALE_AFTER_MS = 90_000;

export default function LiveDot({
  updatedAt, staleAfterMs = STALE_AFTER_MS, testID = 'live-dot',
}: {
  /** When the data behind this card last arrived. Null means never loaded. */
  updatedAt: number | null;
  staleAfterMs?: number;
  testID?: string;
}) {
  const isLive = updatedAt !== null && Date.now() - updatedAt < staleAfterMs;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isLive) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        // JS driver deliberately. The native driver is the usual advice, but
        // for one 8px dot the difference is unmeasurable, and the JS driver
        // works under Jest and on react-native-web where the native animated
        // module is absent — so this indicator behaves the same everywhere.
        Animated.timing(pulse, { toValue: 0.35, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isLive, pulse]);

  // Not animated when stale: a grey, still dot is the honest rendering of
  // "this may be out of date".
  if (!isLive) {
    return <View testID={`${testID}-stale`} style={[styles.dot, styles.stale]} />;
  }

  return (
    <Animated.View
      testID={testID}
      accessibilityLabel="Live"
      style={[styles.dot, styles.live, { opacity: pulse }]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  live: { backgroundColor: colors.teal },
  stale: { backgroundColor: colors.textTertiary },
});
