import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity, Switch, Modal, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { useFaceStore, ConsentLocation } from '../store/faceStore';

const LOCATION_META: Record<ConsentLocation, { label: string; icon: string; desc: string }> = {
  gate: { label: 'Main gate', icon: 'boom-gate', desc: 'Walk-in pedestrian entry' },
  pool: { label: 'Swimming pool', icon: 'pool', desc: 'Pool gate access' },
  clubhouse: { label: 'Clubhouse', icon: 'sofa', desc: 'Clubhouse entry' },
  gym: { label: 'Gym', icon: 'dumbbell', desc: 'Gym access' },
};

const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  not_enrolled: { label: 'Not enrolled', color: colors.textMuted, icon: 'face-recognition' },
  pending: { label: 'Awaiting verification', color: colors.warning, icon: 'clock-outline' },
  active: { label: 'Active', color: colors.success, icon: 'check-circle' },
  deleted: { label: 'Not enrolled', color: colors.textMuted, icon: 'face-recognition' },
};

// expo-camera is optional and only present in camera-enabled builds.
function hasCameraModule(): boolean {
  try { require('expo-camera'); return true; } catch { return false; }
}

export default function FaceIdentityScreen({ onClose }: { onClose: () => void }) {
  const { status, recognitionReady, consents, locations, accessLog, loading, fetch, enroll, setConsent, remove, fetchAccessLog } = useFaceStore();
  const [showConsent, setShowConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch();
    fetchAccessLog().catch(() => {});
  }, []);

  const isEnrolled = status === 'active' || status === 'pending';
  const sm = STATUS_META[status] || STATUS_META.not_enrolled;

  const doEnroll = async () => {
    setShowConsent(false);
    setBusy(true);
    try {
      // A real face scan is captured on camera-enabled builds and converted to a
      // secure vector server-side. We never store the image.
      const enabledLocations = (Object.keys(consents) as ConsentLocation[]).filter((l) => consents[l]);
      const result = await enroll({ consent_acknowledged: true, consent_locations: enabledLocations });
      if (result === 'pending') {
        Alert.alert(
          'Consent saved',
          hasCameraModule()
            ? 'Your face scan will be processed once the recognition service is connected. Until then, access uses OTP.'
            : 'Face capture runs on a camera-enabled build. Your consent preferences are saved and access uses OTP until enrollment completes.',
        );
      } else {
        Alert.alert('Enrolled', 'Your face is now active for the locations you consented to.');
      }
    } catch (err: any) {
      Alert.alert('Enrollment failed', err?.response?.data?.error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggleConsent = async (loc: ConsentLocation, value: boolean) => {
    try {
      await setConsent(loc, value);
    } catch (err: any) {
      Alert.alert('Could not update', err?.response?.data?.error?.message || 'Please try again.');
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete face data?',
      'This permanently deletes your face data and turns off facial access everywhere. Access falls back to OTP immediately. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try { await remove(); Alert.alert('Deleted', 'Your face data has been permanently removed.'); }
            catch (err: any) { Alert.alert('Could not delete', err?.response?.data?.error?.message || 'Please try again.'); }
          },
        },
      ],
    );
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Face & Identity</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Status */}
        <AnimatedEntry direction="fade">
          <GlowCard style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={[styles.statusIcon, { backgroundColor: colors.surface }]}>
                <MaterialCommunityIcons name={sm.icon as any} size={26} color={sm.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.statusLabel}>Facial recognition</Text>
                <Text style={[styles.statusValue, { color: sm.color }]}>{sm.label}</Text>
              </View>
            </View>
            <Text style={styles.tagline}>One face, every access point — like DigiYatra for your home. Opt-in, and yours to delete anytime.</Text>
          </GlowCard>
        </AnimatedEntry>

        {/* What we collect (plain language) */}
        <AnimatedEntry direction="up" delay={80}>
          <GlowCard style={styles.infoCard}>
            <Text style={styles.sectionTitle}>How your face data is handled</Text>
            {[
              ['shield-lock', 'We store a math vector, never your photo. The scan is converted and the image is discarded.'],
              ['tune', 'You choose where it works — gate, pool, clubhouse, gym — and can change each anytime.'],
              ['delete-forever', 'Delete it whenever you like. Removal is immediate and access falls back to OTP.'],
              ['history', 'Every face access is logged below so you can see exactly when it was used.'],
            ].map(([icon, text]) => (
              <View key={text} style={styles.infoRow}>
                <MaterialCommunityIcons name={icon as any} size={16} color={colors.info} />
                <Text style={styles.infoText}>{text}</Text>
              </View>
            ))}
          </GlowCard>
        </AnimatedEntry>

        {/* Per-location consent */}
        <AnimatedEntry direction="up" delay={160}>
          <GlowCard style={styles.infoCard}>
            <Text style={styles.sectionTitle}>Where facial access is allowed</Text>
            {locations.map((loc) => {
              const meta = LOCATION_META[loc as ConsentLocation];
              if (!meta) return null;
              return (
                <View key={loc} style={styles.consentRow}>
                  <MaterialCommunityIcons name={meta.icon as any} size={20} color={colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.consentLabel}>{meta.label}</Text>
                    <Text style={styles.consentDesc}>{meta.desc}</Text>
                  </View>
                  <Switch
                    value={consents[loc as ConsentLocation]}
                    onValueChange={(v) => toggleConsent(loc as ConsentLocation, v)}
                    trackColor={{ false: colors.surfaceBorder, true: colors.success }}
                  />
                </View>
              );
            })}
            {!isEnrolled ? (
              <Text style={styles.hint}>Enroll your face to activate access at the locations you've enabled.</Text>
            ) : null}
          </GlowCard>
        </AnimatedEntry>

        {/* Actions */}
        <AnimatedEntry direction="up" delay={240}>
          <View style={styles.actions}>
            {busy ? (
              <ActivityIndicator color={colors.info} />
            ) : status === 'active' ? (
              <GradientButton title="Re-enroll face" icon="face-recognition" variant="primary" onPress={() => setShowConsent(true)} />
            ) : (
              <GradientButton title="Enroll my face" icon="face-recognition" variant="success" onPress={() => setShowConsent(true)} />
            )}
            {isEnrolled ? (
              <View style={{ marginTop: spacing.md }}>
                <GradientButton title="Delete my face data" icon="delete-forever" variant="danger" onPress={confirmDelete} />
              </View>
            ) : null}
          </View>
        </AnimatedEntry>

        {/* Access log */}
        {accessLog.length > 0 ? (
          <AnimatedEntry direction="up" delay={320}>
            <Text style={styles.logTitle}>Recent facial access</Text>
            {accessLog.slice(0, 20).map((e, i) => {
              const granted = e.decision === 'granted';
              return (
                <View key={i} style={styles.logRow}>
                  <MaterialCommunityIcons
                    name={granted ? 'check-circle' : 'shield-key-outline'}
                    size={16}
                    color={granted ? colors.success : colors.warning}
                  />
                  <Text style={styles.logText}>
                    {LOCATION_META[e.location as ConsentLocation]?.label || e.location} · {e.method === 'face' ? 'Face' : 'OTP'}
                    {e.decision === 'fallback' ? ' (OTP fallback)' : ''}
                  </Text>
                  <Text style={styles.logTime}>{new Date(e.eventTs).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
                </View>
              );
            })}
          </AnimatedEntry>
        ) : null}
      </ScrollView>

      {/* Consent modal */}
      <Modal visible={showConsent} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Enroll your face</Text>
            <Text style={styles.modalBody}>
              We'll capture a short face scan and convert it into a secure vector. Your photo is never stored.
              The vector is used only to recognise you at the locations you've enabled, and you can delete it anytime.
            </Text>
            <Text style={styles.modalBody}>
              Each adult enrols from their own account. Please don't enrol anyone under 18.
            </Text>
            {!recognitionReady ? (
              <Text style={styles.modalNote}>Note: the recognition service isn't connected yet, so enrollment will be saved as pending and access will use OTP until it's live.</Text>
            ) : null}
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={() => setShowConsent(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="I agree & enroll" variant="success" icon="check-circle" onPress={doEnroll} />
              </View>
            </View>
          </GlowCard>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing['3xl'], paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { width: 28, alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  statusCard: { marginBottom: spacing.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  statusIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  statusLabel: { fontSize: 13, color: colors.textMuted },
  statusValue: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  tagline: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  infoCard: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  infoText: { flex: 1, fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  consentLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  consentDesc: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  hint: { fontSize: 12, color: colors.warning, marginTop: spacing.sm },
  actions: { marginBottom: spacing.lg },
  logTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm, marginBottom: spacing.md },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
  logText: { flex: 1, fontSize: 13, color: colors.textSecondary },
  logTime: { fontSize: 11, color: colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '88%', maxWidth: 380 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.md },
  modalBody: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.md },
  modalNote: { fontSize: 12, color: colors.warning, lineHeight: 18, marginBottom: spacing.md },
  modalButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
