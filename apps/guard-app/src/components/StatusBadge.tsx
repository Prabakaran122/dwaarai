import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useT } from '../store/langStore';

interface StatusBadgeProps {
  status: 'allow' | 'deny' | 'guard_review';
}

const STATUS_CONFIG = {
  allow: { bg: '#22c55e', key: 'statusAllowed' },
  deny: { bg: '#ef4444', key: 'statusDenied' },
  guard_review: { bg: '#eab308', key: 'statusReview' },
} as const;

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const t = useT();

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={styles.label}>{t(config.key)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  label: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
