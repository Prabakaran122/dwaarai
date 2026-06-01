import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, TouchableOpacity } from 'react-native';
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
import { sendGateCommand, registerVehicleAtGate, createApproval, verifyDriver } from '../api/client';
import { useApprovalStore } from '../store/approvalStore';
import { useT } from '../store/langStore';
import * as ImagePicker from 'expo-image-picker';
import ApprovalWaiting from './ApprovalWaiting';

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
  const [showNotify, setShowNotify] = useState(false);
  const [notifyName, setNotifyName] = useState('');
  const [notifyUnit, setNotifyUnit] = useState('');
  const [notifyLoading, setNotifyLoading] = useState(false);
  const addApproval = useApprovalStore((s) => s.addApproval);
  const approvals = useApprovalStore((s) => s.approvals);
  const [showApproval, setShowApproval] = useState(false);
  const [driverCheck, setDriverCheck] = useState<{ entryId: string; status: string; name?: string | null } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const t = useT();

  const handleVerifyDriver = async (entry: QueueEntry) => {
    setVerifying(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setVerifying(false); return; }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true, allowsEditing: false });
      if (shot.canceled || !shot.assets?.[0]?.base64) { setVerifying(false); return; }
      const res = await verifyDriver({
        plate: entry.plate !== 'Unknown' ? entry.plate : undefined,
        unit_number: entry.unitNumber,
        scan_b64: shot.assets[0].base64,
      });
      const data = res.data.data;
      setDriverCheck({ entryId: entry.id, status: data.status, name: data.resident_name });
    } catch (err: any) {
      setDriverCheck({ entryId: entry.id, status: 'unavailable' });
    } finally {
      setVerifying(false);
    }
  };

  const pending = selectPendingEntries(entries);
  const current = pending[0] || null;

  const handleApprove = async () => {
    if (!current || !gateId) return;
    setActionLoading(true);
    try {
      await sendGateCommand(gateId, 'open');
      removeEntry(current.id);
    } catch {
      Alert.alert(t('error'), t('failOpenGate'));
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
      Alert.alert(t('error'), t('failDeny'));
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
      Alert.alert(t('error'), err?.response?.data?.error || t('failRegister'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestApproval = async () => {
    if (!notifyName.trim() || !notifyUnit.trim() || !gateId) return;
    setNotifyLoading(true);
    try {
      const res = await createApproval({
        visitor_name: notifyName.trim(),
        unit_number: notifyUnit.trim(),
        vehicle_plate: current?.plate !== 'Unknown' ? current?.plate : undefined,
        gate_id: gateId,
      });
      const data = res.data.data;
      addApproval({
        id: data.id,
        visitor_name: notifyName.trim(),
        unit_number: notifyUnit.trim(),
        gate_name: 'Gate',
        vehicle_plate: current?.plate !== 'Unknown' ? current?.plate || null : null,
        expires_at: data.expires_at,
        status: 'pending',
        responded_by_name: null,
        residents_notified: data.residents_notified,
      });
      setShowApproval(true);
      setShowNotify(false);
      setNotifyName('');
      setNotifyUnit('');
    } catch (err: any) {
      Alert.alert(t('error'), err?.response?.data?.error?.message || t('failApproval'));
    } finally {
      setNotifyLoading(false);
    }
  };

  if (!current) {
    return (
      <View style={styles.container}>
        <AnimatedEntry direction="fade">
          <GlowCard variant="success" style={styles.emptyCard}>
            <MaterialCommunityIcons name="check-circle" size={48} color={colors.success} />
            <Text style={styles.emptyTitle}>{t('allClear')}</Text>
            <Text style={styles.emptySubtext}>{t('noVehiclesPending')}</Text>
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
              <Text style={[styles.alertText, { color: '#06b6d4' }]}>{t('fastagAutoPaired')}</Text>
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

          {/* Driver facial verification — only for recognized resident vehicles; non-blocking */}
          {current.residentName && current.unitNumber && (
            <View style={styles.driverBlock}>
              {driverCheck && driverCheck.entryId === current.id ? (
                <View style={[
                  styles.driverBanner,
                  { backgroundColor: driverCheck.status === 'confirmed' ? colors.successBg : driverCheck.status === 'flagged' ? colors.warningBg : colors.surface },
                ]}>
                  <MaterialCommunityIcons
                    name={driverCheck.status === 'confirmed' ? 'face-recognition' : driverCheck.status === 'flagged' ? 'account-alert' : 'face-recognition'}
                    size={16}
                    color={driverCheck.status === 'confirmed' ? colors.success : driverCheck.status === 'flagged' ? colors.warning : colors.textMuted}
                  />
                  <Text style={[
                    styles.driverText,
                    { color: driverCheck.status === 'confirmed' ? colors.success : driverCheck.status === 'flagged' ? colors.warning : colors.textMuted },
                  ]}>
                    {driverCheck.status === 'confirmed' ? `${t('driverConfirmed')}${driverCheck.name ? ` · ${driverCheck.name}` : ''}` : driverCheck.status === 'flagged' ? t('driverFlagged') : t('faceCheckUnavailable')}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.driverBtn} onPress={() => handleVerifyDriver(current)} disabled={verifying} activeOpacity={0.8}>
                  <MaterialCommunityIcons name="face-recognition" size={16} color={colors.info} />
                  <Text style={styles.driverBtnText}>{verifying ? t('verifyingDriver') : t('verifyDriver')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.actions}>
            <GradientButton title={t('approve')} icon="check-circle" variant="success" onPress={handleApprove} loading={actionLoading} />
            <GradientButton title={t('deny')} icon="close-circle" variant="danger" onPress={handleDeny} loading={actionLoading} />
            {showRegisterButton && !showRegister && (
              <GradientButton title={t('approveRegister')} icon="plus-circle" variant="primary" onPress={() => setShowRegister(true)} />
            )}
          </View>

          {/* Notify Resident */}
          {!showRegister && !showNotify && (
            <GradientButton title={t('requestApproval')} icon="bell-ring" variant="primary" onPress={() => setShowNotify(true)} />
          )}

          {showNotify && (
            <AnimatedEntry direction="fade" duration={200}>
              <View style={styles.registerForm}>
                <Text style={styles.registerLabel}>{t('requestApprovalTitle')}</Text>
                <TextInput
                  style={styles.registerInput}
                  placeholder={t('visitorName')}
                  placeholderTextColor={colors.textMuted}
                  value={notifyName}
                  onChangeText={setNotifyName}
                />
                <TextInput
                  style={styles.registerInput}
                  placeholder={t('unitNumber')}
                  placeholderTextColor={colors.textMuted}
                  value={notifyUnit}
                  onChangeText={setNotifyUnit}
                />
                <View style={styles.registerActions}>
                  <View style={{ flex: 1 }}>
                    <GradientButton title={t('cancel')} variant="danger" onPress={() => { setShowNotify(false); setNotifyName(''); setNotifyUnit(''); }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GradientButton title={t('send')} icon="bell-ring" variant="success" onPress={handleRequestApproval} loading={notifyLoading} disabled={!notifyName.trim() || !notifyUnit.trim()} />
                  </View>
                </View>
              </View>
            </AnimatedEntry>
          )}

          {showApproval && approvals.length > 0 && (
            <ApprovalWaiting onDismiss={() => setShowApproval(false)} gateId={gateId} />
          )}

          {showRegister && (
            <AnimatedEntry direction="fade" duration={200}>
              <View style={styles.registerForm}>
                <Text style={styles.registerLabel}>{t('registerVehicle')}</Text>
                <TextInput
                  style={styles.registerInput}
                  placeholder={t('unitNumber')}
                  placeholderTextColor={colors.textMuted}
                  value={unitNumber}
                  onChangeText={setUnitNumber}
                />
                <View style={styles.registerActions}>
                  <View style={{ flex: 1 }}>
                    <GradientButton title={t('cancel')} variant="danger" onPress={() => { setShowRegister(false); setUnitNumber(''); }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GradientButton title={t('registerOpen')} icon="check-circle" variant="success" onPress={handleRegister} loading={actionLoading} disabled={!unitNumber.trim()} />
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
  driverBlock: { marginBottom: spacing.sm },
  driverBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm },
  driverText: { fontSize: 13, fontWeight: '700', flex: 1 },
  driverBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
  },
  driverBtnText: { fontSize: 13, fontWeight: '700', color: colors.info },
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
