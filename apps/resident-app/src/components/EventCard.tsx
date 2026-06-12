import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { Card, StatusBadge } from './ui';

export interface EventItem {
  id: string; title: string; description: string | null; location: string | null;
  category: string; startsAt: string; endsAt: string | null; authorName: string | null;
  goingCount: number; myRsvp: string | null;
}
const RSVPS: { key: 'going' | 'maybe' | 'no'; label: string }[] = [
  { key: 'going', label: 'Going' }, { key: 'maybe', label: 'Maybe' }, { key: 'no', label: 'No' },
];
function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export default function EventCard({ event, onRsvp }: { event: EventItem; onRsvp: (id: string, status: 'going' | 'maybe' | 'no') => void }) {
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={[type.h3, styles.flex]} numberOfLines={2}>{event.title}</Text>
        <StatusBadge preset="info" label={event.category} size="sm" />
      </View>
      <Text style={type.micro}>{fmt(event.startsAt)}{event.location ? ` · ${event.location}` : ''}</Text>
      {!!event.description && <Text style={type.bodySecondary} numberOfLines={3}>{event.description}</Text>}
      <Text style={type.micro}>{event.goingCount} going</Text>
      <View style={styles.rsvpRow}>
        {RSVPS.map((r) => {
          const on = event.myRsvp === r.key;
          return <Text key={r.key} onPress={() => onRsvp(event.id, r.key)} style={[styles.rsvp, on && styles.rsvpOn]}>{r.label}</Text>;
        })}
      </View>
    </Card>
  );
}
const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  rsvpRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  rsvp: { ...font(500), fontSize: 12, color: colors.textSecondary, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden' },
  rsvpOn: { backgroundColor: colors.teal, color: colors.textInverse, borderColor: colors.teal },
});
