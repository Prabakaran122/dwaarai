import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import PlateText from './PlateText';
import IconBadge from './IconBadge';
import AnimatedEntry from './AnimatedEntry';
import { useQueueStore, selectPendingEntries, type QueueEntry } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';
import { sendGateCommand, registerVehicleAtGate } from '../api/client';

const methodIcons: Record<string, { icon: string; color: string; gradient: readonly [string, string] }> = {
  anpr: { icon: 'camera', color: '#3b82f6', gradient: ['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)'] },
  rfid: { icon: 'card-bulleted', color: '#8b5cf6', gradient: ['rgba(139,92,246,0.3)', 'rgba(168,85,247,0.1)'] },
  fastag: { icon: 'car-wireless', color: '#06b6d4', gradient: ['rgba(6,182,212,0.3)', 'rgba(20,184,166,0.1)'] },
  otp: { icon: 'numeric', color: '#c084fc', gradient: ['rgba(168,85,247,0.3)', 'rgba(139,92,246,0.1)'] },
  manual: { icon: 'account', color: colors.warning, gradient: ['rgba(251,191,36,0.3)', 'rgba(245,158,11,0.1)'] },
};

export default function ActionZone() {
  const entries = useQueueStore((s) => s.entries);
  const removeEntry = useQueueStore((s) => s.removeEntry);
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const [showRegister, setShowRegister] = useState(false);
  const [unitNumber, setUnitNumber] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const pending = selectPendingEntries(entries);
  const current = pending[0] || null;

  const handleApprove = async () => {
    if (!current || !gateId) return;
    setActionLoading(true);
    try {
      await sendGateCommand(gateId, 'open');
      removeEntry(current.id);
    } catch {
      Alert.alert('Error', 'Failed to open gate');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeny = async () => {
    if (!current || !gateId) return;
    setActionLoading(true);
    try {
      await sendGateCommand(gateId, 'deny');
      removeEntry(current.id);
    } catch {
      Alert.alert('Error', 'Failed to send deny command');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!current || !unitNumber.trim()) return;
    setActionLoading(true);
    try {
      await registerVehicleAtGate({
        community_id: '',
        plate: current.plate,
        unit_number: unitNumber.trim(),
        fastag_tid_hash: current.fastagTidHash,
      });
      await sendGateCommand(gateId, 'open');
      removeEntry(current.id);
      setShowRegister(false);
      setUnitNumber('');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error || 'Registration failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (!current) {
    return (
      <View style={styles.container}>
        <AnimatedEntry direction="fade">
          <GlowCard variant="success" style={styles.emptyCard}>
            <MaterialCommunityIcons name="check-circle" size={48} color={colors.success} />
            <Text style={styles.emptyTitle}>All Clear</Text>
            <Text style={styles.emptySubtext}>No vehicles pending review</Text>
          </GlowCard>
        </AnimatedEntry>
      </View>
    );
  }

  const method = methodIcons[current.method] || methodIcons.manual;
  const isUnknown = !current.residentName && !current.unitNumber;
  const showRegisterButton = isUnknown && (current.method === 'fastag' || current.method === 'anpr');
  const time = new Date(current.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.container}>
      <Text style={styles.pendingCount}>{pending.length} pending</Text>

      <AnimatedEntry direction="left" duration={300}>
        <GlowCard style={styles.vehicleCard}>
          {current.decision === 'deny' && current.reason && (
            <View style={[styles.alertBanner, { backgroundColor: colors.dangerBg }]}>
              <MaterialCommunityIcons name="alert" size={16} color={colors.danger} />
              <Text style={[styles.alertText, { color: colors.danger }]}>BLACKLISTED — {current.reason}</Text>
            </View>
          )}
          {current.alertType === 'fastag_mismatch' && (
            <View style={[styles.alertBanner, { backgroundColor: colors.warningBg }]}>
              <MaterialCommunityIcons name="alert" size={16} color={colors.warning} />
              <Text style={[styles.alertText, { color: colors.warning }]}>FASTag mismatch — different tag</Text>
            </View>
          )}
          {current.alertType === 'auto_paired' && (
            <View style={[styles.alertBanner, { backgroundColor: 'rgba(6,182,212,0.15)' }]}>
              <MaterialCommunityIcons name="information" size={16} color="#06b6d4" />
              <Text style={[styles.alertText, { color: '#06b6d4' }]}>FASTag auto-paired</Text>
            </View>
          )}

          <View style={styles.vehicleRow}>
            <IconBadge icon={method.icon as any} color={method.color} gradientColors={method.gradient} size={44} />
            <View style={styles.vehicleInfo}>
              <PlateText plate={current.plate} size="lg" />
              {current.residentName && current.unitNumber && (
                <Text style={styles.residentText}>Unit {current.unitNumber} · {current.residentName}</Text>
              )}
              <Text style={styles.timeText}>{time} · {current.method.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <GradientButton title="Approve" icon="check-circle" variant="success" onPress={handleApprove} loading={actionLoading} />
            <GradientButton title="Deny" icon="close-circle" variant="danger" onPress={handleDeny} loading={actionLoading} />
            {showRegisterButton && !showRegister && (
              <GradientButton title="Approve + Register" icon="car-plus" variant="primary" onPress={() => setShowRegister(true)} />
            )}
          </View>

          {showRegister && (
            <AnimatedEntry direction="fade" duration={200}>
              <View style={styles.registerForm}>
                <Text style={styles.registerLabel}>REGISTER VEHICLE</Text>
                <TextInput
                  style={styles.registerInput}
                  placeholder="Unit number"
                  placeholderTextColor={colors.textMuted}
                  value={unitNumber}
                  onChangeText={setUnitNumber}
                />
                <View style={styles.registerActions}>
                  <View style={{ flex: 1 }}>
                    <GradientButton title="Cancel" variant="danger" onPress={() => { setShowRegister(false); setUnitNumber(''); }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GradientButton title="Register & Open" icon="check-circle" variant="success" onPress={handleRegister} loading={actionLoading} disabled={!unitNumber.trim()} />
                  </View>
                </View>
              </View>
            </AnimatedEntry>
          )}
        </GlowCard>
      </AnimatedEntry>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md },
  pendingCount: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  vehicleCard: {},
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, marginBottom: spacing.md },
  alertText: { fontSize: 12, fontWeight: '700', flex: 1 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  vehicleInfo: { flex: 1, gap: spacing.xs },
  residentText: { fontSize: 14, color: colors.textSecondary },
  timeText: { fontSize: 12, color: colors.textMuted },
  actions: { gap: spacing.sm },
  registerForm: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
  registerLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  registerInput: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.sm,
  },
  registerActions: { flexDirection: 'row', gap: spacing.sm },
  emptyCard: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing['3xl'] },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.success },
  emptySubtext: { fontSize: 13, color: colors.textMuted },
});
