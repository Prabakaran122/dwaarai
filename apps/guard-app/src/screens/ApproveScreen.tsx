import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, Alert, ActivityIndicator, TextInput, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../App';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import StatusPill from '../components/StatusPill';
import PlateText from '../components/PlateText';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useQueueStore } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';
import { sendGateCommand, registerVehicleAtGate } from '../api/client';

type RouteParams = RouteProp<RootStackParamList, 'Approve'>;

const methodConfig: Record<string, { icon: string; label: string; color: string }> = {
  anpr: { icon: 'camera', label: 'ANPR', color: colors.info },
  rfid: { icon: 'card-bulleted', label: 'RFID', color: colors.success },
  fastag: { icon: 'car-wireless', label: 'FASTAG', color: '#06b6d4' },
  otp: { icon: 'numeric', label: 'OTP', color: '#c084fc' },
  manual: { icon: 'account', label: 'MANUAL', color: colors.warning },
};

export default function ApproveScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { entryId } = route.params;
  const entry = useQueueStore((s) => s.entries.find((e) => e.id === entryId));
  const removeEntry = useQueueStore((s) => s.removeEntry);
  const gateId = useAuthStore((s) => s.user?.gateId ?? '');
  const [loading, setLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [regPlate, setRegPlate] = useState('');
  const [regUnit, setRegUnit] = useState('');
  const [regLoading, setRegLoading] = useState(false);

  if (!entry) {
    return (
      <LinearGradient colors={colors.gradientBg} style={styles.container}>
        <View style={styles.notFoundWrap}>
          <MaterialCommunityIcons name="car-off" size={48} color={colors.textMuted} />
          <Text style={styles.notFound}>Entry not found</Text>
        </View>
      </LinearGradient>
    );
  }

  const method = methodConfig[entry.method] || methodConfig.manual;

  const handleApproveOnce = async () => {
    setLoading(true);
    try {
      await sendGateCommand(gateId, 'open');
      removeEntry(entryId);
      navigation.goBack();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Command failed';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Command failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async () => {
    setLoading(true);
    try {
      await sendGateCommand(gateId, 'deny');
      removeEntry(entryId);
      navigation.goBack();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Command failed';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Command failed');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAndRegister = () => {
    setRegPlate(entry.plate !== 'Unknown' ? entry.plate : '');
    setShowRegister(true);
  };

  const handleRegisterSubmit = async () => {
    if (!regPlate.trim() || !regUnit.trim()) {
      Alert.alert('Error', 'Plate number and unit number are required');
      return;
    }
    setRegLoading(true);
    try {
      // Open gate first
      await sendGateCommand(gateId, 'open');
      // Register vehicle + link FASTag
      await registerVehicleAtGate({
        community_id: entry.id.split('-')[0] || '', // will use actual community_id
        plate: regPlate.trim(),
        unit_number: regUnit.trim(),
        fastag_tid_hash: entry.fastagTidHash,
      });
      removeEntry(entryId);
      setShowRegister(false);
      navigation.goBack();
      Alert.alert('Registered', `Vehicle ${regPlate} registered for Unit ${regUnit}`);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'Registration failed';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Registration failed');
    } finally {
      setRegLoading(false);
    }
  };

  const isFastagEntry = entry.method === 'fastag';

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <View style={styles.content}>
        {/* Snapshot panel */}
        <View style={styles.snapshotPanel}>
          {entry.snapshot ? (
            <Image source={{ uri: entry.snapshot }} style={styles.snapshot} resizeMode="contain" />
          ) : (
            <View style={styles.noSnapshot}>
              <MaterialCommunityIcons name="camera-off" size={48} color={colors.textMuted} />
              <Text style={styles.noSnapshotText}>No snapshot</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', colors.bgPrimary]}
            style={styles.snapshotOverlay}
          />
        </View>

        {/* Info panel */}
        <AnimatedEntry direction="up" duration={500}>
          <GlowCard variant={entry.decision === 'deny' ? 'danger' : 'warning'} style={styles.infoCard}>
            <PlateText plate={entry.plate} size="lg" />
            <View style={styles.statusRow}>
              <StatusPill status={entry.decision} />
              {entry.alertType === 'fastag_mismatch' && (
                <View style={styles.alertBadge}>
                  <MaterialCommunityIcons name="alert" size={14} color={colors.danger} />
                  <Text style={styles.alertBadgeText}>FASTag Mismatch</Text>
                </View>
              )}
            </View>

            <View style={styles.detailGrid}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>METHOD</Text>
                <View style={styles.detailValueRow}>
                  <MaterialCommunityIcons
                    name={method.icon as any}
                    size={16}
                    color={method.color}
                  />
                  <Text style={styles.detailValue}>{method.label}</Text>
                </View>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>TIME</Text>
                <View style={styles.detailValueRow}>
                  <MaterialCommunityIcons name="clock-outline" size={16} color={colors.info} />
                  <Text style={styles.detailValue}>{new Date(entry.timestamp).toLocaleTimeString()}</Text>
                </View>
              </View>
              {entry.residentName ? (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>RESIDENT</Text>
                  <Text style={styles.detailValue}>{entry.residentName}</Text>
                </View>
              ) : null}
              {entry.reason ? (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>REASON</Text>
                  <Text style={styles.detailValue}>{entry.reason}</Text>
                </View>
              ) : null}
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={colors.info} style={styles.loader} />
            ) : (
              <View style={styles.actions}>
                <View style={styles.actionBtn}>
                  <GradientButton
                    title="Approve Once"
                    icon="check-circle"
                    variant="success"
                    onPress={handleApproveOnce}
                  />
                </View>
                {isFastagEntry && (
                  <View style={styles.actionBtn}>
                    <GradientButton
                      title="Approve + Register"
                      icon="car-connected"
                      variant="primary"
                      onPress={handleApproveAndRegister}
                    />
                  </View>
                )}
                <View style={styles.actionBtn}>
                  <GradientButton
                    title="Deny"
                    icon="close-circle"
                    variant="danger"
                    onPress={handleDeny}
                  />
                </View>
              </View>
            )}
          </GlowCard>
        </AnimatedEntry>
      </View>

      {/* Register Vehicle Modal */}
      <Modal visible={showRegister} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalOverlay}>
            <GlowCard variant="default" style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <IconBadge
                  icon="car-connected"
                  color="#06b6d4"
                  gradientColors={['rgba(6,182,212,0.3)', 'rgba(20,184,166,0.1)']}
                  size={36}
                />
                <Text style={styles.modalTitle}>Register Vehicle</Text>
              </View>

              <Text style={styles.modalSubtitle}>
                Link this FASTag to a vehicle for automatic gate access
              </Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>PLATE NUMBER</Text>
                <TextInput
                  style={styles.input}
                  value={regPlate}
                  onChangeText={setRegPlate}
                  placeholder="e.g. KA05MF1234"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>UNIT NUMBER</Text>
                <TextInput
                  style={styles.input}
                  value={regUnit}
                  onChangeText={setRegUnit}
                  placeholder="e.g. 301"
                  placeholderTextColor={colors.textMuted}
                  autoCorrect={false}
                />
              </View>

              {entry.fastagTidHash ? (
                <View style={styles.fastagInfo}>
                  <MaterialCommunityIcons name="car-wireless" size={14} color="#06b6d4" />
                  <Text style={styles.fastagInfoText}>
                    FASTag: {entry.fastagTidHash.slice(0, 12)}...
                  </Text>
                </View>
              ) : null}

              {regLoading ? (
                <ActivityIndicator size="large" color={colors.info} style={styles.loader} />
              ) : (
                <View style={styles.modalActions}>
                  <View style={styles.actionBtn}>
                    <GradientButton
                      title="Register & Open Gate"
                      icon="check-circle"
                      variant="success"
                      onPress={handleRegisterSubmit}
                      disabled={!regPlate.trim() || !regUnit.trim()}
                    />
                  </View>
                  <View style={styles.actionBtn}>
                    <GradientButton
                      title="Cancel"
                      icon="close"
                      variant="danger"
                      onPress={() => setShowRegister(false)}
                    />
                  </View>
                </View>
              )}
            </GlowCard>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, flexDirection: 'row', padding: spacing.lg, gap: spacing.lg },
  snapshotPanel: { flex: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.02)', justifyContent: 'center', alignItems: 'center' },
  snapshot: { width: '90%', height: '90%', borderRadius: radius.md },
  noSnapshot: { justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  noSnapshotText: { color: colors.textMuted, fontSize: 14 },
  snapshotOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  infoCard: { width: 380 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.xl, gap: spacing.sm },
  alertBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  alertBadgeText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  detailGrid: { gap: spacing.lg, marginBottom: spacing['2xl'] },
  detailItem: { gap: spacing.xs },
  detailLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  detailValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  actionBtn: { flex: 1, minWidth: 100 },
  loader: { marginVertical: spacing['2xl'] },
  notFoundWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  notFound: { color: colors.textMuted, fontSize: 16 },
  // Modal
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)' },
  modalCard: { width: 420, maxWidth: '90%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  modalTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  modalSubtitle: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xl, lineHeight: 18 },
  inputGroup: { marginBottom: spacing.lg },
  inputLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.xs },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: colors.surfaceBorder,
    borderRadius: radius.md, padding: spacing.md,
    color: colors.textPrimary, fontSize: 16, fontWeight: '600',
    letterSpacing: 1.5, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fastagInfo: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(6,182,212,0.08)', borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.xl,
  },
  fastagInfoText: { color: '#06b6d4', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
});
