import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type, font } from '../theme/typography';
import PlateText from '../components/PlateText';
import { createApproval, getApproval, lookupUnits, sendGateCommand } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useQueueStore, type QueueEntry } from '../store/queueStore';
import { useT } from '../store/langStore';

type VehicleType = 'car' | 'two_wheeler' | 'goods_vehicle' | 'other';
type Purpose = 'delivery' | 'guest_visit' | 'service' | 'contractor' | 'other';
type Step = 'details' | 'unit' | 'summary';

interface UnitCandidate {
  unitId: string;
  unitNumber: string;
  residentName: string | null;
  relationship: string | null;
  mobile: string | null;
}

interface ApprovalState {
  id: string;
  status: string;
  respondedByName?: string | null;
}

interface Props {
  entry?: QueueEntry | null;
  onClose: () => void;
}

const VEHICLE_TYPES: { key: VehicleType; labelKey: string; icon: string }[] = [
  { key: 'car', labelKey: 'vehicleTypeCar', icon: 'car' },
  { key: 'two_wheeler', labelKey: 'vehicleTypeTwoWheeler', icon: 'motorbike' },
  { key: 'goods_vehicle', labelKey: 'vehicleTypeGoods', icon: 'truck' },
  { key: 'other', labelKey: 'vehicleTypeOther', icon: 'help-circle-outline' },
];

const PURPOSES: { key: Purpose; labelKey: string }[] = [
  { key: 'delivery', labelKey: 'purposeDelivery' },
  { key: 'guest_visit', labelKey: 'purposeGuestVisit' },
  { key: 'service', labelKey: 'purposeService' },
  { key: 'contractor', labelKey: 'purposeContractor' },
  { key: 'other', labelKey: 'purposeOther' },
];

