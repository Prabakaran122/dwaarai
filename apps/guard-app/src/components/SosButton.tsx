import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { useSosStore, SosType } from '../store/sosStore';
import { useT } from '../store/langStore';

const TYPES: { type: SosType; key: string; icon: string }[] = [
  { type: 'medical', key: 'sosMedical', icon: 'medical-bag' },
  { type: 'fire', key: 'sosFire', icon: 'fire' },
  { type: 'security', key: 'sosSecurity', icon: 'shield-alert' },
  { type: 'other', key: 'sosOther', icon: 'alert' },
];

const CANCEL_WINDOW_SECONDS = 5;

// Large, one-thumb SOS button. Tapping opens a 2-tap type chooser; picking a
// type does not raise immediately -- NAZ-064 gives the guard a 5-second
// cancel window (shown as a countdown) before the alert actually fires, so
// a wrong tap under pressure doesn't page the whole committee.
export default function SosButton() {
  const [open, setOpen] = useState(false);
  const [pendingType, setPendingType] = useState<SosType | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(CANCEL_WINDOW_SECONDS);
  const raise = useSosStore((s) => s.raise);
  const raising = useSosStore((s) => s.raising);
  const t = useT();

  // One interval per countdown (not a chain of setTimeouts) so every tick
  // fires on its own schedule rather than depending on a render having
  // already happened to re-arm the next timer.
  useEffect(() => {
    if (!pendingType) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingType]);

  useEffect(() => {
    if (!pendingType || secondsLeft > 0) return;
    const type = pendingType;
    setPendingType(null);
    setOpen(false);
    raise(type).catch((err: any) => {
      Alert.alert(t('error'), err?.response?.data?.error?.message || 'SOS failed');
    });
  }, [secondsLeft, pendingType]);

  const pickType = (type: SosType) => {
    setPendingType(type);
    setSecondsLeft(CANCEL_WINDOW_SECONDS);
  };

  const cancel = () => {
    setPendingType(null);
    setOpen(false);
  };

  const close = () => {
    setOpen(false);
    setPendingType(null);
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} disabled={raising}>
        <View style={styles.sosBtn}>
          <MaterialCommunityIcons name="alarm-light" size={20} color={colors.white} />
          <Text style={styles.sosBtnText}>{t('sos')}</Text>
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.overlay} onPress={pendingType ? undefined : close}>
          <View style={styles.sheet}>
            {!pendingType ? (
              <>
                <Text style={styles.sheetTitle}>{t('raiseEmergency')}</Text>
                <View style={styles.grid}>
                  {TYPES.map((it) => (
                    <Pressable key={it.type} style={styles.typeBtn} onPress={() => pickType(it.type)}>
                      <MaterialCommunityIcons name={it.icon as any} size={30} color={colors.white} />
                      <Text style={styles.typeText}>{t(it.key)}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.countdownWrap}>
                <Text testID="sos-countdown" style={styles.countdownNumber}>{secondsLeft}</Text>
                <Text style={styles.sheetTitle}>{t(TYPES.find((it) => it.type === pendingType)!.key)}</Text>
                <Pressable testID="sos-cancel-button" style={styles.cancelBtn} onPress={cancel}>
                  <Text style={styles.cancelBtnText}>{t('cancel')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sosBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.danger, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  sosBtnText: { color: colors.white, fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  sheet: { width: 420, maxWidth: '90%', backgroundColor: colors.bgPrimary, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' },
  typeBtn: {
    width: '46%', aspectRatio: 1.9, backgroundColor: colors.danger, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  typeText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  countdownWrap: { alignItems: 'center', gap: spacing.md },
  countdownNumber: { fontSize: 64, fontWeight: '900', color: colors.danger },
  cancelBtn: { backgroundColor: colors.elevated, borderRadius: radius.pill, paddingHorizontal: spacing['2xl'], paddingVertical: spacing.md },
  cancelBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
