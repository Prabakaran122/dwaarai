import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type, font } from '../theme/typography';
import SosButton from '../components/SosButton';
import SosBanner from '../components/SosBanner';
import LanguageSwitcher from '../components/LanguageSwitcher';
import AlertBanner from '../components/AlertBanner';
import QuickActionGrid, { QuickAction } from '../components/QuickActionGrid';
import LiveFeed from '../components/LiveFeed';
import ShiftStats from '../components/ShiftStats';
import VehicleVerificationScreen from './VehicleVerificationScreen';
import { useAuthStore } from '../store/authStore';
import { useQueueStore, selectPendingEntries } from '../store/queueStore';
import { useSosStore } from '../store/sosStore';
import { useT } from '../store/langStore';
import type { TabKey } from '../components/TabBar';

interface Props {
  onNavigate: (tab: TabKey) => void;
}

// Gate Home (BRD §5.1, NAZ-001..010) — the guard's primary screen.
export default function GateHomeScreen({ onNavigate }: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const entries = useQueueStore((s) => s.entries);
  const fetchActiveSos = useSosStore((s) => s.fetchActive);
  const t = useT();
  const [verifying, setVerifying] = useState(false);

  useEffect(() => { fetchActiveSos(); }, [fetchActiveSos]);

  const pending = selectPendingEntries(entries);
  const alertEntry = pending[0] ?? null;

  if (verifying && alertEntry) {
    return <VehicleVerificationScreen entry={alertEntry} onClose={() => setVerifying(false)} />;
  }

  const quickActions: QuickAction[] = [
    { key: 'visitor', label: t('quickNewVisitor'), icon: 'account-plus', onPress: () => onNavigate('visitors') },
    { key: 'vehicle', label: t('quickVehicleEntry'), icon: 'car', onPress: () => onNavigate('gate') },
    { key: 'delivery', label: t('quickDelivery'), icon: 'package-variant', onPress: () => onNavigate('parcels') },
    { key: 'incident', label: t('quickIncident'), icon: 'alert-circle', onPress: () => onNavigate('incident') },
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <View style={styles.identity}>
            <Text style={type.h2}>{user?.gateName || t('mainGate')}</Text>
            <View style={styles.identityRow}>
              {!!user?.communityName && (
                <Text style={styles.community} numberOfLines={1}>{user.communityName}</Text>
              )}
              <Text style={styles.community} numberOfLines={1}>{user?.name || t('guard')}</Text>
            </View>
          </View>
          <SosButton />
          <TouchableOpacity testID="logout-button" onPress={logout} hitSlop={8}>
            <MaterialCommunityIcons name="logout" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <LanguageSwitcher compact />
      </View>

      <SosBanner />

      <AlertBanner entry={alertEntry} onPress={() => setVerifying(true)} />

      <View style={styles.quickActions}>
        <QuickActionGrid actions={quickActions} />
      </View>

      <LiveFeed />

      <View style={styles.shiftStats}>
        <ShiftStats />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  identity: { flex: 1, gap: 2 },
  identityRow: { flexDirection: 'row', gap: spacing.xs },
  community: { ...font(400), fontSize: 12, color: colors.textSecondary },
  quickActions: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  shiftStats: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
});
