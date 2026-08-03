import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';

interface Props {
  value: number; // 0..1
  color?: string;
}

export default function ConfidenceBar({ value, color = colors.teal }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View style={styles.row}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.label}>{pct}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  track: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.elevated, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  label: { ...font(700), fontSize: 12, color: colors.textPrimary, width: 36, textAlign: 'right' },
});
