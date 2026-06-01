import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import AnimatedEntry from './AnimatedEntry';
import { useDeliveryStore } from '../store/deliveryStore';
import { useT } from '../store/langStore';

const COMPANIES = ['Amazon', 'Flipkart', 'Swiggy', 'Zomato', 'BigBasket', 'Other'];

export default function DeliveryPanel() {
  const { active, logging, fetchActive, log, updateStatus } = useDeliveryStore();
  const [expanded, setExpanded] = useState(false);
  const [company, setCompany] = useState('');
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');
  const t = useT();

  useEffect(() => { fetchActive(); }, []);

  const reset = () => { setCompany(''); setUnit(''); setNote(''); setExpanded(false); };

  const submit = async () => {
    if (!company || !unit.trim()) return;
    try {
      await log(unit.trim(), company, note.trim() || undefined);
      reset();
    } catch (err: any) {
      Alert.alert(t('error'), err?.response?.data?.error?.message || t('failDelivery'));
    }
  };

  return (
    <>
      {/* Active deliveries */}
      {active.length > 0 && (
        <GlowCard style={styles.card}>
          <Text style={styles.label}>{t('deliveriesWaiting')} ({active.length})</Text>
          {active.map((d, i) => (
            <AnimatedEntry key={d.id} direction="fade" delay={i * 50}>
              <View style={styles.row}>
                <MaterialCommunityIcons name="package-variant" size={20} color={colors.info} />
                <View style={styles.info}>
                  <Text style={styles.company}>{d.company}</Text>
                  <Text style={styles.detail}>{d.unitNumber ? `Flat ${d.unitNumber}` : ''}{d.note ? ` · ${d.note}` : ''}</Text>
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity style={styles.miniBtn} onPress={() => updateStatus(d.id, 'delivered').catch(() => {})}>
                    <Text style={styles.miniBtnText}>{t('delivered')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.miniBtn, styles.miniBtnAlt]} onPress={() => updateStatus(d.id, 'left_at_gate').catch(() => {})}>
                    <Text style={[styles.miniBtnText, { color: colors.warning }]}>{t('leftAtGate')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </AnimatedEntry>
          ))}
        </GlowCard>
      )}

      {/* Log form / button */}
      {!expanded ? (
        <TouchableOpacity onPress={() => setExpanded(true)} activeOpacity={0.7}>
          <GlowCard style={styles.button}>
            <View style={styles.buttonRow}>
              <MaterialCommunityIcons name="package-variant-closed" size={18} color={colors.info} />
              <Text style={styles.buttonText}>{t('logDelivery')}</Text>
            </View>
          </GlowCard>
        </TouchableOpacity>
      ) : (
        <GlowCard style={styles.card}>
          <Text style={styles.label}>{t('newDelivery')}</Text>
          <View style={styles.chipGrid}>
            {COMPANIES.map((c) => (
              <TouchableOpacity key={c} onPress={() => setCompany(c)}>
                {company === c ? (
                  <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.chip}>
                    <Text style={styles.chipTextActive}>{c}</Text>
                  </LinearGradient>
                ) : (
                  <View style={styles.chipInactive}><Text style={styles.chipText}>{c}</Text></View>
                )}
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={t('unitNumber')}
            placeholderTextColor={colors.textMuted}
            value={unit}
            onChangeText={setUnit}
            autoCapitalize="characters"
          />
          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <GradientButton title={t('cancel')} variant="danger" onPress={reset} />
            </View>
            <View style={{ flex: 1 }}>
              <GradientButton title={t('send')} variant="success" icon="bell-ring" onPress={submit} loading={logging} disabled={!company || !unit.trim()} />
            </View>
          </View>
        </GlowCard>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  button: {},
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  buttonText: { color: colors.info, fontSize: 14, fontWeight: '700' },
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
  info: { flex: 1 },
  company: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  detail: { fontSize: 12, color: colors.textSecondary },
  rowActions: { gap: 4 },
  miniBtn: { backgroundColor: colors.successBg, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  miniBtnAlt: { backgroundColor: colors.warningBg },
  miniBtnText: { fontSize: 11, fontWeight: '700', color: colors.success },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  chipInactive: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextActive: { color: colors.white, fontSize: 12, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.sm,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
