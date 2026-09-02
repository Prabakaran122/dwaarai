import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import * as api from '../api/valet';
import { useT } from '../store/langStore';
import { parseCardCode } from '../lib/cardCode';

/**
 * Taking a car in: plate and make, optionally a printed card, then the guest
 * comparison photo, the intake condition capture, and finally what the guest
 * leaves with.
 *
 * Each capture uploads on its own the moment it is taken, so a dropped
 * connection at the valet stand costs one shot rather than the whole set.
 *
 * The card is optional on purpose. A venue with no printed stock still works
 * exactly as it did — the screen QR is then the ticket — so the card step must
 * never become something a valet has to dismiss before taking a car in.
 */

const ANGLES = ['front', 'back', 'left', 'right'] as const;
const PLATE_LOOKUP_DEBOUNCE_MS = 400;

type Step = 'details' | 'card' | 'photo' | 'condition' | 'done';

/**
 * What the guest leaves with.
 *
 * With a card bound, the plastic IS the ticket — telling a valet to show a
 * screen QR would have them hand over nothing, and the guest would be left
 * with a card they were never told to keep. The screen QR is still rendered
 * underneath so a guest who would rather use their own phone can, but the
 * instruction leads with the card.
 */
function TicketHandout({
  created, t,
}: {
  created: api.CreatedTicket;
  t: (k: string) => string;
}) {
  if (created.cardCode) {
    return (
      <View style={styles.qrCard} testID="valet-card-handout">
        <Text style={styles.qrTitle}>{t('valetCardHandOver')}</Text>
        <Text style={styles.bigCard} testID="valet-handout-code">
          {created.cardCode}
        </Text>
        <Image source={{ uri: created.qrDataUrl }} style={styles.qrSmall} />
        <Text style={styles.qrCode}>{created.displayId}</Text>
      </View>
    );
  }
  return (
    <View style={styles.qrCard} testID="valet-qr-card">
      <Text style={styles.qrTitle}>{t('valetShowQr')}</Text>
      <Image source={{ uri: created.qrDataUrl }} style={styles.qr} />
      <Text style={styles.qrCode}>{created.displayId}</Text>
    </View>
  );
}