// Mandatory new-vehicle-entry intake (BRD §5.3, NAZ-019..029) for a plate the
// edge/ANPR did not recognize -- three steps: vehicle details, unit lookup,
// then resident-approval summary with a 3-minute call-the-resident fallback.
export default function NewVehicleEntryScreen({ entry, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const removeEntry = useQueueStore((s) => s.removeEntry);

  const [step, setStep] = useState<Step>('details');
  const isPlateLocked = !!entry && entry.plate !== 'Unknown';
  const [plate, setPlate] = useState(isPlateLocked ? entry!.plate : '');
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null);
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnitCandidate[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<UnitCandidate | null>(null);

  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const canProceedStep1 = !!vehicleType && !!purpose && !!photoUri;

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    setPhotoUri(shot.assets[0].uri);
  };

  // Unit search (debounced), NAZ-024
  useEffect(() => {
    if (step !== 'unit' || query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await lookupUnits(query.trim());
        if (!cancelled) setResults(res.data.data);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, step]);

  const submit = useCallback(async () => {
    if (!selectedUnit) return;
    setSubmitting(true);
    try {
      const res = await createApproval({
        unit_number: selectedUnit.unitNumber,
        visitor_name: 'Unregistered vehicle',
        vehicle_plate: plate.trim() || 'Unknown',
        gate_id: gateId,
        vehicle_type: vehicleType!,
        purpose: purpose!,
        photoUri: photoUri!,
      });
      const data = res.data.data;
      setApproval({ id: data.id, status: data.status });
    } finally {
      setSubmitting(false);
    }
  }, [selectedUnit, plate, vehicleType, purpose, photoUri, gateId]);

  // Poll for the resident's response (3s cadence, matches ApprovalWaiting).
  useEffect(() => {
    if (!approval || approval.status !== 'pending') return;
    const poll = setInterval(async () => {
      try {
        const res = await getApproval(approval.id);
        const data = res.data.data;
        if (data.status !== 'pending') {
          setApproval((prev) => (prev ? { ...prev, status: data.status, respondedByName: data.responded_by_name } : prev));
        }
      } catch {
        /* ignore transient polling errors */
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [approval?.id, approval?.status]);

  const finish = async (action: 'open' | 'close' | null) => {
    setActionLoading(true);
    try {
      if (action && gateId) {
        await sendGateCommand(gateId, action);
      }
      if (entry) removeEntry(entry.id);
      onClose();
    } finally {
      setActionLoading(false);
    }
  };

  const insetsTop = { paddingTop: insets.top + spacing.sm };

  return (
    <View style={styles.container}>
      <View style={[styles.header, insetsTop]}>
        <Pressable testID="back-button" onPress={onClose} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
        </Pressable>
        <Text style={type.h2}>{t('quickVehicleEntry')}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {step === 'details' && (
          <>
            <View style={styles.warningBanner}>
              <MaterialCommunityIcons name="alert" size={18} color={colors.danger} />
              <Text style={styles.warningText}>{t('plateNotFoundWarning')}</Text>
            </View>

            <Text style={styles.label}>{t('plateNumber')}</Text>
            {isPlateLocked ? (
              <PlateText plate={plate} size="lg" />
            ) : (
              <TextInput
                testID="plate-input"
                style={styles.input}
                value={plate}
                onChangeText={setPlate}
                placeholder={t('plateNumber')}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
              />
            )}

            <Text style={styles.label}>{t('vehicleType')}</Text>
            <View style={styles.grid}>
              {VEHICLE_TYPES.map((vt) => (
                <Pressable
                  key={vt.key}
                  style={[styles.chip, vehicleType === vt.key && styles.chipActive]}
                  onPress={() => setVehicleType(vt.key)}
                >
                  <MaterialCommunityIcons name={vt.icon as any} size={20} color={vehicleType === vt.key ? colors.actionPrimary : colors.textSecondary} />
                  <Text style={[styles.chipText, vehicleType === vt.key && styles.chipTextActive]}>{t(vt.labelKey)}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>{t('purposeOfVisit')}</Text>
            <View style={styles.rowWrap}>
              {PURPOSES.map((p) => (
                <Pressable
                  key={p.key}
                  style={[styles.pill, purpose === p.key && styles.pillActive]}
                  onPress={() => setPurpose(p.key)}
                >
                  <Text style={[styles.pillText, purpose === p.key && styles.pillTextActive]}>{t(p.labelKey)}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable testID="take-photo-button" style={styles.photoBtn} onPress={takePhoto}>
              <MaterialCommunityIcons name="camera" size={18} color={colors.actionPrimary} />
              <Text style={styles.photoBtnText}>{photoUri ? t('retakePhoto') : t('takePhoto')}</Text>
            </Pressable>

            {canProceedStep1 && (
              <Pressable testID="step1-next" style={styles.primaryBtn} onPress={() => setStep('unit')}>
                <Text style={styles.primaryBtnText}>{t('next')}</Text>
              </Pressable>
            )}
          </>
        )}

        {step === 'unit' && (
          <>
            <TextInput
              testID="unit-search-input"
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={t('searchUnitPlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
            {query.trim().length >= 2 && results.length === 0 && (
              <Text style={styles.meta}>{t('noUnitsFound')}</Text>
            )}
            {results.map((r) => (
              <Pressable
                key={r.unitId}
                testID={`unit-result-${r.unitId}`}
                style={styles.resultCard}
                onPress={() => { setSelectedUnit(r); setStep('summary'); }}
              >
                <Text style={styles.resultUnit}>{r.unitNumber}</Text>
                <Text style={styles.resultName}>{r.residentName} · {r.relationship}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.secondaryBtn} onPress={() => setStep('details')}>
              <Text style={styles.secondaryBtnText}>{t('back')}</Text>
            </Pressable>
          </>
        )}

        {step === 'summary' && selectedUnit && (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.resultUnit}>{plate.trim() || 'Unknown'}</Text>
              <Text style={styles.meta}>{vehicleType ? t(VEHICLE_TYPES.find((v) => v.key === vehicleType)!.labelKey) : ''} · {purpose ? t(PURPOSES.find((p) => p.key === purpose)!.labelKey) : ''}</Text>
              <Text style={styles.meta}>{selectedUnit.unitNumber} · {selectedUnit.residentName}</Text>
            </View>

            {!approval && (
              <Pressable style={styles.primaryBtn} onPress={submit} disabled={submitting}>
                {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>{t('sendForApproval')}</Text>}
              </Pressable>
            )}

            {approval && (
              <>
                {approval.status === 'pending' && (
                  <View style={styles.statusRow}>
                    <ActivityIndicator color={colors.amber} />
                    <Text style={styles.statusText}>{t('awaitingApproval')}</Text>
                  </View>
                )}
                {approval.status === 'approved' && (
                  <View style={styles.statusRow}>
                    <MaterialCommunityIcons name="check-circle" size={20} color={colors.teal} />
                    <Text style={[styles.statusText, { color: colors.teal }]}>{t('residentApproved')}</Text>
                  </View>
                )}
                {approval.status === 'denied' && (
                  <View style={styles.statusRow}>
                    <MaterialCommunityIcons name="close-circle" size={20} color={colors.danger} />
                    <Text style={[styles.statusText, { color: colors.danger }]}>{t('residentDenied')}</Text>
                  </View>
                )}
                {approval.status === 'expired' && (
                  <View style={styles.phoneFallback}>
                    <Text style={[styles.statusText, { color: colors.amber }]}>{t('noResponseCallResident')}</Text>
                    {!!selectedUnit.mobile && (
                      <>
                        <Text style={styles.meta}>{selectedUnit.residentName} · {selectedUnit.mobile}</Text>
                        <Pressable style={styles.secondaryBtn} onPress={() => Linking.openURL(`tel:${selectedUnit.mobile}`)}>
                          <MaterialCommunityIcons name="phone" size={16} color={colors.actionPrimary} />
                          <Text style={styles.secondaryBtnText}>{t('callResident')}</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                )}

                <View style={styles.actions}>
                  <Pressable
                    testID="allow-entry-button"
                    style={[styles.allowBtn, (approval.status === 'pending' || approval.status === 'denied') && styles.btnDisabled]}
                    disabled={approval.status === 'pending' || approval.status === 'denied' || actionLoading}
                    onPress={() => finish('open')}
                  >
                    <Text style={styles.allowBtnText}>{t('allowEntry')}</Text>
                  </Pressable>
                  <Pressable testID="hold-vehicle-button" style={styles.secondaryBtn} disabled={actionLoading} onPress={() => finish(null)}>
                    <Text style={styles.secondaryBtnText}>{t('holdVehicle')}</Text>
                  </Pressable>
                  <Pressable testID="deny-button" style={styles.denyBtn} disabled={actionLoading} onPress={() => finish('close')}>
                    <Text style={styles.denyBtnText}>{t('deny')}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
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
  warningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(248,113,113,0.12)', borderRadius: radius.md, padding: spacing.md,
  },
  warningText: { ...font(500), fontSize: 12, color: colors.danger, flex: 1 },
  label: { ...font(700), fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, fontSize: 15, color: colors.textPrimary,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    width: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
  },
  chipActive: { borderColor: colors.actionPrimary },
  chipText: { ...font(400), fontSize: 13, color: colors.textSecondary },
  chipTextActive: { color: colors.actionPrimary, ...font(700) },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  pillActive: { borderColor: colors.actionPrimary, backgroundColor: 'rgba(245,158,11,0.12)' },
  pillText: { ...font(400), fontSize: 13, color: colors.textSecondary },
  pillTextActive: { color: colors.actionPrimary, ...font(700) },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', padding: spacing.sm },
  photoBtnText: { ...font(500), fontSize: 13, color: colors.actionPrimary },
  primaryBtn: { backgroundColor: colors.teal, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  primaryBtnText: { ...font(700), fontSize: 15, color: colors.white },
  secondaryBtn: { flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', alignItems: 'center', padding: spacing.md },
  secondaryBtnText: { ...font(500), fontSize: 13, color: colors.actionPrimary },
  meta: { ...font(400), fontSize: 12, color: colors.textSecondary },
  resultCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  resultUnit: { ...font(700), fontSize: 15, color: colors.textPrimary },
  resultName: { ...font(400), fontSize: 12, color: colors.textSecondary },
  summaryCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  statusText: { ...font(700), fontSize: 14, color: colors.amber },
  phoneFallback: { gap: spacing.xs, padding: spacing.md, backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: radius.md },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  allowBtn: { backgroundColor: colors.teal, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  allowBtnText: { ...font(700), fontSize: 15, color: colors.white },
  btnDisabled: { opacity: 0.4 },
  denyBtn: { alignItems: 'center', padding: spacing.sm },
  denyBtnText: { ...font(500), fontSize: 13, color: colors.danger },
});
