import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import AnimatedEntry from '../components/AnimatedEntry';
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

export default function ActivityScreen() {
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
  dateMap.forEach((events, date) => grouped.push({ date, events }));

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Filter bar */}
      <View style={styles.filterBar}>
        <View style={styles.filterRow}>
          {DATE_FILTERS.map((f) => (
            <TouchableOpacity key={f} onPress={() => setDateFilter(f)}>
              {dateFilter === f ? (
                <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.filterPill}>
                  <Text style={styles.filterTextActive}>{f}</Text>
                </LinearGradient>
              ) : (
                <View style={styles.filterPillInactive}>
                  <Text style={styles.filterText}>{f}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.filterRow}>
          {TYPE_FILTERS.map((f) => (
            <TouchableOpacity key={f} onPress={() => setTypeFilter(f)}>
              <View style={[styles.chipPill, typeFilter === f && styles.chipPillActive]}>
                <Text style={[styles.chipText, typeFilter === f && styles.chipTextActive]}>{f}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={grouped}
        keyExtractor={(item) => item.date}
        refreshing={loading}
        onRefresh={fetchEvents}
        contentContainerStyle={styles.list}
        renderItem={({ item: group }) => (
          <View>
            <Text style={styles.dateHeader}>{group.date}</Text>
            {group.events.map((e, i) => (
              <AnimatedEntry key={e.id} direction="left" delay={i * 60}>
                <ActivityItem event={e} />
              </AnimatedEntry>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No activity found</Text>
          </View>
        }
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  filterPill: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  filterPillInactive: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
  },
  filterText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  filterTextActive: { color: colors.white, fontSize: 13, fontWeight: '600' },
  chipPill: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipPillActive: { backgroundColor: colors.infoBg },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: colors.info, fontWeight: '600' },
  list: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  dateHeader: {
    fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  emptyState: { alignItems: 'center', marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
