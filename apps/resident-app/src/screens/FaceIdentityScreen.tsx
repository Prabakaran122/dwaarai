import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Switch, Modal, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button, SectionHeader } from '../components/ui';
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
    <View style={styles.container}>
      <AppBar title="Face ID & consent" onBack={onClose} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Enrollment status */}
        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={[styles.statusIcon, { backgroundColor: colors.mist }]}>
              <MaterialCommunityIcons name={sm.icon as any} size={26} color={sm.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusLabel}>Facial recognition</Text>
              <Text style={[styles.statusValue, { color: sm.color }]}>{sm.label}</Text>
            </View>
          </View>
          <Text style={styles.tagline}>One face, every access point — like DigiYatra for your home. Opt-in, and yours to delete anytime.</Text>
        </Card>

        {/* DPDP info / how your face data is handled */}
        <Card style={styles.infoCard}>
          <SectionHeader title="How your face data is handled" />
          {[
            ['shield-lock', 'We store a math vector, never your photo. The scan is converted and the image is discarded.'],
            ['tune', 'You choose where it works — gate, pool, clubhouse, gym — and can change each anytime.'],
            ['delete-forever', 'Delete it whenever you like. Removal is immediate and access falls back to OTP.'],
            ['history', 'Every face access is logged below so you can see exactly when it was used.'],
          ].map(([icon, text]) => (
            <View key={text as string} style={styles.infoRow}>
              <MaterialCommunityIcons name={icon as any} size={16} color={colors.info} />
              <Text style={styles.infoText}>{text}</Text>
            </View>
          ))}
        </Card>

        {/* Per-location consent toggles */}
        <Card style={styles.infoCard}>
          <SectionHeader title="Where facial access is allowed" />
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
                  thumbColor={colors.white}
                />
              </View>
            );
          })}
          {!isEnrolled ? (
            <Text style={styles.hint}>Enroll your face to activate access at the locations you've enabled.</Text>
          ) : null}
        </Card>

        {/* Enroll / re-enroll + delete actions */}
        <View style={styles.actions}>
          {busy ? (
            <ActivityIndicator color={colors.info} />
          ) : status === 'active' ? (
            <Button title="Re-enroll face" icon="face-recognition" variant="primary" onPress={() => setShowConsent(true)} />
          ) : (
            <Button title="Enroll my face" icon="face-recognition" variant="primary" onPress={() => setShowConsent(true)} />
          )}
          {isEnrolled ? (
            <View style={{ marginTop: spacing.md }}>
              <Button title="Delete my face data" icon="delete-forever" variant="destructive" onPress={confirmDelete} />
            </View>
          ) : null}
        </View>

        {/* Access log */}
        {accessLog.length > 0 ? (
          <>
            <SectionHeader title="Recent facial access" />
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
          </>
        ) : null}
      </ScrollView>

      {/* Consent / enroll modal */}
      <Modal visible={showConsent} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
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
                <Button title="Cancel" variant="ghost" onPress={() => setShowConsent(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="I agree & enroll" variant="primary" icon="check-circle" onPress={doEnroll} />
              </View>
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  statusCard: { marginBottom: spacing.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  statusIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  statusLabel: { ...type.caption, textTransform: 'uppercase', letterSpacing: 0.5 },
  statusValue: { ...type.h2, marginTop: 2 },
  tagline: { ...type.bodySecondary, lineHeight: 19 },
  infoCard: { marginBottom: spacing.lg },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  infoText: { flex: 1, ...type.bodySecondary, lineHeight: 19 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  consentLabel: { ...type.body, fontFamily: 'DMSans_500Medium' },
  consentDesc: { ...type.micro, marginTop: 1 },
  hint: { ...type.micro, color: colors.warning, marginTop: spacing.sm },
  actions: { marginBottom: spacing.lg },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surfaceBorder },
  logText: { flex: 1, ...type.bodySecondary },
  logTime: { ...type.micro },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  modalCard: { width: '100%', maxWidth: 380, gap: spacing.md },
  modalTitle: { ...type.h1 },
  modalBody: { ...type.bodySecondary, lineHeight: 20 },
  modalNote: { ...type.micro, color: colors.warning, lineHeight: 18 },
  modalButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
