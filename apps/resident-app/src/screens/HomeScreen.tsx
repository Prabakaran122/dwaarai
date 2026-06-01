import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import ActivityItem, { ActivityEvent } from '../components/ActivityItem';
import { getMyUnitEvents, getPasses } from '../api/client';
import { useVehicleStore } from '../store/vehicleStore';
import { useAuthStore } from '../store/authStore';
import { useDueStore } from '../store/dueStore';
import DuesScreen from './DuesScreen';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

interface Props {
  onNavigate?: (tab: string) => void;
}

export default function HomeScreen({ onNavigate }: Props) {
  const user = useAuthStore((s) => s.user);
  const { vehicles, fetch: fetchVehicles } = useVehicleStore();
  const { outstanding, fetch: fetchDues } = useDueStore();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [activePasses, setActivePasses] = useState(0);
  const [todayStats, setTodayStats] = useState({ entries: 0, visitors: 0, deliveries: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [showDues, setShowDues] = useState(false);

  const loadData = useCallback(async () => {
    try {
      await fetchVehicles();
      fetchDues().catch(() => {});
      const today = new Date().toISOString().slice(0, 10);
      const [eventRes, passRes] = await Promise.all([
        getMyUnitEvents({ limit: '5' }),
        getPasses(),
      ]);
      const eventData = eventRes.data.data || [];
      setEvents(eventData);

      const passes = Array.isArray(passRes.data.data) ? passRes.data.data : [];
      setActivePasses(passes.filter((p: any) => p.status === 'active').length);

      const todayEvents = eventData.filter((e: any) =>
        e.timestamp && e.timestamp.startsWith(today)
      );
      setTodayStats({
        entries: todayEvents.filter((e: any) => e.direction !== 'exit').length,
        visitors: passes.filter((p: any) => p.status === 'active' || p.status === 'used').length,
        deliveries: 0,
      });
    } catch { /* silently fail on refresh */ }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const firstName = user?.name?.split(' ')[0] || 'Resident';

  if (showDues) {
    return <DuesScreen onClose={() => { setShowDues(false); fetchDues().catch(() => {}); }} />;
  }

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.info} />}
      >
        {/* Header */}
        <AnimatedEntry direction="fade">
          <Text style={styles.greeting}>{getGreeting()}, {firstName}</Text>
          {user?.unitNumber && (
            <Text style={styles.unitBadge}>Unit {user.unitNumber}{user.communityName ? ` · ${user.communityName}` : ''}</Text>
          )}
        </AnimatedEntry>

        {/* Quick Actions */}
        <AnimatedEntry direction="up" delay={100}>
          <View style={styles.quickGrid}>
            <TouchableOpacity style={styles.quickMainWrap} onPress={() => onNavigate?.('visitors')} activeOpacity={0.8}>
              <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.quickMain}>
                <MaterialCommunityIcons name="share-variant" size={24} color={colors.white} />
                <Text style={styles.quickMainText}>Share Visitor Pass</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickItemWrap} onPress={() => onNavigate?.('vehicles')} activeOpacity={0.7}>
              <GlowCard style={styles.quickItem}>
                <MaterialCommunityIcons name="car" size={20} color={colors.info} />
                <Text style={styles.quickItemText}>My Vehicles</Text>
              </GlowCard>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickItemWrap} onPress={() => onNavigate?.('visitors')} activeOpacity={0.7}>
              <GlowCard style={styles.quickItem}>
                <MaterialCommunityIcons name="clock-outline" size={20} color={colors.warning} />
                <Text style={styles.quickItemText}>Expected: {activePasses}</Text>
              </GlowCard>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickItemWrap} onPress={() => onNavigate?.('activity')} activeOpacity={0.7}>
              <GlowCard style={styles.quickItem}>
                <MaterialCommunityIcons name="history" size={20} color={colors.success} />
                <Text style={styles.quickItemText}>Gate History</Text>
              </GlowCard>
            </TouchableOpacity>
          </View>
        </AnimatedEntry>

        {/* Today's Summary */}
        <AnimatedEntry direction="up" delay={200}>
          <GlowCard style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Today's Summary</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryNumber}>{todayStats.entries}</Text>
                <Text style={styles.summaryLabel}>Entries</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryNumber}>{todayStats.visitors}</Text>
                <Text style={styles.summaryLabel}>Visitors</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryNumber}>{vehicles.length}</Text>
                <Text style={styles.summaryLabel}>Vehicles</Text>
              </View>
            </View>
          </GlowCard>
        </AnimatedEntry>

        {/* Maintenance Dues */}
        <AnimatedEntry direction="up" delay={250}>
          <TouchableOpacity activeOpacity={0.85} onPress={() => setShowDues(true)}>
            <GlowCard style={StyleSheet.flatten([styles.duesCard, outstanding > 0 && styles.duesCardDue])}>
              <View style={styles.duesRow}>
                <View style={styles.duesIcon}>
                  <MaterialCommunityIcons name="credit-card-outline" size={20} color={outstanding > 0 ? colors.warning : colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.duesTitle}>Maintenance dues</Text>
                  <Text style={styles.duesSub}>
                    {outstanding > 0 ? `₹${outstanding.toLocaleString('en-IN')} outstanding` : 'No dues pending'}
                  </Text>
                </View>
                {outstanding > 0 ? (
                  <View style={styles.duesPayBtn}>
                    <Text style={styles.duesPayText}>Pay</Text>
                  </View>
                ) : (
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
                )}
              </View>
            </GlowCard>
          </TouchableOpacity>
        </AnimatedEntry>

        {/* Live Activity */}
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {events.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="clock-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>No recent activity</Text>
          </View>
        ) : (
          events.map((e, i) => (
            <AnimatedEntry key={e.id} direction="left" delay={300 + i * 80}>
              <TouchableOpacity onPress={() => onNavigate?.('activity')} activeOpacity={0.8}>
                <ActivityItem event={e} />
              </TouchableOpacity>
            </AnimatedEntry>
          ))
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  greeting: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  unitBadge: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.xl },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  quickMainWrap: { width: '100%' },
  quickMain: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    padding: spacing.lg, borderRadius: radius.lg,
  },
  quickMainText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  quickItemWrap: { flex: 1, minWidth: '45%' },
  quickItem: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  quickItemText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  summaryCard: { marginBottom: spacing.xl },
  summaryTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNumber: { fontSize: 28, fontWeight: '800', color: colors.textPrimary },
  summaryLabel: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
  summaryDivider: { width: 1, height: 32, backgroundColor: colors.surfaceBorder },
  duesCard: { marginBottom: spacing.xl },
  duesCardDue: { borderColor: colors.warningBorder, borderWidth: 1 },
  duesRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  duesIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  duesTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  duesSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  duesPayBtn: { backgroundColor: colors.warningBg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  duesPayText: { fontSize: 13, fontWeight: '700', color: colors.warning },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['3xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
