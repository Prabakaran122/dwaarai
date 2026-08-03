import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type, font } from '../theme/typography';
import { createApproval, getApproval, lookupUnits } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useT } from '../store/langStore';

type IdType = 'aadhaar' | 'driving_license' | 'voter_id' | 'other';
type Step = 'details' | 'unit' | 'summary';

interface UnitCandidate {
  unitId: string;
  unitNumber: string;
  residentName: string | null;
  relationship: string | null;
  mobile: string | null;
}

interface VisitorPass {
  otp: string;
  valid_until: string;
}

interface ApprovalState {
  id: string;
  status: string;
  respondedByName?: string | null;
  visitorPass?: VisitorPass | null;
}

interface Props {
  onClose: () => void;
}

const ID_TYPES: { key: IdType; labelKey: string }[] = [
  { key: 'aadhaar', labelKey: 'idAadhaar' },
  { key: 'driving_license', labelKey: 'idDrivingLicense' },
  { key: 'voter_id', labelKey: 'idVoterId' },
  { key: 'other', labelKey: 'idOther' },
];

// Walk-in visitor intake (BRD §5.4, NAZ-030..043): manual entry only — OCR is
// an explicitly deferred BRD open item (§10). Three steps: visitor + ID
// details, unit lookup, then resident-approval summary that surfaces the
// one-time entry pass once approved.
export default function WalkInVisitorScreen({ onClose }: Props) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const gateId = useAuthStore((s) => s.user?.gateId) || '';

  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [idType, setIdType] = useState<IdType | null>(null);
  const [idPhotoUri, setIdPhotoUri] = useState<string | null>(null);
  const [facePhotoUri, setFacePhotoUri] = useState<string | null>(null);
  const [vehiclePlate, setVehiclePlate] = useState('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnitCandidate[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<UnitCandidate | null>(null);

  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canProceedStep1 = !!name.trim() && !!mobile.trim() && !!idType && !!idPhotoUri && !!facePhotoUri;

  const takeIdPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    setIdPhotoUri(shot.assets[0].uri);
  };

  const takeFacePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    setFacePhotoUri(shot.assets[0].uri);
  };

  // Unit search (debounced), same pattern as NewVehicleEntryScreen.
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
        visitor_name: name.trim(),
        visitor_mobile: mobile.trim(),
        id_type: idType!,
        gate_id: gateId,
        vehicle_plate: vehiclePlate.trim() || undefined,
        photoUri: idPhotoUri!,
        facePhotoUri: facePhotoUri!,
      });
      const data = res.data.data;
      setApproval({ id: data.id, status: data.status });
    } finally {
      setSubmitting(false);
    }
  }, [selectedUnit, name, mobile, idType, gateId, vehiclePlate, idPhotoUri, facePhotoUri]);

  // Poll for the resident's response (3s cadence, matches vehicle intake).
  useEffect(() => {
    if (!approval || approval.status !== 'pending') return;
    const poll = setInterval(async () => {
      try {
        const res = await getApproval(approval.id);
        const data = res.data.data;
        if (data.status !== 'pending') {
          setApproval((prev) => (prev ? {
            ...prev,
            status: data.status,
            respondedByName: data.responded_by_name,
            visitorPass: data.visitor_pass || null,
          } : prev));
        }
      } catch {
        /* ignore transient polling errors */
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [approval?.id, approval?.status]);

  const insetsTop = { paddingTop: insets.top + spacing.sm };

  return (
    <View style={styles.container}>
      <View style={[styles.header, insetsTop]}>
        <Pressable testID="back-button" onPress={onClose} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
        </Pressable>
        <Text style={type.h2}>{t('quickNewVisitor')}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {step === 'details' && (
          <>
            <Text style={styles.label}>{t('visitorName')}</Text>
            <TextInput
              testID="visitor-name-input"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('visitorName')}
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={styles.label}>{t('visitorMobile')}</Text>
            <TextInput
              testID="visitor-mobile-input"
              style={styles.input}
              value={mobile}
              onChangeText={setMobile}
              placeholder={t('visitorMobile')}
              placeholderTextColor={colors.textTertiary}
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>{t('idType')}</Text>
            <View style={styles.rowWrap}>
              {ID_TYPES.map((it) => (
                <Pressable
                  key={it.key}
                  style={[styles.pill, idType === it.key && styles.pillActive]}
                  onPress={() => setIdType(it.key)}
                >
                  <Text style={[styles.pillText, idType === it.key && styles.pillTextActive]}>{t(it.labelKey)}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable testID="id-photo-button" style={styles.photoBtn} onPress={takeIdPhoto}>
              <MaterialCommunityIcons name="card-account-details" size={18} color={colors.actionPrimary} />
              <Text style={styles.photoBtnText}>{idPhotoUri ? t('retakeIdPhoto') : t('takeIdPhoto')}</Text>
            </Pressable>

            <Pressable testID="face-photo-button" style={styles.photoBtn} onPress={takeFacePhoto}>
              <MaterialCommunityIcons name="face-recognition" size={18} color={colors.actionPrimary} />
              <Text style={styles.photoBtnText}>{facePhotoUri ? t('retakeFacePhoto') : t('takeFacePhoto')}</Text>
            </Pressable>

            <Text style={styles.label}>{t('vehiclePlateOptional')}</Text>
            <TextInput
              testID="visitor-vehicle-input"
              style={styles.input}
              value={vehiclePlate}
              onChangeText={setVehiclePlate}
              placeholder={t('vehiclePlateOptional')}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
            />

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
              <Text style={styles.resultUnit}>{name}</Text>
              <Text style={styles.meta}>{mobile} · {idType ? t(ID_TYPES.find((i) => i.key === idType)!.labelKey) : ''}</Text>
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
                  <>
                    <View style={styles.statusRow}>
                      <MaterialCommunityIcons name="check-circle" size={20} color={colors.teal} />
                      <Text style={[styles.statusText, { color: colors.teal }]}>{t('residentApproved')}</Text>
                    </View>
                    {approval.visitorPass && (
                      <View style={styles.passCard}>
                        <Text style={styles.passLabel}>{t('visitorPassIssued')}</Text>
                        <Text style={styles.passCode}>{approval.visitorPass.otp}</Text>
                        <Text style={styles.meta}>{t('passValidUntil')} {new Date(approval.visitorPass.valid_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                        <Text style={styles.hint}>{t('relayCodeToVisitor')}</Text>
                      </View>
                    )}
                  </>
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
                        <Pressable testID="call-resident-button" style={styles.secondaryBtn} onPress={() => Linking.openURL(`tel:${selectedUnit.mobile}`)}>
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
                    style={[styles.allowBtn, approval.status !== 'approved' && styles.btnDisabled]}
                    disabled={approval.status !== 'approved'}
                    onPress={onClose}
                  >
                    <Text style={styles.allowBtnText}>{t('allowEntry')}</Text>
                  </Pressable>
                  <Pressable testID="hold-visitor-button" style={styles.secondaryBtn} onPress={onClose}>
                    <Text style={styles.secondaryBtnText}>{t('holdVisitor')}</Text>
                  </Pressable>
                  <Pressable testID="deny-button" style={styles.denyBtn} onPress={onClose}>
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
  label: { ...font(700), fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, fontSize: 15, color: colors.textPrimary,
  },
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
  hint: { ...font(400), fontSize: 11, color: colors.amber },
  resultCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  resultUnit: { ...font(700), fontSize: 15, color: colors.textPrimary },
  resultName: { ...font(400), fontSize: 12, color: colors.textSecondary },
  summaryCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  statusText: { ...font(700), fontSize: 14, color: colors.amber },
  passCard: { backgroundColor: 'rgba(0,191,166,0.1)', borderRadius: radius.md, padding: spacing.md, gap: 4, alignItems: 'center' },
  passLabel: { ...font(700), fontSize: 12, color: colors.teal, textTransform: 'uppercase', letterSpacing: 0.5 },
  passCode: { ...font(700), fontSize: 28, color: colors.textPrimary, letterSpacing: 4 },
  phoneFallback: { gap: spacing.xs, padding: spacing.md, backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: radius.md },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  allowBtn: { backgroundColor: colors.teal, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  allowBtnText: { ...font(700), fontSize: 15, color: colors.white },
  btnDisabled: { opacity: 0.4 },
  denyBtn: { alignItems: 'center', padding: spacing.sm },
  denyBtnText: { ...font(500), fontSize: 13, color: colors.danger },
});
