import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type, font } from '../theme/typography';
import LayerCard from '../components/LayerCard';
import ConfidenceBar from '../components/ConfidenceBar';
import PlateText from '../components/PlateText';
import { verifyDriver, sendGateCommand } from '../api/client';
import { useEntitlementStore } from '../store/entitlementStore';
import { useAuthStore } from '../store/authStore';
import { useQueueStore, type QueueEntry } from '../store/queueStore';
import { computeOverallResult, type FaceStatus } from '../lib/verification';

interface Props {
  entry: QueueEntry;
  onClose: () => void;
}

interface FaceResult {
  status: FaceStatus;
  name?: string | null;
  relationship?: string | null;
  confidence?: number;
}

const RESULT_COPY: Record<'green' | 'amber' | 'red', { label: string; color: string }> = {
  green: { label: 'All layers verified', color: colors.teal },
  amber: { label: 'Partial verification — review before opening', color: colors.amber },
  red: { label: 'Mismatch or anomaly detected', color: colors.danger },
};

// Triple-layer vehicle verification (BRD §5.2, NAZ-011..018) — the centerpiece
// screen the guard lands on from Gate Home's approaching-vehicle alert.
export default function VehicleVerificationScreen({ entry, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const entFastag = useEntitlementStore((s) => s.fastag);
  const entAnpr = useEntitlementStore((s) => s.anpr);
  const entFace = useEntitlementStore((s) => s.face);
  const entAiAnomaly = useEntitlementStore((s) => s.aiAnomaly);
  const entitlements = { fastag: entFastag, anpr: entAnpr, face: entFace, aiAnomaly: entAiAnomaly };
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const removeEntry = useQueueStore((s) => s.removeEntry);
  const [face, setFace] = useState<FaceResult>({ status: 'idle' });
  const [actionLoading, setActionLoading] = useState(false);

  const isMatched = !!(entry.unitNumber || entry.residentName);
  const { result, anomaly } = computeOverallResult({ entry, faceStatus: face.status, entitlements });
  const resultCopy = RESULT_COPY[result];

  const scanDriverFace = async () => {
    setFace({ status: 'checking' });
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setFace({ status: 'idle' }); return; }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true, allowsEditing: false });
      if (shot.canceled || !shot.assets?.[0]?.base64) { setFace({ status: 'idle' }); return; }
      const res = await verifyDriver({
        plate: entry.plate !== 'Unknown' ? entry.plate : undefined,
        unit_number: entry.unitNumber,
        scan_b64: shot.assets[0].base64,
      });
      const data = res.data.data;
      setFace({ status: data.status, name: data.resident_name, relationship: data.relationship, confidence: data.confidence });
    } catch {
      setFace({ status: 'unavailable' });
    }
  };

  // The backend's gate-command action enum has no separate "deny" value
  // (open/close/hold_open/evacuate/restore/lockdown) -- denying a vehicle is
  // just "close" (or a no-op if the barrier never opened).
  const finish = async (action: 'open' | 'close') => {
    if (!gateId) return;
    setActionLoading(true);
    try {
      await sendGateCommand(gateId, action);
      removeEntry(entry.id);
      onClose();
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={onClose} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
        </Pressable>
        <PlateText plate={entry.plate} size="lg" />
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {entitlements.fastag && (
          <LayerCard title="FASTag" icon="car-wireless" accentColor={colors.teal}>
            <Text style={[styles.statusText, { color: isMatched ? colors.teal : colors.textSecondary }]}>
              {isMatched ? 'Matched' : 'No match'}
            </Text>
            {isMatched && (
              <Text style={styles.meta}>
                {[entry.unitNumber, entry.residentName].filter(Boolean).join(' · ')}
              </Text>
            )}
          </LayerCard>
        )}

        {entitlements.anpr && (
          <LayerCard title="ANPR" icon="camera" accentColor={colors.amber}>
            <PlateText plate={entry.plate} size="sm" />
            {typeof entry.anprConfidence === 'number' ? (
              <ConfidenceBar value={entry.anprConfidence} color={colors.amber} />
            ) : (
              <Text style={styles.meta}>No ANPR read for this event</Text>
            )}
            {entitlements.fastag && (
              <Text style={styles.meta}>
                {entry.alertType === 'fastag_mismatch' ? 'Cross-check: mismatch vs FASTag' : 'Cross-check: matches FASTag'}
              </Text>
            )}
          </LayerCard>
        )}

        {entitlements.face && (
          <LayerCard title="Face Recognition" icon="face-recognition" accentColor={colors.purple}>
            {face.status === 'idle' && (
              <Pressable testID="scan-driver-face" style={styles.scanBtn} onPress={scanDriverFace}>
                <MaterialCommunityIcons name="camera-outline" size={16} color={colors.purple} />
                <Text style={styles.scanBtnText}>Scan driver face</Text>
              </Pressable>
            )}
            {face.status === 'checking' && <Text style={styles.meta}>Checking…</Text>}
            {face.status === 'confirmed' && (
              <>
                <ConfidenceBar value={face.confidence ?? 0} color={colors.purple} />
                <Text style={styles.meta}>{face.name} · {face.relationship}</Text>
              </>
            )}
            {face.status === 'flagged' && <Text style={[styles.statusText, { color: colors.danger }]}>Face didn't match — verify manually</Text>}
            {face.status === 'unavailable' && <Text style={styles.meta}>Face check unavailable</Text>}
          </LayerCard>
        )}

        {anomaly && (
          <View style={styles.anomalyBanner}>
            <MaterialCommunityIcons name="alert-outline" size={18} color={colors.amber} />
            <Text style={styles.anomalyText}>{anomaly}</Text>
          </View>
        )}

        <View style={[styles.resultCard, { borderColor: resultCopy.color }]}>
          <MaterialCommunityIcons
            name={result === 'green' ? 'check-circle' : result === 'amber' ? 'alert-circle' : 'close-circle'}
            size={20}
            color={resultCopy.color}
          />
          <Text style={[styles.resultText, { color: resultCopy.color }]}>{resultCopy.label}</Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          testID="open-gate-button"
          style={styles.openGateBtn}
          onPress={() => finish('open')}
          disabled={actionLoading}
        >
          {actionLoading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <MaterialCommunityIcons name="gate" size={20} color={colors.white} />
              <Text style={styles.openGateText}>Open gate</Text>
            </>
          )}
        </Pressable>
        {result !== 'green' && (
          <Pressable testID="override-button" style={styles.overrideBtn} onPress={() => finish('open')} disabled={actionLoading}>
            <Text style={styles.overrideText}>Override and flag for review</Text>
          </Pressable>
        )}
        <Pressable testID="deny-button" style={styles.denyBtn} onPress={() => finish('close')} disabled={actionLoading}>
          <Text style={styles.denyText}>Deny</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  content: { padding: spacing.lg, gap: spacing.md },
  statusText: { ...font(700), fontSize: 14 },
  meta: { ...font(400), fontSize: 12, color: colors.textSecondary },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
  scanBtnText: { ...font(500), fontSize: 13, color: colors.purple },
  anomalyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: radius.md, padding: spacing.md,
  },
  anomalyText: { ...font(500), fontSize: 12, color: colors.amber, flex: 1 },
  resultCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.card,
  },
  resultText: { ...font(700), fontSize: 14, flex: 1 },
  actions: { padding: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  openGateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.teal, borderRadius: radius.md, paddingVertical: spacing.md,
  },
  openGateText: { ...font(700), fontSize: 16, color: colors.white },
  overrideBtn: { alignItems: 'center', padding: spacing.sm },
  overrideText: { ...font(500), fontSize: 13, color: colors.amber },
  denyBtn: { alignItems: 'center', padding: spacing.sm },
  denyText: { ...font(500), fontSize: 13, color: colors.danger },
});
