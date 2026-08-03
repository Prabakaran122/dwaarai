import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { font } from '../theme/typography';
import { useT } from '../store/langStore';

export type TabKey = 'gate' | 'visitors' | 'parcels' | 'incident';

const TABS: { key: TabKey; labelKey: string; icon: string }[] = [
  { key: 'gate', labelKey: 'navGate', icon: 'gate' },
  { key: 'visitors', labelKey: 'navVisitors', icon: 'account-group' },
  { key: 'parcels', labelKey: 'navParcels', icon: 'package-variant' },
  { key: 'incident', labelKey: 'navIncident', icon: 'alert-circle' },
];

interface Props {
  active: TabKey;
  onSelect: (key: TabKey) => void;
}

export default function TabBar({ active, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  const t = useT();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom || spacing.sm }]}>
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <Pressable
            key={tab.key}
            testID={`tab-${tab.key}`}
            style={styles.tab}
            onPress={() => onSelect(tab.key)}
          >
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={22}
              color={isActive ? colors.actionPrimary : colors.textTertiary}
            />
            <Text style={[styles.label, isActive && styles.labelActive]}>{t(tab.labelKey)}</Text>
            {isActive && <View style={styles.dot} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: spacing.xs, gap: 2 },
  label: { ...font(500), fontSize: 10, color: colors.textTertiary },
  labelActive: { color: colors.actionPrimary },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.actionPrimary, marginTop: 2 },
});
