import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Alert } from 'react-native';
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

// Large, one-thumb SOS button. Tapping opens a 2-tap type chooser to prevent
// accidental triggers without burying the action behind a tiny dialog.
export default function SosButton() {
  const [open, setOpen] = useState(false);
  const raise = useSosStore((s) => s.raise);
  const raising = useSosStore((s) => s.raising);
  const t = useT();

  const trigger = async (type: SosType) => {
    setOpen(false);
    try {
      await raise(type);
    } catch (err: any) {
      Alert.alert(t('error'), err?.response?.data?.error?.message || 'SOS failed');
    }
  };

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} activeOpacity={0.85} disabled={raising}>
        <View style={styles.sosBtn}>
          <MaterialCommunityIcons name="alarm-light" size={20} color={colors.white} />
          <Text style={styles.sosBtnText}>{t('sos')}</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('raiseEmergency')}</Text>
            <View style={styles.grid}>
              {TYPES.map((it) => (
                <TouchableOpacity key={it.type} style={styles.typeBtn} activeOpacity={0.85} onPress={() => trigger(it.type)}>
                  <MaterialCommunityIcons name={it.icon as any} size={30} color={colors.white} />
                  <Text style={styles.typeText}>{t(it.key)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
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
  sheet: { width: 420, maxWidth: '90%', backgroundColor: colors.bgPrimary, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.surfaceBorder },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' },
  typeBtn: {
    width: '46%', aspectRatio: 1.9, backgroundColor: colors.danger, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  typeText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
