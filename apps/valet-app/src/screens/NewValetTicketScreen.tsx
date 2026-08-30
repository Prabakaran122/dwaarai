import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import * as api from '../api/valet';
import { useT } from '../store/langStore';

/**
 * Taking a car in: plate and make, then the guest comparison photo, then the
 * intake condition capture, then the QR card to hand over.
 *
 * Each capture uploads on its own the moment it is taken, so a dropped
 * connection at the valet stand costs one shot rather than the whole set.
 */

const ANGLES = ['front', 'back', 'left', 'right'] as const;
const PLATE_LOOKUP_DEBOUNCE_MS = 400;

type Step = 'details' | 'photo' | 'condition' | 'done';

export default function NewValetTicketScreen({ onClose }: { onClose?: () => void }) {
  const insets = useSafeAreaInsets();
  const t = useT();

  const [step, setStep] = useState<Step>('details');
  const [plate, setPlate] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [days, setDays] = useState(1);

  const [returning, setReturning] = useState<api.PlateLookup | null>(null);
  const [created, setCreated] = useState<api.CreatedTicket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string[]>([]);

  // Debounced so a valet typing a plate does not fire a request per keystroke.
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (plate.trim().length < 4) {
      setReturning(null);
      return;
    }
    lookupTimer.current = setTimeout(async () => {
      try {
        const res = await api.lookupPlate(plate);
        setReturning(res.data.isReturning ? res.data : null);
      } catch {
        // Informational only — never block ticket creation on this.
        setReturning(null);
      }
    }, PLATE_LOOKUP_DEBOUNCE_MS);
    return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); };
  }, [plate]);

  async function shoot(): Promise<string | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError(t('valetCameraDenied'));
      return null;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
    if (shot.canceled || !shot.assets?.[0]?.uri) return null;
    return shot.assets[0].uri;
  }

  async function submitDetails() {
    if (!plate.trim() || !vehicleMake.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const stayEnd = new Date();
      stayEnd.setDate(stayEnd.getDate() + days);
      const res = await api.createTicket(plate.trim(), vehicleMake.trim(), stayEnd.toISOString());
      setCreated(res.data);
      setStep('photo');
    } catch (err) {
      setError(t('valetFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function captureGuestPhoto() {
    if (!created) return;
    const uri = await shoot();
    if (!uri) return;
    setBusy(true);
    try {
      await api.uploadGuestPhoto(created.sessionToken, uri);
      setPhotoUri(uri);
      setStep('condition');
    } catch {
      setError(t('valetFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function captureCondition(angle: (typeof ANGLES)[number]) {
    if (!created) return;
    const uri = await shoot();
    if (!uri) return;
    setBusy(true);
    try {
      await api.uploadCondition(created.sessionToken, uri, 'intake', 'photo', angle);
      setCaptured((prev) => [...prev, angle]);
      setError(null);
    } catch {
      setError(t('valetFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="valet-close" onPress={onClose} hitSlop={12}>
          <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
        <Text style={type.h2}>{t('valetNewTicket')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error && <Text style={styles.error} testID="valet-error">{error}</Text>}

        {step === 'details' && (
          <>
            <Text style={styles.label}>{t('valetPlate')}</Text>
            <TextInput
              testID="valet-plate-input"
              value={plate}
              onChangeText={setPlate}
              autoCapitalize="characters"
              placeholder="KA 03 NJ 0435"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
            />

            {/* Informational only. It never blocks or changes ticket creation,
                and nothing about it is shown to the guest. */}
            {returning && (
              <View style={styles.returningBanner} testID="valet-returning-banner">
                <MaterialCommunityIcons name="history" size={18} color={colors.teal} />
                <Text style={styles.returningText}>
                  {t('valetReturning').replace('{n}', String(returning.visitCount ?? 0))}
                </Text>
              </View>
            )}

            <Text style={styles.label}>{t('valetMake')}</Text>
            <TextInput
              testID="valet-make-input"
              value={vehicleMake}
              onChangeText={setVehicleMake}
              placeholder="Maruti Swift"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
            />

            <Text style={styles.label}>{t('valetStayEnd')}</Text>
            <View style={styles.dayRow}>
              {[1, 2, 3, 7].map((d) => (
                <Pressable
                  key={d}
                  testID={`valet-days-${d}`}
                  onPress={() => setDays(d)}
                  style={[styles.dayChip, days === d && styles.dayChipActive]}
                >
                  <Text style={[styles.dayChipText, days === d && styles.dayChipTextActive]}>
                    {d}d
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              testID="valet-create"
              disabled={busy || !plate.trim() || !vehicleMake.trim()}
              onPress={submitDetails}
              style={[styles.cta, (busy || !plate.trim() || !vehicleMake.trim()) && styles.ctaDisabled]}
            >
              {busy ? <ActivityIndicator color={colors.bgPrimary} /> : <Text style={styles.ctaText}>{t('valetCreate')}</Text>}
            </Pressable>
          </>
        )}

        {step === 'photo' && created && (
          <>
            <View style={styles.qrCard} testID="valet-qr-card">
              <Text style={styles.qrTitle}>{t('valetShowQr')}</Text>
              <Image source={{ uri: created.qrDataUrl }} style={styles.qr} />
              <Text style={styles.qrCode}>{created.displayId}</Text>
            </View>

            <Pressable testID="valet-capture-photo" style={styles.cta} onPress={captureGuestPhoto}>
              <Text style={styles.ctaText}>{t('valetCapturePhoto')}</Text>
            </Pressable>
            {/* Unlike the condition capture below, this one is skippable: a
                denied camera must not strand a car that is already parked. */}
            <Pressable testID="valet-skip-photo" style={styles.ghost} onPress={() => setStep('condition')}>
              <Text style={styles.ghostText}>{t('valetSkipPhoto')}</Text>
            </Pressable>
          </>
        )}

        {step === 'condition' && (
          <>
            <Text style={styles.label}>{t('valetConditionIntake')}</Text>
            <View style={styles.angleGrid}>
              {ANGLES.map((angle) => {
                const done = captured.includes(angle);
                return (
                  <Pressable
                    key={angle}
                    testID={`valet-angle-${angle}`}
                    onPress={() => captureCondition(angle)}
                    style={[styles.angleTile, done && styles.angleTileDone]}
                  >
                    <MaterialCommunityIcons
                      name={done ? 'check-circle' : 'camera-outline'}
                      size={26}
                      color={done ? colors.teal : colors.textSecondary}
                    />
                    <Text style={styles.angleText}>{angle}</Text>
                  </Pressable>
                );
              })}
            </View>

            {captured.length === 0 && (
              <Text style={styles.hint} testID="valet-condition-hint">
                {t('valetConditionRequired')}
              </Text>
            )}

            <Pressable
              testID="valet-finish"
              disabled={captured.length === 0}
              onPress={() => setStep('done')}
              style={[styles.cta, captured.length === 0 && styles.ctaDisabled]}
            >
              <Text style={styles.ctaText}>{t('done')}</Text>
            </Pressable>
          </>
        )}

        {step === 'done' && created && (
          <View style={styles.qrCard} testID="valet-done-card">
            <Text style={styles.qrTitle}>{t('valetShowQr')}</Text>
            <Image source={{ uri: created.qrDataUrl }} style={styles.qr} />
            <Text style={styles.qrCode}>{created.displayId}</Text>
            <Pressable testID="valet-done" style={styles.cta} onPress={onClose}>
              <Text style={styles.ctaText}>{t('done')}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  content: { padding: spacing.lg, gap: spacing.md },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
  input: {
    backgroundColor: colors.elevated, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.textPrimary, fontSize: 16,
  },
  returningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.successBg, borderRadius: radius.md, padding: spacing.md,
  },
  returningText: { color: colors.teal, fontSize: 13, fontWeight: '600', flex: 1 },
  dayRow: { flexDirection: 'row', gap: spacing.sm },
  dayChip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
  },
  dayChipActive: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  dayChipText: { color: colors.textSecondary, fontWeight: '600' },
  dayChipTextActive: { color: colors.bgPrimary },
  cta: {
    backgroundColor: colors.actionPrimary, borderRadius: radius.md,
    paddingVertical: spacing.lg, alignItems: 'center', marginTop: spacing.md,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.bgPrimary, fontWeight: '700', fontSize: 16 },
  ghost: { paddingVertical: spacing.md, alignItems: 'center' },
  ghostText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  qrCard: {
    backgroundColor: colors.white, borderRadius: radius.xl,
    padding: spacing.xl, alignItems: 'center', gap: spacing.md,
  },
  qrTitle: { color: colors.bgPrimary, fontWeight: '700', fontSize: 15 },
  qr: { width: 220, height: 220 },
  qrCode: { color: colors.bgPrimary, fontWeight: '700', letterSpacing: 1 },
  angleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  angleTile: {
    width: '47%', aspectRatio: 1.6, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  angleTileDone: { borderColor: colors.teal, backgroundColor: colors.successBg },
  angleText: { color: colors.textSecondary, fontSize: 12, textTransform: 'capitalize' },
  hint: { color: colors.textTertiary, fontSize: 12, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
});
