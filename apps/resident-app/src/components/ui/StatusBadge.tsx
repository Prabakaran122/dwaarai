import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { font } from '../../theme/typography';

export type BadgePreset = 'granted' | 'denied' | 'pending' | 'verified' | 'info';

const PRESETS: Record<BadgePreset, { label: string; bg: string; fg: string; accent?: string }> = {
  granted:  { label: 'Granted',  bg: colors.tintSuccess, fg: colors.textSuccess, accent: colors.success },
  denied:   { label: 'Denied',   bg: colors.tintError,   fg: colors.textError },
  pending:  { label: 'Pending',  bg: colors.tintWarning, fg: colors.textWarning },
  verified: { label: 'Verified', bg: colors.teal,        fg: colors.textInverse },
  info:     { label: 'Info',     bg: colors.tintInfo,    fg: colors.textInfo },
};

interface Props {
  preset: BadgePreset;
  label?: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ preset, label, size = 'md' }: Props) {
  const cfg = PRESETS[preset];
  const sm = size === 'sm';
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: cfg.bg },
        cfg.accent ? { borderLeftWidth: 3, borderLeftColor: cfg.accent } : null,
        sm && styles.badgeSm,
      ]}
    >
      <Text style={[styles.text, { color: cfg.fg }, sm && styles.textSm]}>{label ?? cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  badgeSm: { paddingHorizontal: 6, paddingVertical: 2 },
  text: { ...font(500), fontSize: 11 },
  textSm: { fontSize: 10 },
});
