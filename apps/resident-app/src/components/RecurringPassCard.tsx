import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';

export interface RecurringPassData {
  id: string;
  visitor_name: string;
  visitor_role: string | null;
  schedule_type: string;
  schedule_days: number[] | null;
  time_from: string;
  time_until: string;
  status: string;
  today_status: string | null;
  today_arrived_at: string | null;
  today_photo_url: string | null;
}

interface Props {
  pass: RecurringPassData;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ROLE_ICONS: Record<string, string> = {
  maid: 'broom',
  cook: 'chef-hat',
  driver: 'car',
  tutor: 'book-open-variant',
  newspaper: 'newspaper',
  other: 'account',
};

function formatTime(time: string) {
  const [h, m] = time.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function scheduleLabel(type: string, days: number[] | null) {
  switch (type) {
    case 'daily': return 'Every day';
    case 'weekday': return 'Mon - Fri';
    case 'weekly':
    case 'custom':
      return days ? days.map((d) => DAY_LABELS[d]).join(', ') : type;
    default: return type;
  }
}

export default function RecurringPassCard({ pass, onPause, onResume, onCancel }: Props) {
  const icon = ROLE_ICONS[pass.visitor_role || 'other'] || 'account';
  const isPaused = pass.status === 'paused';

  return (
    <GlowCard style={styles.card}>
      <View style={styles.header}>
        <MaterialCommunityIcons name={icon as any} size={22} color={colors.info} />
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{pass.visitor_name}</Text>
          {pass.visitor_role && (
            <Text style={styles.role}>{pass.visitor_role}</Text>
          )}
        </View>
        {isPaused && (
          <View style={styles.pausedBadge}>
            <Text style={styles.pausedText}>PAUSED</Text>
          </View>
        )}
      </View>

      <Text style={styles.schedule}>
        {scheduleLabel(pass.schedule_type, pass.schedule_days)} · {formatTime(pass.time_from)} - {formatTime(pass.time_until)}
      </Text>

      {/* Today's status */}
      {pass.today_status === 'arrived' && pass.today_arrived_at && (
        <View style={styles.arrivedRow}>
          <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
          <Text style={styles.arrivedText}>
            Arrived at {new Date(pass.today_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      )}
      {pass.today_status === 'expected' && (
        <View style={styles.arrivedRow}>
          <MaterialCommunityIcons name="clock-outline" size={16} color={colors.warning} />
          <Text style={[styles.arrivedText, { color: colors.warning }]}>Expected today</Text>
        </View>
      )}

      <View style={styles.actions}>
        {isPaused ? (
          <GradientButton title="Resume" icon="play" variant="success" onPress={() => onResume(pass.id)} />
        ) : (
          <GradientButton title="Pause" icon="pause" variant="primary" onPress={() => onPause(pass.id)} />
        )}
        <GradientButton title="Cancel" icon="close" variant="danger" onPress={() => onCancel(pass.id)} />
      </View>
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerInfo: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  role: { fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize' },
  pausedBadge: { backgroundColor: colors.warningBg, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  pausedText: { fontSize: 10, fontWeight: '700', color: colors.warning },
  schedule: { fontSize: 13, color: colors.textMuted },
  arrivedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  arrivedText: { fontSize: 13, color: colors.success, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
