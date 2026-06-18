import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { StatusBadge } from './ui';
import type { BadgePreset } from './ui';
import PlateText from './PlateText';

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

const DECISION_PRESET: Record<string, BadgePreset> = {
  allow: 'granted',
  deny: 'denied',
  guard_review: 'pending',
};

const METHOD_LABEL: Record<string, string> = {
  fastag: 'FASTag',
  anpr: 'ANPR',
  rfid: 'RFID',
  otp: 'OTP',
};

export default function ActivityItem({ event }: { event: ActivityEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isEntry = event.direction !== 'exit';
  const preset = DECISION_PRESET[event.decision] ?? 'info';
  const method = METHOD_LABEL[event.method] ?? event.method;

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        {event.plate ? (
          <PlateText plate={event.plate} size="sm" />
        ) : (
          <Text style={type.body}>{event.resident_name || 'Gate event'}</Text>
        )}
        <Text style={type.micro}>
          {isEntry ? 'Entered' : 'Exited'} · {method} · {event.gate_name} · {time}
        </Text>
      </View>
      <StatusBadge preset={preset} size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, gap: spacing.sm },
  left: { gap: 4, flex: 1 },
});
