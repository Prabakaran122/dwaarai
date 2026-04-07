import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';

export interface ActivityEvent {
  id: string;
  timestamp: string;
  gate_name: string;
  method: string;
  plate: string;
  decision: string;
  direction?: string;
  resident_name?: string;
}

const methodConfig: Record<string, { color: string; label: string }> = {
  fastag: { color: '#06b6d4', label: 'FASTag' },
  anpr: { color: '#3b82f6', label: 'ANPR' },
  rfid: { color: '#8b5cf6', label: 'RFID' },
  otp: { color: '#a855f7', label: 'OTP' },
};

export default function ActivityItem({ event }: { event: ActivityEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const isEntry = event.direction !== 'exit';
  const method = methodConfig[event.method] || { color: colors.textMuted, label: event.method };

  return (
    <GlowCard style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.time}>{time}</Text>
        <MaterialCommunityIcons
          name={isEntry ? 'arrow-down-circle' : 'arrow-up-circle'}
          size={20}
          color={isEntry ? colors.success : colors.danger}
          style={styles.directionIcon}
        />
        <View style={styles.info}>
          <Text style={styles.plate} numberOfLines={1}>
            {event.plate || event.resident_name || 'Unknown'}
          </Text>
          <Text style={styles.gate}>{event.gate_name}</Text>
        </View>
        <View style={[styles.methodPill, { backgroundColor: method.color + '20' }]}>
          <Text style={[styles.methodText, { color: method.color }]}>{method.label}</Text>
        </View>
      </View>
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, width: 60 },
  directionIcon: { marginRight: 2 },
  info: { flex: 1, gap: 2 },
  plate: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  gate: { fontSize: 11, color: colors.textMuted },
  methodPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  methodText: { fontSize: 10, fontWeight: '700' },
});
