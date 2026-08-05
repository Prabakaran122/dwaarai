import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';

export interface TimelineEntry {
  from_status: string | null;
  to_status: string | null;
  changed_by_name: string | null;
  changed_by_role: string | null;
  kind: string;
  detail: string | null;
  created_at: string;
}

const LABEL: Record<string, string> = {
  open: 'Reported',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

function line(entry: TimelineEntry): string {
  if (entry.detail) return entry.detail;
  return LABEL[entry.to_status ?? ''] ?? 'Updated';
}

// An audit record shows who someone WAS at the time, so the name and role come
// straight off the row — never re-joined against who they are now.
function actor(entry: TimelineEntry): string | null {
  if (!entry.changed_by_name) return null;
  return entry.changed_by_role
    ? `${entry.changed_by_name} · ${entry.changed_by_role}`
    : entry.changed_by_name;
}

export default function StatusTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <View style={styles.wrap}>
      {entries.map((entry, i) => {
        const who = actor(entry);
        return (
          <View key={`${entry.created_at}-${i}`} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, entry.kind === 'system' && styles.dotSystem]} />
              {i < entries.length - 1 && <View style={styles.stem} />}
            </View>
            <View style={styles.body}>
              <Text style={type.h3}>{line(entry)}</Text>
              {who && <Text style={type.micro}>{who}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  row: { flexDirection: 'row', gap: spacing.md },
  rail: { alignItems: 'center', width: 16 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary, marginTop: 4 },
  dotSystem: { backgroundColor: colors.actionPrimary },
  stem: { flex: 1, width: 2, backgroundColor: colors.surfaceBorder, marginVertical: 2 },
  body: { flex: 1, paddingBottom: spacing.lg, gap: 2 },
});
