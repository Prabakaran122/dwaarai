import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors } from '../theme/colors';
import { font } from '../theme/typography';
import { useT } from '../store/langStore';
import { startShift, listValetPoints } from '../api/valet';

/**
 * BRD Screen 1b — "Verify it's you".
 *
 * One front-camera photo, once per shift, taken straight after sign-in with
 * no step in between. It auto-advances on capture: a valet at six in the
 * morning should not have to find a "continue" button after already agreeing
 * to be photographed.
 *
 * It never blocks. A denied permission, a dead camera, a failed upload and a
 * face the recogniser does not know all end the same way — the shift starts.
 * The service records verified/confidence/reason for a manager to look at,
 * which is the whole point: an attendant who cannot be verified in bad light
 * still has cars to park, and stranding them is a worse failure than an
 * unverified sign-in.
 */
export default function ShiftStartScreen({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const camera = useRef<CameraView>(null);

  // Which door they are working. A venue with one entrance never defines any,
  // so this stays empty and the shift is recorded without one -- blocking a
  // shift over a list a property has not filled in would strand them.
  const [points, setPoints] = useState<{ id: string; name: string }[]>([]);
  const [point, setPoint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Wrapped in Promise.resolve, not called bare: this screen must never be
    // the thing that stops a shift, and a client that throws synchronously or
    // returns a non-promise would crash it into the error boundary. An
    // attendant at six in the morning would see a crash screen instead of a
    // camera, which is the exact failure the rest of this screen is built to
    // avoid.
    Promise.resolve()
      .then(() => listValetPoints())
      .then((r) => { if (!cancelled) setPoints(r?.points ?? []); })
      .catch(() => { /* a shift must never wait on this list */ });
    return () => { cancelled = true; };
  }, []);
  // Guards against a double-advance: the capture path and the skip path both
  // call onDone, and a slow upload leaves the button tappable.
  const finished = useRef(false);

  useEffect(() => {
    // Asked once, on arrival. The BRD has this screen follow sign-in with no
    // intermediate tap, so the prompt belongs here rather than behind a
    // button somebody has to discover.
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) requestPermission();
  }, [permission?.granted, permission?.canAskAgain]);

  function finish() {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }

  async function capture() {
    if (busy || finished.current) return;
    setBusy(true);
    try {
      const shot = await camera.current?.takePictureAsync({ base64: true, quality: 0.6 });
      // Sent even if the recogniser has nothing to compare it to: the record
      // of an attempt is worth keeping, and the service says which of the
      // outcomes it was.
      await startShift(shot?.base64 ?? undefined, point ?? undefined);
    } catch {
      // A failed capture or a failed upload is not a reason to keep someone
      // off their own shift.
    } finally {
      setBusy(false);
      finish();
    }
  }

  async function skip() {
    if (busy || finished.current) return;
    setBusy(true);
    try {
      // Still recorded, as a shift with no photo rather than no shift.
      await startShift(undefined, point ?? undefined);
    } catch {
      /* same reasoning as above */
    } finally {
      setBusy(false);
      finish();
    }
  }

  const canShoot = permission?.granted === true;

  return (
    <View style={styles.root} testID="shift-start">
      <Text style={styles.title}>{t('valetShiftTitle')}</Text>
      <Text style={styles.hint}>{t('valetShiftHint')}</Text>

      {points.length > 0 && (
        <View style={styles.points} testID="shift-points">
          <Text style={styles.pointsLabel}>{t('valetShiftWhere')}</Text>
          <View style={styles.pointRow}>
            {points.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setPoint(p.name)}
                style={[styles.point, point === p.name && styles.pointOn]}
              >
                <Text style={[styles.pointText, point === p.name && styles.pointTextOn]}>
                  {p.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.frame}>
        {canShoot ? (
          <CameraView ref={camera} testID="shift-camera" style={styles.camera} facing="front" />
        ) : (
          /* A labelled placeholder, not a blank box: the BRD asks for the
             flow never to be blocked by a missing permission, and a valet
             should be able to tell the difference between "loading" and
             "there is no camera". */
          <View style={styles.placeholder} testID="shift-no-camera">
            <Text style={styles.placeholderText}>{t('valetShiftNoCamera')}</Text>
          </View>
        )}
      </View>

      {busy ? (
        <ActivityIndicator color={colors.actionPrimary} style={styles.spinner} />
      ) : (
        <>
          {canShoot && (
            <Pressable testID="shift-capture" style={styles.cta} onPress={capture}>
              <Text style={styles.ctaText}>{t('valetShiftTake')}</Text>
            </Pressable>
          )}
          <Pressable testID="shift-skip" style={styles.skip} onPress={skip}>
            <Text style={styles.skipText}>{t('valetShiftSkip')}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { ...font(700), fontSize: 22, color: colors.textPrimary, textAlign: 'center' },
  hint: { ...font(400), fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 6 },
  points: { marginTop: 20 },
  pointsLabel: { ...font(500), fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  pointRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 10 },
  point: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  pointOn: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  pointText: { ...font(500), fontSize: 14, color: colors.textMuted },
  pointTextOn: { color: colors.bgPrimary, fontWeight: '700' },
  frame: {
    marginTop: 24, height: 320, borderRadius: 20, overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  placeholderText: { ...font(400), fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  spinner: { marginTop: 28 },
  cta: {
    marginTop: 28, backgroundColor: colors.actionPrimary,
    paddingVertical: 16, borderRadius: 14, alignItems: 'center',
  },
  ctaText: { ...font(700), fontSize: 16, color: colors.bgPrimary },
  skip: { marginTop: 14, paddingVertical: 12, alignItems: 'center' },
  skipText: { ...font(500), fontSize: 14, color: colors.textMuted },
});
