import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import * as api from '../api/valet';
import { uploadOrQueue } from '../lib/conditionQueue';
import { useT } from '../store/langStore';
import { takePhoto, openAppSettings } from '../lib/camera';
import { CONDITION_ANGLES, nextAngle } from '../lib/conditionAngles';
import { isStatusChanged } from '../lib/errors';
import { useValetStore } from '../store/valetStore';

/**
 * A multi-day guest has brought the car back.
 *
 * While they had it the ticket was 'with_guest': off the lot, holding no
 * slot. Whatever happened to the car happened in that time, so it comes back
 * in the way it first came in -- the same four condition views, in the same
 * order, as intake-stage photos. The service refuses the check-in without
 * them; this screen enforces the same rule so the valet never meets it as an
 * error.
 */
export default function ReturnCheckInScreen({
  sessionToken, onDone,
}: {
  sessionToken: string;
  onDone?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const t = useT();

  const [ticket, setTicket] = useState<api.TicketDetail | null>(null);
  const [captured, setCaptured] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getTicket(sessionToken)
      .then((res) => { if (!cancelled) setTicket(res.data); })
      .catch(() => { /* the plate is a courtesy here; the check-in still works */ });
    return () => { cancelled = true; };
  }, [sessionToken]);

  const next = nextAngle(captured);

  async function capture(angle: (typeof CONDITION_ANGLES)[number]) {
    // Never throws -- see lib/camera.
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
      // Queued rather than failed when offline, like every other capture.
      const up = await uploadOrQueue(sessionToken, res.uri, 'intake', 'photo', angle);
      // Neither uploaded nor safely queued: not captured. The angle stays the
      // live one, so tapping it again is the retake -- ticking it off here
      // used to let a set that was missing a photo look complete.
      if (!up.ok) {
        setError(t('valetPhotoNotSaved'));
        return;
      }
      setCaptured((prev) => [...prev, angle]);
      setError(null);
    } catch {
      setError(t('valetPhotoNotSaved'));
    } finally {
      setBusy(false);
    }
  }

  async function checkIn() {
    if (next !== null) return;
    setBusy(true);
    try {
      await api.checkInReturned(sessionToken);
      onDone?.();
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (isStatusChanged(err)) {
        // Another valet checked it in first. Nothing to retry; the queue
        // behind this screen is refreshed so closing it shows the truth.
        setError(t('valetStatusChanged'));
        void useValetStore.getState().fetch();
      } else {
        setError(code === 'condition_required' ? t('valetConditionAllFour') : t('valetFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="checkin-close" onPress={onDone} hitSlop={12}>
          <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
        <Text style={type.h2}>{t('valetCheckInTitle')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {ticket && (
          <View style={styles.detailBox}>
            <Text style={styles.detailValue}>{ticket.plate}</Text>
            <Text style={styles.label}>{ticket.vehicleMake}</Text>
          </View>
        )}

        {error && <Text style={styles.error} testID="checkin-error">{error}</Text>}
        {cameraBlocked && (
          <Pressable testID="checkin-open-settings" style={styles.ghost} onPress={openAppSettings}>
            <Text style={styles.ghostText}>{t('valetOpenSettings')}</Text>
          </Pressable>
        )}

        <Text style={styles.label}>{t('valetConditionIntake')}</Text>
        <View style={styles.angleGrid}>
          {CONDITION_ANGLES.map((angle) => {
            const done = captured.includes(angle);
            const isNext = angle === next;
            return (
              <Pressable
                key={angle}
                testID={`checkin-angle-${angle}`}
                disabled={!isNext || busy}
                onPress={() => capture(angle)}
                style={[styles.angleTile, done && styles.angleTileDone, !isNext && !done && styles.angleTileLocked]}
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

        {next !== null && (
          <Text style={styles.hint} testID="checkin-hint">{t('valetConditionAllFour')}</Text>
        )}

        <Pressable
          testID="checkin-done"
          disabled={next !== null || busy}
          onPress={checkIn}
          style={[styles.cta, (next !== null || busy) && styles.ctaDisabled]}
        >
          <Text style={styles.ctaText}>{t('valetCheckIn')}</Text>
        </Pressable>
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
  hint: { color: colors.textTertiary, fontSize: 12, textAlign: 'center' },
  detailBox: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs,
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
  angleTileLocked: { opacity: 0.35 },
  angleText: { color: colors.textSecondary, fontSize: 12, textTransform: 'capitalize' },
});
