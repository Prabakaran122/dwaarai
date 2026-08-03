import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type, font } from '../theme/typography';
import { useDeliveryStore, type Delivery } from '../store/deliveryStore';
import { isOverstayed } from '../lib/delivery';
import { useT } from '../store/langStore';

// BRD NAZ-046: "dropdown including Zomato, Swiggy, Zepto, Blinkit, Flipkart, Amazon, Other".
const SOURCES = ['Zomato', 'Swiggy', 'Zepto', 'Blinkit', 'Flipkart', 'Amazon', 'Other'];

export default function ParcelsScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { active, logging, fetchActive, log, updateStatus } = useDeliveryStore();
  const [expanded, setExpanded] = useState(false);
  const [source, setSource] = useState('');
  const [unit, setUnit] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  useEffect(() => { fetchActive(); }, []);

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    setPhotoUri(shot.assets[0].uri);
  };

  const reset = () => { setSource(''); setUnit(''); setPhotoUri(null); setExpanded(false); };

  const submit = async () => {
    if (!source || !unit.trim()) return;
    try {
      await log(unit.trim(), source, undefined, photoUri || undefined);
      reset();
    } catch (err: any) {
      Alert.alert(t('error'), err?.response?.data?.error?.message || t('failDelivery'));
    }
  };

  const collect = (d: Delivery) => {
    updateStatus(d.id, 'delivered').catch(() => Alert.alert(t('error'), t('failDelivery')));
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={type.h2}>{t('navParcels')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {active.map((d) => {
          const overstay = d.status === 'waiting' && isOverstayed(d.createdAt);
          return (
            <View key={d.id} style={[styles.row, overstay && styles.rowOverstayed]}>
              <MaterialCommunityIcons name="package-variant" size={22} color={overstay ? colors.danger : colors.actionPrimary} />
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>{d.company}{d.unitNumber ? ` · ${d.unitNumber}` : ''}</Text>
                <Text style={styles.rowMeta}>{new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
              {overstay && (
                <View testID={`overstay-chip-${d.id}`} style={styles.overstayChip}>
                  <Text style={styles.overstayChipText}>{t('overstayed')}</Text>
                </View>
              )}
              <Pressable testID={`mark-collected-${d.id}`} style={styles.collectBtn} onPress={() => collect(d)}>
                <Text style={styles.collectBtnText}>{t('delivered')}</Text>
              </Pressable>
            </View>
          );
        })}

        {!expanded ? (
          <Pressable style={styles.logBtn} onPress={() => setExpanded(true)}>
            <MaterialCommunityIcons name="package-variant-closed" size={18} color={colors.actionPrimary} />
            <Text style={styles.logBtnText}>{t('logDelivery')}</Text>
          </Pressable>
        ) : (
          <View style={styles.form}>
            <View style={styles.chipGrid}>
              {SOURCES.map((s) => (
                <Pressable key={s} style={[styles.chip, source === s && styles.chipActive]} onPress={() => setSource(s)}>
                  <Text style={[styles.chipText, source === s && styles.chipTextActive]}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              testID="delivery-unit-input"
              style={styles.input}
              placeholder={t('unitNumber')}
              placeholderTextColor={colors.textTertiary}
              value={unit}
              onChangeText={setUnit}
              autoCapitalize="characters"
            />
            <Pressable testID="delivery-photo-button" style={styles.photoBtn} onPress={takePhoto}>
              <MaterialCommunityIcons name="camera" size={16} color={colors.actionPrimary} />
              <Text style={styles.photoBtnText}>{photoUri ? t('retakePhoto') : t('takePhoto')}</Text>
            </Pressable>
            <View style={styles.formActions}>
              <Pressable style={styles.secondaryBtn} onPress={reset}>
                <Text style={styles.secondaryBtnText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={submit} disabled={!source || !unit.trim() || logging}>
                <Text style={styles.primaryBtnText}>{t('send')}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  content: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
  },
  rowOverstayed: { borderColor: colors.danger },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { ...font(700), fontSize: 14, color: colors.textPrimary },
  rowMeta: { ...font(400), fontSize: 11, color: colors.textSecondary },
  overstayChip: { backgroundColor: 'rgba(248,113,113,0.15)', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  overstayChipText: { ...font(700), fontSize: 10, color: colors.danger },
  collectBtn: { backgroundColor: 'rgba(0,191,166,0.15)', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  collectBtnText: { ...font(700), fontSize: 11, color: colors.teal },
  logBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  logBtnText: { ...font(500), fontSize: 13, color: colors.actionPrimary },
  form: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated },
  chipActive: { borderColor: colors.actionPrimary, backgroundColor: 'rgba(245,158,11,0.15)' },
  chipText: { ...font(400), fontSize: 12, color: colors.textSecondary },
  chipTextActive: { color: colors.actionPrimary, ...font(700) },
  input: { backgroundColor: colors.elevated, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, fontSize: 15, color: colors.textPrimary },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', padding: spacing.xs },
  photoBtnText: { ...font(500), fontSize: 12, color: colors.actionPrimary },
  formActions: { flexDirection: 'row', gap: spacing.sm },
  secondaryBtn: { flex: 1, alignItems: 'center', padding: spacing.sm },
  secondaryBtnText: { ...font(500), fontSize: 13, color: colors.danger },
  primaryBtn: { flex: 1, alignItems: 'center', padding: spacing.sm, backgroundColor: colors.teal, borderRadius: radius.md },
  primaryBtnText: { ...font(700), fontSize: 13, color: colors.white },
});
