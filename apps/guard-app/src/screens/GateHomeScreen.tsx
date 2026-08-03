import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Pressable, Modal, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type, font } from '../theme/typography';
import SosButton from '../components/SosButton';
import SosBanner from '../components/SosBanner';
import HandoverCard from '../components/HandoverCard';
import LanguageSwitcher from '../components/LanguageSwitcher';
import AlertBanner from '../components/AlertBanner';
import QuickActionGrid, { QuickAction } from '../components/QuickActionGrid';
import LiveFeed from '../components/LiveFeed';
import ShiftStats from '../components/ShiftStats';
import VehicleVerificationScreen from './VehicleVerificationScreen';
import NewVehicleEntryScreen from './NewVehicleEntryScreen';
import type { QueueEntry } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';
import { useQueueStore, selectPendingEntries } from '../store/queueStore';
import { useSosStore } from '../store/sosStore';
import { useHandoverStore } from '../store/handoverStore';
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
  const submitHandover = useHandoverStore((s) => s.submit);
  const t = useT();
  const [verifying, setVerifying] = useState(false);
  const [intakeEntry, setIntakeEntry] = useState<QueueEntry | 'manual' | null>(null);
  const [showHandover, setShowHandover] = useState(false);
  const [note, setNote] = useState('');
  const [ending, setEnding] = useState(false);

  useEffect(() => { fetchActiveSos(); }, [fetchActiveSos]);

  const pending = selectPendingEntries(entries);
  const alertEntry = pending[0] ?? null;
  const isUnmatched = (e: QueueEntry) => !e.unitNumber && !e.residentName;

  if (verifying && alertEntry) {
    return <VehicleVerificationScreen entry={alertEntry} onClose={() => setVerifying(false)} />;
  }

  if (intakeEntry) {
    return (
      <NewVehicleEntryScreen
        entry={intakeEntry === 'manual' ? null : intakeEntry}
        onClose={() => setIntakeEntry(null)}
      />
    );
  }

  const openAlertEntry = () => {
    if (!alertEntry) return;
    if (isUnmatched(alertEntry)) setIntakeEntry(alertEntry);
    else setVerifying(true);
  };

  const skipLogout = () => { setShowHandover(false); logout(); };

  const endShift = async () => {
    if (note.trim()) {
      setEnding(true);
      try { await submitHandover(note.trim()); } catch { /* still log out */ }
      setEnding(false);
    }
    setShowHandover(false);
    logout();
  };

  const quickActions: QuickAction[] = [
    { key: 'visitor', label: t('quickNewVisitor'), icon: 'account-plus', onPress: () => onNavigate('visitors') },
    { key: 'vehicle', label: t('quickVehicleEntry'), icon: 'car', onPress: () => setIntakeEntry('manual') },
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
          <TouchableOpacity testID="logout-button" onPress={() => setShowHandover(true)} hitSlop={8}>
            <MaterialCommunityIcons name="logout" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <LanguageSwitcher compact />
      </View>

      <SosBanner />

      <HandoverCard />

      <AlertBanner entry={alertEntry} onPress={openAlertEntry} />

      <View style={styles.quickActions}>
        <QuickActionGrid actions={quickActions} />
      </View>

      <LiveFeed />

      <View style={styles.shiftStats}>
        <ShiftStats />
      </View>

      <Modal visible={showHandover} transparent animationType="fade" onRequestClose={() => setShowHandover(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('handoverTitle')}</Text>
            <TextInput
              testID="handover-note-input"
              style={styles.modalInput}
              placeholder={t('handoverPrompt')}
              placeholderTextColor={colors.textTertiary}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View style={styles.modalActions}>
              <Pressable testID="skip-logout-button" style={styles.modalSkipBtn} onPress={skipLogout} disabled={ending}>
                <Text style={styles.modalSkipText}>{t('skipLogout')}</Text>
              </Pressable>
              <Pressable testID="end-shift-button" style={styles.modalEndBtn} onPress={endShift} disabled={ending}>
                {ending ? <ActivityIndicator color={colors.white} /> : <Text style={styles.modalEndText}>{t('endShiftSubmit')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: 420, maxWidth: '90%', backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border },
  modalTitle: { ...font(700), fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md },
  modalInput: {
    backgroundColor: colors.elevated, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, fontSize: 14, color: colors.textPrimary, minHeight: 70, marginBottom: spacing.md,
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
  modalSkipBtn: { flex: 1, alignItems: 'center', padding: spacing.md },
  modalSkipText: { ...font(500), fontSize: 13, color: colors.danger },
  modalEndBtn: { flex: 1, alignItems: 'center', padding: spacing.md, backgroundColor: colors.teal, borderRadius: radius.md },
  modalEndText: { ...font(700), fontSize: 13, color: colors.white },
});
