import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';
import PlateText from './PlateText';
import { useT } from '../store/langStore';
import type { QueueEntry } from '../store/queueStore';

interface Props {
  entry: QueueEntry | null;
  onPress?: () => void;
}

// Smart alert banner (NAZ-004) — surfaces the newest approaching vehicle
// (FASTag/ANPR read) at the top of Gate Home. Renders nothing when idle.
// Tapping it opens the triple-layer verification screen (BRD: "the guard taps
// the active vehicle card to enter the verification flow").
export default function AlertBanner({ entry, onPress }: Props) {
  const t = useT();
  if (!entry) return null;

  return (
    <Pressable testID="alert-banner" style={styles.banner} onPress={onPress}>
      <MaterialCommunityIcons name="car-connected" size={22} color={colors.actionPrimary} />
      <View style={styles.body}>
        <Text style={styles.title}>{t('vehicleApproaching')}</Text>
        <View style={styles.row}>
          <PlateText plate={entry.plate} size="sm" />
          {(entry.unitNumber || entry.residentName) && (
            <Text style={styles.meta} numberOfLines={1}>
              {[entry.unitNumber, entry.residentName].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderLeftWidth: 4,
    borderLeftColor: colors.actionPrimary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  body: { flex: 1, gap: spacing.xs },
  title: { ...font(700), fontSize: 12, color: colors.actionPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meta: { ...font(400), fontSize: 12, color: colors.textSecondary, flexShrink: 1 },
});
