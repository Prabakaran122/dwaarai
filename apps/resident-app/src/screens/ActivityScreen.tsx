import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card } from '../components/ui';
import ActivityItem, { ActivityEvent } from '../components/ActivityItem';
import { getMyUnitEvents } from '../api/client';

const DATE_FILTERS = ['Today', 'Yesterday', 'This Week'];
const TYPE_FILTERS = ['All', 'Vehicles', 'Visitors'];

function getDateRange(filter: string): { date_from?: string; date_to?: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (filter === 'Today') {
    return { date_from: `${today}T00:00:00.000Z` };
  }
  if (filter === 'Yesterday') {
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    return { date_from: `${yesterday}T00:00:00.000Z`, date_to: `${yesterday}T23:59:59.999Z` };
  }
  if (filter === 'This Week') {
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    return { date_from: `${weekAgo}T00:00:00.000Z` };
  }
  return {};
}

interface Props {
  onClose?: () => void;
}

export default function ActivityScreen({ onClose }: Props) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState('Today');
  const [typeFilter, setTypeFilter] = useState('All');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '50', ...getDateRange(dateFilter) };
      if (typeFilter === 'Vehicles') params.detection_method = 'anpr';
      if (typeFilter === 'Visitors') params.detection_method = 'otp';
      const res = await getMyUnitEvents(params);
      setEvents(res.data.data || []);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [dateFilter, typeFilter]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Group events by date
  const grouped: { date: string; events: ActivityEvent[] }[] = [];
  const dateMap = new Map<string, ActivityEvent[]>();
  events.forEach((e) => {
    const date = new Date(e.timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (!dateMap.has(date)) dateMap.set(date, []);
    dateMap.get(date)!.push(e);
  });
  dateMap.forEach((evts, date) => grouped.push({ date, events: evts }));

  return (
    <View style={styles.container}>
      <AppBar title="Gate activity" onBack={onClose} />

      <View style={styles.filterBar}>
        <View style={styles.filterRow}>
          {DATE_FILTERS.map((f) => {
            const active = dateFilter === f;
            return (
              <Pressable key={f} onPress={() => setDateFilter(f)} style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.filterRow}>
          {TYPE_FILTERS.map((f) => {
            const active = typeFilter === f;
            return (
              <Pressable key={f} onPress={() => setTypeFilter(f)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList
        data={grouped}
        keyExtractor={(item) => item.date}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchEvents} tintColor={colors.teal} />}
        contentContainerStyle={styles.list}
        renderItem={({ item: group }) => (
          <View style={styles.group}>
            <Text style={[type.caption, styles.dateHeader]}>{group.date}</Text>
            <Card>
              {group.events.map((e, i) => (
                <View key={e.id}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <ActivityItem event={e} />
                </View>
              ))}
            </Card>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Text style={type.bodySecondary}>No activity found</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  filterBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  pill: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full },
  pillActive: { backgroundColor: colors.actionPrimary },
  pillInactive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  pillText: { ...type.caption, color: colors.textSecondary },
  pillTextActive: { color: colors.textInverse },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  chipActive: { backgroundColor: colors.tintInfo, borderColor: colors.tintInfo },
  chipText: { ...type.micro, color: colors.textSecondary },
  chipTextActive: { color: colors.textInfo },
  list: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  group: { marginBottom: spacing.lg },
  dateHeader: { textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.surfaceBorder },
  emptyState: { alignItems: 'center', marginTop: spacing['5xl'] },
});
