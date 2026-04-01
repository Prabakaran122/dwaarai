import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import StatusPill from '../components/StatusPill';
import PlateText from '../components/PlateText';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useQueueStore, type QueueEntry } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';

type NavProp = NativeStackNavigationProp<RootStackParamList, 'Queue'>;

const methodIcons: Record<string, { icon: string; color: string; gradient: readonly [string, string] }> = {
  anpr: { icon: 'camera', color: colors.info, gradient: ['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)'] },
  rfid: { icon: 'card-bulleted', color: colors.success, gradient: ['rgba(34,197,94,0.3)', 'rgba(16,185,129,0.1)'] },
  manual: { icon: 'account', color: colors.warning, gradient: ['rgba(251,191,36,0.3)', 'rgba(245,158,11,0.1)'] },
  otp: { icon: 'numeric', color: '#c084fc', gradient: ['rgba(168,85,247,0.3)', 'rgba(139,92,246,0.1)'] },
};

function VehicleItem({ entry, onPress, index }: { entry: QueueEntry; onPress: (e: QueueEntry) => void; index: number }) {
  const method = methodIcons[entry.method] || methodIcons.manual;
  const variant = entry.decision === 'guard_review' ? 'warning' : entry.decision === 'deny' ? 'danger' : 'success';

  return (
    <AnimatedEntry direction="left" delay={index * 100}>
      <GlowCard variant={variant} style={styles.vehicleCard}>
        <View style={styles.vehicleRow} onTouchEnd={() => onPress(entry)}>
          <IconBadge
            icon={method.icon as any}
            color={method.color}
            gradientColors={method.gradient}
            size={40}
          />
          <View style={styles.vehicleInfo}>
            <PlateText plate={entry.plate} size="md" />
            <Text style={styles.vehicleDetail}>
              {entry.method.toUpperCase()} &bull; {new Date(entry.timestamp).toLocaleTimeString()}
            </Text>
          </View>
          <StatusPill status={entry.decision} />
        </View>
      </GlowCard>
    </AnimatedEntry>
  );
}

function RecentItem({ entry, index }: { entry: QueueEntry; index: number }) {
  return (
    <AnimatedEntry direction="right" delay={index * 80}>
      <View style={styles.recentRow}>
        <View style={[styles.recentDot, {
          backgroundColor: entry.decision === 'allow' ? colors.success
            : entry.decision === 'deny' ? colors.danger : colors.warning,
        }]} />
        <PlateText plate={entry.plate} size="sm" />
        <Text style={styles.recentTime}>
          {new Date(entry.timestamp).toLocaleTimeString()}
        </Text>
        <StatusPill status={entry.decision} size="sm" />
      </View>
    </AnimatedEntry>
  );
}

export default function QueueScreen() {
  const navigation = useNavigation<NavProp>();
  const entries = useQueueStore((s) => s.entries);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  const pendingEntries = entries.filter((e) => e.decision === 'guard_review');
  const recentEntries = entries.filter((e) => e.decision !== 'guard_review');
  const deniedCount = entries.filter((e) => e.decision === 'deny').length;

  const handleCardPress = useCallback(
    (entry: QueueEntry) => navigation.navigate('Approve', { entryId: entry.id }),
    [navigation],
  );

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['rgba(99,102,241,0.15)', 'rgba(168,85,247,0.05)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons name="gate" size={22} color={colors.info} />
          <Text style={styles.headerGate}>{user?.gateId ? 'Main Gate' : 'Gate'}</Text>
        </View>
        <Text style={styles.headerTitle}>Vehicle Queue</Text>
        <View style={styles.headerRight}>
          <Text style={styles.headerUser}>{user?.name || 'Guard'}</Text>
          <MaterialCommunityIcons
            name="logout"
            size={20}
            color={colors.danger}
            onPress={logout}
            style={styles.logoutIcon}
          />
        </View>
      </LinearGradient>

      {/* Body — split panels */}
      <View style={styles.body}>
        {/* Left — Pending */}
        <View style={styles.panelLeft}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Pending Review</Text>
            <View style={styles.countBadge}>
              <LinearGradient colors={colors.gradientWarning as [string, string]} style={styles.countGradient}>
                <Text style={styles.countText}>{pendingEntries.length}</Text>
              </LinearGradient>
            </View>
          </View>
          {pendingEntries.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="gate" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>All clear — no vehicles pending</Text>
            </View>
          ) : (
            <FlatList
              data={pendingEntries}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) => (
                <VehicleItem entry={item} onPress={handleCardPress} index={index} />
              )}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        {/* Right — Recent */}
        <View style={styles.panelRight}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent</Text>
            <Text style={styles.sectionCount}>{recentEntries.length}</Text>
          </View>
          {recentEntries.length === 0 ? (
            <Text style={styles.emptyTextSmall}>No recent entries</Text>
          ) : (
            <FlatList
              data={recentEntries}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) => <RecentItem entry={item} index={index} />}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>

      {/* Bottom stats + nav */}
      <View style={styles.bottomBar}>
        <View style={styles.stats}>
          <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.statCard}>
            <Text style={styles.statLabel}>PENDING</Text>
            <Text style={styles.statValue}>{pendingEntries.length}</Text>
          </LinearGradient>
          <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.statCard}>
            <Text style={styles.statLabel}>TODAY</Text>
            <Text style={styles.statValue}>{entries.length}</Text>
          </LinearGradient>
          <LinearGradient colors={colors.gradientDanger as [string, string]} style={styles.statCard}>
            <Text style={styles.statLabel}>DENIED</Text>
            <Text style={styles.statValue}>{deniedCount}</Text>
          </LinearGradient>
        </View>
        <View style={styles.navButtons}>
          <GradientButton title="Verify OTP" icon="numeric" onPress={() => navigation.navigate('OTPVerify')} />
          <View style={styles.navGap} />
          <GradientButton title="Log Incident" icon="alert" variant="danger" onPress={() => navigation.navigate('Incidents')} />
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerGate: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerUser: { color: colors.textMuted, fontSize: 13 },
  logoutIcon: { padding: spacing.xs },
  body: { flex: 1, flexDirection: 'row', padding: spacing.lg, gap: spacing.lg },
  panelLeft: { flex: 0.6 },
  panelRight: { flex: 0.4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, gap: spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  sectionCount: { color: colors.textMuted, fontSize: 14 },
  countBadge: { overflow: 'hidden', borderRadius: radius.pill },
  countGradient: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: radius.pill },
  countText: { color: colors.bgPrimary, fontSize: 12, fontWeight: '800' },
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleInfo: { flex: 1, gap: spacing.xs },
  vehicleDetail: { color: colors.textMuted, fontSize: 12, letterSpacing: 0.5 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  recentDot: { width: 6, height: 6, borderRadius: 3 },
  recentTime: { color: colors.textMuted, fontSize: 11, marginLeft: 'auto', marginRight: spacing.sm },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  emptyTextSmall: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: spacing['3xl'] },
  listContent: { paddingBottom: spacing.lg },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    gap: spacing.lg,
  },
  stats: { flexDirection: 'row', gap: spacing.sm },
  statCard: { borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center', minWidth: 80 },
  statLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  statValue: { color: colors.white, fontSize: 22, fontWeight: '800' },
  navButtons: { flex: 1, flexDirection: 'row' },
  navGap: { width: spacing.sm },
});
