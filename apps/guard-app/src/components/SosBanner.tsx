import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useSosStore, SosType } from '../store/sosStore';
import { useT } from '../store/langStore';

const TYPE_KEY: Record<SosType, string> = {
  medical: 'sosMedical', fire: 'sosFire', security: 'sosSecurity', other: 'sosOther',
};

// Full-width red banner(s) shown across the top when any SOS is active in the
// community — every guard sees it, readable from arm's length.
export default function SosBanner() {
  const active = useSosStore((s) => s.active);
  const resolve = useSosStore((s) => s.resolve);
  const t = useT();

  if (active.length === 0) return null;

  return (
    <View>
      {active.map((a) => (
        <View key={a.id} style={styles.banner}>
          <MaterialCommunityIcons name="alarm-light" size={22} color={colors.white} />
          <View style={styles.info}>
            <Text style={styles.title}>
              {t('sosActive')} · {t(TYPE_KEY[a.type])}
            </Text>
            <Text style={styles.detail}>
              {a.raisedByName || ''}{a.gateId ? ` · ${t('atGate')} ${a.gateId.slice(0, 8)}` : ''}
            </Text>
          </View>
          <TouchableOpacity style={styles.resolveBtn} onPress={() => resolve(a.id).catch(() => {})} activeOpacity={0.85}>
            <Text style={styles.resolveText}>{t('resolve')}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.danger, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  info: { flex: 1 },
  title: { color: colors.white, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  detail: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },
  resolveBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 8 },
  resolveText: { color: colors.white, fontSize: 14, fontWeight: '700' },
});