export default function NewValetTicketScreen({ onClose }: { onClose?: () => void }) {
  const insets = useSafeAreaInsets();
  const t = useT();

  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>('details');
  const [plate, setPlate] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [days, setDays] = useState(1);
  const [cardCode, setCardCode] = useState<string | null>(null);
  const [typedCard, setTypedCard] = useState('');
  // Latched in a ref for the same reason as the handover scanner: a real
  // camera fires onBarcodeScanned many times a second, far faster than React
  // re-renders, so a state flag would still read stale within a frame.
  const scanning = useRef(true);

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

  function openScanner() {
    scanning.current = true;
    setTypedCard('');
    setError(null);
    setStep('card');
  }

  function acceptCard(code: string) {
    setCardCode(code);
    setError(null);
    setStep('details');
  }

  function onCardScanned({ data }: { data: string }) {
    if (!scanning.current) return;
    const code = parseCardCode(data);
    if (!code) {
      // Stay on the scanner: the valet is holding a card and pointing it at
      // something, and dropping them back to the form loses that.
      scanning.current = false;
      setError(t('valetCardNotACard'));
      setTimeout(() => { scanning.current = true; }, 1200);
      return;
    }
    scanning.current = false;
    acceptCard(code);
  }

  function useTypedCard() {
    const code = parseCardCode(typedCard);
    if (!code) {
      setError(t('valetCardNotACard'));
      return;
    }
    acceptCard(code);
  }

  async function submitDetails() {
    if (!plate.trim() || !vehicleMake.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const stayEnd = new Date();
      stayEnd.setDate(stayEnd.getDate() + days);
      const res = await api.createTicket(
        plate.trim(), vehicleMake.trim(), stayEnd.toISOString(), cardCode ?? undefined
      );
      setCreated(res.data);
      setStep('photo');
    } catch (err) {
      // A card clash is the valet's own mistake to fix — they are holding the
      // wrong card — so say which, rather than a generic failure they cannot
      // act on. The car is not taken in either way.
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (code === 'card_in_use') setError(t('valetCardInUse'));
      else if (code === 'unknown_card') setError(t('valetCardUnknown'));
      else setError(t('valetFailed'));
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

            <Text style={styles.label}>{t('valetScanCard')}</Text>
            {cardCode ? (
              <View style={styles.cardChip} testID="valet-card-chip">
                <MaterialCommunityIcons name="card-account-details-outline" size={20} color={colors.teal} />
                <Text style={styles.cardChipText}>
                  {t('valetCardBound').replace('{c}', cardCode)}
                </Text>
                <Pressable testID="valet-card-clear" onPress={() => setCardCode(null)} hitSlop={12}>
                  <MaterialCommunityIcons name="close" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>
            ) : (
              <Pressable testID="valet-scan-card" style={styles.cardScanBtn} onPress={openScanner}>
                <MaterialCommunityIcons name="qrcode-scan" size={20} color={colors.textSecondary} />
                <Text style={styles.cardScanText}>{t('valetScanCard')}</Text>
              </Pressable>
            )}
            {/* Said plainly rather than left blank: a venue with no printed
                stock is a supported setup, not an unfinished ticket. */}
            {!cardCode && (
              <Text style={styles.hint} testID="valet-no-card-hint">{t('valetNoCard')}</Text>
            )}

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

        {step === 'card' && (
          <>
            {permission?.granted ? (
              <CameraView
                testID="card-camera"
                style={styles.scanner}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onCardScanned}
              />
            ) : (
              <View style={styles.permissionBox}>
                <Text style={styles.hint}>{t('valetCameraDenied')}</Text>
                <Pressable testID="card-grant" style={styles.cta} onPress={requestPermission}>
                  <Text style={styles.ctaText}>{t('valetGrantCamera')}</Text>
                </Pressable>
              </View>
            )}

            {/* Always offered, not just when permission is denied: card QRs get
                scuffed in a pocket and the code is printed on the card anyway. */}
            <Text style={styles.label}>{t('valetCardTypeIt')}</Text>
            <TextInput
              testID="valet-card-input"
              value={typedCard}
              onChangeText={setTypedCard}
              autoCapitalize="characters"
              placeholder="A047"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
            />
            <Pressable
              testID="valet-card-use"
              disabled={!typedCard.trim()}
              onPress={useTypedCard}
              style={[styles.cta, !typedCard.trim() && styles.ctaDisabled]}
            >
              <Text style={styles.ctaText}>{t('valetCardUse')}</Text>
            </Pressable>
            <Pressable testID="valet-card-cancel" style={styles.ghost} onPress={() => setStep('details')}>
              <Text style={styles.ghostText}>{t('cancel')}</Text>
            </Pressable>
          </>
        )}

        {step === 'photo' && created && (
          <>
            <TicketHandout created={created} t={t} />

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
          <View testID="valet-done-card">
            <TicketHandout created={created} t={t} />
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
  cardScanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    borderStyle: 'dashed', paddingVertical: spacing.lg, backgroundColor: colors.card,
  },
  cardScanText: { color: colors.textSecondary, fontWeight: '600', fontSize: 15 },
  cardChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.successBg, borderRadius: radius.md, padding: spacing.md,
  },
  cardChipText: { color: colors.teal, fontWeight: '700', fontSize: 15, flex: 1 },
  scanner: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden' },
  permissionBox: { padding: spacing.xl, gap: spacing.md, alignItems: 'center' },
  bigCard: {
    color: colors.bgPrimary, fontWeight: '700', fontSize: 44, letterSpacing: 2,
  },
  qrSmall: { width: 140, height: 140 },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
});
