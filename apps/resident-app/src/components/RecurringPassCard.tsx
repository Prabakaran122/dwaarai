import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';
import Card from './ui/Card';
import Button from './ui/Button';
import StatusBadge from './ui/StatusBadge';
import type { BadgePreset } from './ui/StatusBadge';

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
    case 'daily':   return 'Every day';
    case 'weekday': return 'Mon - Fri';
    case 'weekly':
    case 'custom':
      return days ? days.map((d) => DAY_LABELS[d]).join(', ') : type;
    default: return type;
  }
}

/** Map recurring pass status → StatusBadge preset */
function statusPreset(status: string): BadgePreset {
  switch (status) {
    case 'active':  return 'granted';
    case 'paused':  return 'pending';
    case 'expired':
    case 'cancelled':
    default:        return 'denied';
  }
}

export default function RecurringPassCard({ pass, onPause, onResume, onCancel }: Props) {
  const icon = ROLE_ICONS[pass.visitor_role || 'other'] || 'account';
  const isPaused = pass.status === 'paused';

  return (
    <Card style={styles.card}>
      {/* Header: role icon + name + status badge */}
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name={icon as any} size={20} color={colors.teal} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{pass.visitor_name}</Text>
          {pass.visitor_role && (
            <Text style={styles.role}>{pass.visitor_role}</Text>
          )}
        </View>
        <StatusBadge preset={statusPreset(pass.status)} size="sm" />
      </View>

      {/* Schedule summary */}
      <Text style={styles.schedule}>
        {scheduleLabel(pass.schedule_type, pass.schedule_days)} · {formatTime(pass.time_from)} – {formatTime(pass.time_until)}
      </Text>

      {/* Today's status */}
      {pass.today_status === 'arrived' && pass.today_arrived_at && (
        <View style={styles.statusRow}>
          <MaterialCommunityIcons name="check-circle" size={15} color={colors.success} />
          <Text style={[styles.statusText, { color: colors.textSuccess }]}>
            Arrived at {new Date(pass.today_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      )}
      {pass.today_status === 'expected' && (
        <View style={styles.statusRow}>
          <MaterialCommunityIcons name="clock-outline" size={15} color={colors.warning} />
          <Text style={[styles.statusText, { color: colors.textWarning }]}>Expected today</Text>
        </View>
      )}

      {/* Divider */}
      <View style={styles.divider} />

      {/* Actions */}
      <View style={styles.actions}>
        {isPaused ? (
          <Button
            title="Resume"
            icon="play"
            variant="primary"
            onPress={() => onResume(pass.id)}
            style={styles.actionBtn}
          />
        ) : (
          <Button
            title="Pause"
            icon="pause"
            variant="ghost"
            onPress={() => onPause(pass.id)}
            style={styles.actionBtn}
          />
        )}
        <Button
          title="Cancel"
          icon="close"
          variant="destructive"
          onPress={() => onCancel(pass.id)}
          style={styles.actionBtn}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: { flex: 1 },
  name: { ...font(500), fontSize: 15, color: colors.textPrimary },
  role: { ...font(400), fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize' },
  schedule: { ...font(400), fontSize: 13, color: colors.textSecondary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { ...font(500), fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.surfaceBorder },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1, minWidth: 0, minHeight: 40 },
});
