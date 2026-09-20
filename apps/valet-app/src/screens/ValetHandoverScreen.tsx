import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import * as api from '../api/valet';
import { useT } from '../store/langStore';
import { takePhoto, openAppSettings } from '../lib/camera';

/**
 * Handing a car back: scan the guest's rotating QR, compare their face against
 * the stored photo, capture the return condition, then confirm.
 *
 * The order is not cosmetic. The scan proves the person holds the live ticket,
 * the photo is a human comparison (no matching model runs), and the return
 * capture is refused server-side if it is missing — so the screen enforces the
 * same order the API does rather than letting a valet discover it as an error.
 */

const ANGLES = ['front', 'back', 'left', 'right'] as const;

/**
 * Hides the last four digits of a plate.
 *
 * The guard is asking the guest to prove they know the vehicle. Showing the
 * whole plate on the screen the guard is holding, in front of the person being
 * checked, hands over the answer.
 */
export function maskPlate(plate: string): string {
  const trimmed = String(plate ?? '').trim();
  if (trimmed.length <= 4) return trimmed;
  return trimmed.slice(0, -4) + '\u2022'.repeat(4);
}

type Stage = 'scan' | 'compare' | 'condition' | 'confirm';

export default function ValetHandoverScreen({
  sessionToken, onDone,
}: {
  sessionToken: string;
  onDone?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const t = useT();

  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>('scan');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string[]>([]);
  // Whether an intake photo exists is answered by the ticket, not by waiting
  // for the image to fail: an empty frame and a "Matches" button is the one
  // outcome this screen must never produce.
  const [ticket, setTicket] = useState<api.TicketDetail | null>(null);
  const [verification, setVerification] = useState<api.Verification>('photo');
  const [cameraBlocked, setCameraBlocked] = useState(false);
  // Latched in a ref, not state: a real camera fires onBarcodeScanned many
  // times per second, far faster than React re-renders, so a state flag would
  // still be `true` for every call in the same frame and the same code would
  // POST repeatedly. A ref flips synchronously on the first call.
  const scanning = useRef(true);

  useEffect(() => {
    if (permission && !permission.granted) requestPermission();
  }, [permission?.granted]);

  useEffect(() => {
    let cancelled = false;
    api.getTicket(sessionToken)
      .then((res) => { if (!cancelled) setTicket(res.data); })
      .catch(() => { /* the compare stage falls back to the no-photo path */ });
    return () => { cancelled = true; };
  }, [sessionToken]);

  async function onScanned({ data }: { data: string }) {
    if (!scanning.current) return;
    scanning.current = false;
    setBusy(true);
    try {
      await api.scanPickup(sessionToken, data);
      setError(null);
      setStage('compare');
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      // An expired or superseded code is the normal case, not a failure: the
      // guest's QR rotates every few seconds. Keep scanning.
      setError(code === 'invalid_or_expired' ? t('valetQrExpired') : t('valetFailed'));
      // Re-arm after a beat so the guest's next rotation can be caught.
      setTimeout(() => { scanning.current = true; }, 1200);
    } finally {
      setBusy(false);
    }
  }

  async function captureReturn(angle: (typeof ANGLES)[number]) {
    // Never throws — see lib/camera. The same await used to sit outside this
    // try/catch, so a picker error silently did nothing.
    const res = await takePhoto();
    if (!res.ok) {
      setCameraBlocked(res.reason === 'blocked');
      if (res.reason === 'cancelled') setError(null);
      else if (res.reason === 'blocked') setError(t('valetCameraBlocked'));
      else if (res.reason === 'denied') setError(t('valetCameraDenied'));
      else setError(`${t('valetCameraFailed')} — ${res.detail}`);
      return;
    }
    setCameraBlocked(false);

    setBusy(true);
    try {
      await api.uploadCondition(sessionToken, res.uri, 'return', 'photo', angle);
      setCaptured((prev) => [...prev, angle]);
      setError(null);
    } catch {
      setError(t('valetFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(final: boolean) {
    setBusy(true);
    try {
      await api.confirmPickup(sessionToken, final, verification);
      onDone?.();
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(
        code === 'return_condition_required' ? t('valetConditionRequired')
          : code === 'scan_required' ? t('valetScanRequired')
          : t('valetFailed')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="handover-close" onPress={onDone} hitSlop={12}>
          <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
        <Text style={type.h2}>{t('valetScanQr')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error && <Text style={styles.error} testID="handover-error">{error}</Text>}
        {cameraBlocked && (
          <Pressable testID="handover-open-settings" style={styles.ghost} onPress={openAppSettings}>
            <Text style={styles.ghostText}>{t('valetOpenSettings')}</Text>
          </Pressable>
        )}

        {stage === 'scan' && (
          <View testID="handover-scanner" style={styles.scannerWrap}>
            {permission?.granted ? (
              <CameraView
                testID="handover-camera"
                style={styles.scanner}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onScanned}
              />
            ) : (
              <View style={styles.permissionBox}>
                <Text style={styles.hint}>{t('valetCameraDenied')}</Text>
                <Pressable testID="handover-grant" style={styles.cta} onPress={requestPermission}>
                  <Text style={styles.ctaText}>{t('valetGrantCamera')}</Text>
                </Pressable>
              </View>
            )}
            <Text style={styles.hint}>{t('valetScanHint')}</Text>
          </View>
        )}

        {stage === 'compare' && (
          ticket && !ticket.hasPhoto ? (
            <>
              {/* No photo was taken at intake — a guest may decline it, and a
                  denied camera must not strand a parked car. Saying so beats
                  an empty frame above a "Matches" button, which teaches a
                  guard to tap through and records a check that never ran. */}
              <View style={styles.noPhotoBox} testID="handover-no-photo">
                <MaterialCommunityIcons name="account-question-outline" size={22} color={colors.warning} />
                <Text style={styles.noPhotoTitle}>{t('valetNoPhotoTaken')}</Text>
              </View>

              <Text style={styles.hint}>{t('valetConfirmVehicleHint')}</Text>
              <View style={styles.detailBox}>
                <Text style={styles.detailLabel}>{t('valetMake')}</Text>
                <Text style={styles.detailValue} testID="handover-vehicle">{ticket.vehicleMake}</Text>
                <Text style={styles.detailLabel}>{t('valetPlate')}</Text>
                {/* Partly masked: reading the full plate aloud tells the person
                    the answer they are supposed to be producing. */}
                <Text style={styles.detailValue} testID="handover-plate">{maskPlate(ticket.plate)}</Text>
              </View>

              <Pressable
                testID="handover-vehicle-confirmed"
                style={styles.cta}
                onPress={() => { setVerification('vehicle_confirmed'); setStage('condition'); }}
              >
                <Text style={styles.ctaText}>{t('valetGuestConfirmed')}</Text>
              </Pressable>
              <Pressable testID="handover-hold" style={styles.ghost} onPress={onDone}>
                <Text style={styles.ghostText}>{t('valetCannotConfirm')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.label}>{t('valetCompareGuest')}</Text>
              <Image
                testID="handover-guest-photo"
                source={api.guestPhotoSource(sessionToken)}
                style={styles.guestPhoto}
                resizeMode="cover"
              />
              {/* No face-matching model runs. A human compares and decides. */}
              <Text style={styles.hint}>{t('valetCompareHint')}</Text>
              <Pressable
                testID="handover-match"
                style={styles.cta}
                onPress={() => { setVerification('photo'); setStage('condition'); }}
              >
                <Text style={styles.ctaText}>{t('valetMatches')}</Text>
              </Pressable>
            </>
          )
        )}

        {stage === 'condition' && (
          <>
            <Text style={styles.label}>{t('valetConditionReturn')}</Text>
            <View style={styles.angleGrid}>
              {ANGLES.map((angle) => {
                const done = captured.includes(angle);
                return (
                  <Pressable
                    key={angle}
                    testID={`handover-angle-${angle}`}
                    onPress={() => captureReturn(angle)}
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
              <Text style={styles.hint} testID="handover-condition-hint">
                {t('valetConditionRequired')}
              </Text>
            )}

            <Pressable
              testID="handover-to-confirm"
              disabled={captured.length === 0}
              onPress={() => setStage('confirm')}
              style={[styles.cta, captured.length === 0 && styles.ctaDisabled]}
            >
              <Text style={styles.ctaText}>{t('done')}</Text>
            </Pressable>
          </>
        )}

        {stage === 'confirm' && (
          <>
            <Text style={styles.label}>{t('valetConfirmTitle')}</Text>
            {busy && <ActivityIndicator color={colors.actionPrimary} />}

            {/* The default keeps a multi-day ticket alive: the same URL and QR
                go on working for the next pickup inside the stay window. */}
            <Pressable testID="handover-park-again" style={styles.cta} onPress={() => confirm(false)}>
              <Text style={styles.ctaText}>{t('valetParkAgain')}</Text>
            </Pressable>
            <Pressable testID="handover-final" style={styles.ghost} onPress={() => confirm(true)}>
              <Text style={styles.ghostText}>{t('valetFinalCheckout')}</Text>
            </Pressable>
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
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  content: { padding: spacing.lg, gap: spacing.md },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  scannerWrap: { gap: spacing.md },
  scanner: { width: '100%', aspectRatio: 1, borderRadius: radius.xl, overflow: 'hidden' },
  permissionBox: { padding: spacing.xl, alignItems: 'center', gap: spacing.md },
  guestPhoto: { width: '100%', aspectRatio: 1, borderRadius: radius.xl, backgroundColor: colors.card },
  hint: { color: colors.textTertiary, fontSize: 12, textAlign: 'center' },
  noPhotoBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md,
  },
  noPhotoTitle: { color: colors.warning, fontWeight: '700', fontSize: 14, flex: 1 },
  detailBox: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs,
  },
  detailLabel: {
    color: colors.textTertiary, fontSize: 11, fontWeight: '600',
    letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.sm,
  },
  detailValue: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  cta: {
    backgroundColor: colors.actionPrimary, borderRadius: radius.md,
    paddingVertical: spacing.lg, alignItems: 'center', marginTop: spacing.sm,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.bgPrimary, fontWeight: '700', fontSize: 16 },
  ghost: { paddingVertical: spacing.md, alignItems: 'center' },
  ghostText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  angleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  angleTile: {
    width: '47%', aspectRatio: 1.6, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  angleTileDone: { borderColor: colors.teal, backgroundColor: colors.successBg },
  angleText: { color: colors.textSecondary, fontSize: 12, textTransform: 'capitalize' },
});
