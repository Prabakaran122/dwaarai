import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { getEvents, getPasses } from '../api/client';
import { useVehicleStore } from '../store/vehicleStore';
import { useAuthStore } from '../store/authStore';

interface EntryEvent {
  id: string;
  visitorName: string;
  gate: string;
  timestamp: string;
}

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const { vehicles, fetch: fetchVehicles } = useVehicleStore();
  const [activePasses, setActivePasses] = useState(0);
  const [recentEntries, setRecentEntries] = useState<EntryEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      await fetchVehicles();
      const [passRes, eventRes] = await Promise.all([getPasses(), getEvents({ limit: '5' })]);
      const passes = passRes.data.data || [];
      setActivePasses(passes.filter((p: any) => p.status === 'active').length);
      setRecentEntries(eventRes.data.data || []);
    } catch { /* silently fail on refresh */ }
  };

  useEffect(() => { loadData(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.info} />}
      >
        <AnimatedEntry direction="fade">
          <View style={styles.greetingRow}>
            <MaterialCommunityIcons name="hand-wave" size={24} color={colors.warning} />
            <Text style={styles.greeting}>Hello, {user?.name ?? 'Resident'}</Text>
          </View>
        </AnimatedEntry>

        <View style={styles.statsRow}>
          <AnimatedEntry direction="left" delay={100}>
            <GlowCard style={styles.statCard}>
              <IconBadge icon="car" color={colors.info} gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']} size={36} />
              <Text style={styles.statNumber}>{vehicles.length}</Text>
              <Text style={styles.statLabel}>Vehicles</Text>
            </GlowCard>
          </AnimatedEntry>
          <AnimatedEntry direction="right" delay={200}>
            <GlowCard style={styles.statCard}>
              <IconBadge icon="ticket-account" color="#c084fc" gradientColors={['rgba(168,85,247,0.3)', 'rgba(236,72,153,0.1)']} size={36} />
              <Text style={styles.statNumber}>{activePasses}</Text>
              <Text style={styles.statLabel}>Active Passes</Text>
            </GlowCard>
          </AnimatedEntry>
        </View>

        <Text style={styles.sectionTitle}>Recent Entries</Text>
        {recentEntries.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="clock-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>No recent entries</Text>
          </View>
        ) : (
          recentEntries.map((e, i) => (
            <AnimatedEntry key={e.id} direction="left" delay={i * 100}>
              <GlowCard style={styles.entryCard}>
                <View style={styles.entryRow}>
                  <IconBadge icon="gate" color={colors.success} gradientColors={['rgba(34,197,94,0.3)', 'rgba(16,185,129,0.1)']} size={32} />
                  <View style={styles.entryInfo}>
                    <Text style={styles.entryName}>{e.visitorName}</Text>
                    <Text style={styles.entryGate}>{e.gate}</Text>
                  </View>
                  <Text style={styles.entryTime}>
                    {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </GlowCard>
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
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing['2xl'] },
  greeting: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing['2xl'] },
  statCard: { flex: 1, alignItems: 'center', gap: spacing.sm },
  statNumber: { fontSize: 32, fontWeight: '800', color: colors.textPrimary },
  statLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  entryCard: { marginBottom: spacing.sm },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  entryInfo: { flex: 1 },
  entryName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  entryGate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  entryTime: { fontSize: 13, color: colors.textSecondary },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['3xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
