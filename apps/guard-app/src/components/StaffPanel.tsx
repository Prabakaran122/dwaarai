import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import AnimatedEntry from './AnimatedEntry';
import { useStaffStore } from '../store/staffStore';
import { useT } from '../store/langStore';

const ROLE_ICONS: Record<string, string> = {
  maid: 'broom', cook: 'chef-hat', driver: 'car', tutor: 'book-open-variant', newspaper: 'newspaper', other: 'account',
};

// Fast morning check-in for daily staff — one tap, no camera (the rush-hour pain).
export default function StaffPanel() {
  const { roster, loading, checkingIn, fetch, checkIn } = useStaffStore();
  const [search, setSearch] = useState('');
  const t = useT();

  useEffect(() => { fetch(); }, []);

  if (!loading && roster.length === 0) {
    return (
      <GlowCard style={styles.card}>
        <Text style={styles.label}>{t('staffCheckin')}</Text>
        <Text style={styles.empty}>{t('noStaff')}</Text>
      </GlowCard>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? roster.filter((m) => m.name.toLowerCase().includes(q) || m.unitNumber.toLowerCase().includes(q))
    : roster;
  const pending = filtered.filter((m) => !m.arrived).length;

  const handleCheckIn = async (passId: string) => {
    try { await checkIn(passId); }
    catch (err: any) { Alert.alert(t('error'), err?.response?.data?.error?.message || 'Check-in failed'); }
  };

  return (
    <GlowCard style={styles.card}>
      <Text style={styles.label}>{t('staffCheckin')} ({pending})</Text>
      {roster.length > 6 && (
        <TextInput
          style={styles.search}
          placeholder={t('searchStaff')}
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      )}
      {filtered.map((m, i) => (
        <AnimatedEntry key={m.passId} direction="fade" delay={Math.min(i, 8) * 30}>
          <View style={styles.row}>
            <MaterialCommunityIcons name={(ROLE_ICONS[m.role || 'other'] || 'account') as any} size={18} color={colors.info} />
            <View style={styles.info}>
              <Text style={styles.name}>{m.name}</Text>
              <Text style={styles.detail}>Flat {m.unitNumber}{m.role ? ` · ${m.role}` : ''}</Text>
            </View>
            {m.arrived ? (
              <View style={[styles.btn, styles.btnDone]}><Text style={styles.btnDoneText}>{t('checkedIn')}</Text></View>
            ) : (
              <TouchableOpacity
                style={styles.btn}
                onPress={() => handleCheckIn(m.passId)}
                disabled={checkingIn === m.passId}
                activeOpacity={0.8}
              >
                <Text style={styles.btnText}>{t('checkIn')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </AnimatedEntry>
      ))}
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.xs },
  empty: { fontSize: 13, color: colors.textMuted },
  search: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14, color: colors.textPrimary, marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  detail: { fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize' },
  btn: { backgroundColor: colors.success, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, minWidth: 64, alignItems: 'center' },
  btnText: { color: colors.white, fontSize: 14, fontWeight: '800' },
  btnDone: { backgroundColor: colors.successBg },
  btnDoneText: { color: colors.success, fontSize: 13, fontWeight: '700' },
});
