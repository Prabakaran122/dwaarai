import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { StatusBadge } from './ui';
import type { BadgePreset } from './ui';
import PlateText from './PlateText';
import type { ActivityEvent } from '../store/homeStore';

const DECISION_PRESET: Record<string, BadgePreset> = {
  allow: 'granted',
  deny: 'denied',
  guard_review: 'pending',
};

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function GateActivityRow({ event }: { event: ActivityEvent }) {
  const preset = DECISION_PRESET[event.decision] ?? 'info';
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        {event.plate ? (
          <PlateText plate={event.plate} size="sm" />
        ) : (
          <Text style={type.body}>{event.residentName || 'Gate event'}</Text>
        )}
        <Text style={type.micro}>
          {event.direction === 'exit' ? 'Exited' : 'Entered'} · {event.method} · {relativeTime(event.ts)}
        </Text>
      </View>
      <StatusBadge preset={preset} size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, gap: spacing.sm },
  left: { gap: 2, flex: 1 },
});
