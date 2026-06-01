import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import PlateText from './PlateText';
import type { QueueEntry } from '../store/queueStore';
import { useT } from '../store/langStore';

// Detection methods keep their technical acronyms across all languages.
const methodConfig: Record<string, { color: string; label: string; icon: string }> = {
  anpr: { color: '#3b82f6', label: 'ANPR', icon: 'camera' },
  rfid: { color: '#8b5cf6', label: 'RFID', icon: 'card-bulleted' },
  fastag: { color: '#06b6d4', label: 'FASTag', icon: 'car-wireless' },
  otp: { color: '#c084fc', label: 'OTP', icon: 'numeric' },
  manual: { color: colors.warning, label: 'Manual', icon: 'account' },
};

const decisionConfig: Record<string, { color: string; key: string }> = {
  allow: { color: colors.success, key: 'statusAllowed' },
  deny: { color: colors.danger, key: 'statusDenied' },
  guard_review: { color: colors.warning, key: 'statusReview' },
};

function getVariant(entry: QueueEntry): 'default' | 'danger' | 'success' {
  if (entry.decision === 'deny') return 'danger';
  if (entry.alertType === 'auto_paired') return 'success';
  return 'default';
}

export default function FeedItem({ entry }: { entry: QueueEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const method = methodConfig[entry.method] || methodConfig.manual;
  const decision = decisionConfig[entry.decision] || decisionConfig.deny;
  const isEntry = true;
  const t = useT();

  return (
    <GlowCard variant={getVariant(entry)} style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.time}>{time}</Text>
        <MaterialCommunityIcons
          name={isEntry ? 'arrow-down-circle' : 'arrow-up-circle'}
          size={16}
          color={isEntry ? colors.success : colors.danger}
        />
        <PlateText plate={entry.plate} size="sm" />
        <View style={[styles.pill, { backgroundColor: method.color + '20' }]}>
          <Text style={[styles.pillText, { color: method.color }]}>{method.label}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: decision.color + '20' }]}>
          <Text style={[styles.pillText, { color: decision.color }]}>{t(decision.key)}</Text>
        </View>
      </View>
      {entry.residentName ? (
        <Text style={styles.resident} numberOfLines={1}>{entry.residentName}</Text>
      ) : null}
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.xs, padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, width: 55 },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontSize: 9, fontWeight: '700' },
  resident: { fontSize: 11, color: colors.textMuted, marginTop: 2, marginLeft: 55 + spacing.sm },
});
