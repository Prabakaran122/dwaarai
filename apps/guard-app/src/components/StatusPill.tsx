// apps/guard-app/src/components/StatusPill.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { useT } from '../store/langStore';

type Status = 'allow' | 'deny' | 'guard_review';
type Size = 'sm' | 'md';

interface StatusPillProps {
  status: Status;
  size?: Size;
}

const statusConfig: Record<Status, { key: string; color: string; bg: string }> = {
  allow: { key: 'statusAllowed', color: colors.success, bg: colors.successBg },
  deny: { key: 'statusDenied', color: colors.danger, bg: colors.dangerBg },
  guard_review: { key: 'statusReview', color: colors.warning, bg: colors.warningBg },
};

export default function StatusPill({ status, size = 'md' }: StatusPillProps) {
  const config = statusConfig[status] || statusConfig.deny;
  const isSmall = size === 'sm';
  const t = useT();

  return (
    <View style={[styles.pill, { backgroundColor: config.bg }, isSmall && styles.pillSm]}>
      <Text style={[styles.text, { color: config.color }, isSmall && styles.textSm]}>
        {t(config.key)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  pillSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textSm: {
    fontSize: 10,
  },
});
