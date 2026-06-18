import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type, font } from '../theme/typography';
import { AppBar, SectionHeader, Card } from '../components/ui';
import GateGlanceCard from '../components/GateGlanceCard';
import QuickActionGrid, { QuickAction } from '../components/QuickActionGrid';
import GateActivityRow from '../components/GateActivityRow';
import DuesSnapshotCard from '../components/DuesSnapshotCard';
import CommunityStrip from '../components/CommunityStrip';
import { useHomeStore } from '../store/homeStore';
import { useAuthStore } from '../store/authStore';
import ParcelsScreen from './ParcelsScreen';
import DuesScreen from './DuesScreen';
import VisitorsScreen from './VisitorsScreen';
import ActivityScreen from './ActivityScreen';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

type Overlay = 'parcels' | 'dues' | 'visitors' | 'activity' | null;

interface Props {
  onNavigate?: (tab: 'home' | 'myunit' | 'community' | 'events' | 'profile') => void;
}

export default function HomeScreen({ onNavigate }: Props) {
  const user = useAuthStore((s) => s.user);
  const { summary, error, fetch } = useHomeStore();
  const [refreshing, setRefreshing] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);

  const load = useCallback(async () => { await fetch(); }, [fetch]);
  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (overlay === 'parcels') return <ParcelsScreen onBack={() => { setOverlay(null); load(); }} />;
  if (overlay === 'dues') return <DuesScreen onClose={() => { setOverlay(null); load(); }} />;
  if (overlay === 'visitors') return <VisitorsScreen onClose={() => { setOverlay(null); load(); }} />;
  if (overlay === 'activity') return <ActivityScreen onClose={() => { setOverlay(null); load(); }} />;

  const firstName = user?.name?.split(' ')[0] || 'Resident';
  const glance = summary?.gateGlance ?? {
    visitors: { expected: 0 }, parcels: { pending: 0 }, helpers: { expected: 0, arrived: 0 },
  };
  const activity = summary?.recentActivity ?? [];
  const dues = summary?.dues ?? { outstanding: 0, earliestDueDate: null, pendingCount: 0 };
  const community = summary?.community ?? { pinnedNotice: null, upcomingEvent: null };

  const quickActions: QuickAction[] = [
    { key: 'invite', label: 'Invite Visitor', sub: 'One-time pass', icon: 'account-plus', onPress: () => setOverlay('visitors') },
    { key: 'preapprove', label: 'Pre-approve', sub: 'Silent entry', icon: 'shield-check', onPress: () => setOverlay('visitors') },
    { key: 'facility', label: 'Book facility', sub: 'Courts & halls', icon: 'calendar-check', onPress: () => onNavigate?.('myunit') },
    { key: 'myunit', label: 'My Unit', sub: 'Members & vehicles', icon: 'home-city', onPress: () => onNavigate?.('myunit') },
    { key: 'ticket', label: 'Raise ticket', sub: 'Report an issue', icon: 'alert-circle-outline', onPress: () => onNavigate?.('community') },
    { key: 'announce', label: 'Announcements', sub: 'Notices', icon: 'bullhorn', onPress: () => onNavigate?.('community') },
  ];

  return (
    <View style={styles.container}>
      <AppBar title={user?.communityName || 'Home'} bellCount={0} onBell={() => onNavigate?.('community')} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        <Text style={type.h2}>{getGreeting()}, {firstName}</Text>
        {user?.unitNumber ? (
          <Text style={[type.bodySecondary, styles.unit]}>Unit {user.unitNumber}{user.communityName ? ` · ${user.communityName}` : ''}</Text>
        ) : null}

        <GateGlanceCard glance={glance} latest={activity[0] ?? null} onParcels={() => setOverlay('parcels')} />

        <View style={styles.block}>
          <QuickActionGrid actions={quickActions} />
        </View>

        <View style={styles.block}>
          <SectionHeader title="Recent at the gate" actionLabel="See all" onAction={() => setOverlay('activity')} />
          {activity.length === 0 ? (
            <Card><Text style={type.bodySecondary}>{error ? 'Could not load activity. Pull to refresh.' : 'No recent activity'}</Text></Card>
          ) : (
            <Card>
              {activity.map((e) => <GateActivityRow key={e.id} event={e} />)}
            </Card>
          )}
        </View>

        <View style={styles.block}>
          <DuesSnapshotCard outstanding={dues.outstanding} earliestDueDate={dues.earliestDueDate} onPress={() => setOverlay('dues')} />
        </View>

        <View style={styles.block}>
          <CommunityStrip pinnedNotice={community.pinnedNotice} upcomingEvent={community.upcomingEvent} onNotice={() => onNavigate?.('community')} />
        </View>

        <Text style={styles.tagline}>Open the right door</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['3xl'], gap: spacing.sm },
  unit: { marginBottom: spacing.md },
  block: { marginTop: spacing.md },
  tagline: { ...font(400), fontSize: 12, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xl },
});
