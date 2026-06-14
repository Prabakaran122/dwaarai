import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { font } from '../../theme/typography';

interface Props {
  title: string;
  onBack?: () => void;
  bellCount?: number;
  onBell?: () => void;
}

export default function AppBar({ title, onBack, bellCount, onBell }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} style={styles.side}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textInverse} />
        </Pressable>
      ) : (
        <View style={styles.side} />
      )}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {onBell ? (
        <Pressable onPress={onBell} hitSlop={8} style={styles.side}>
          <MaterialCommunityIcons name="bell-outline" size={22} color={colors.textInverse} />
          {!!bellCount && bellCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{bellCount > 9 ? '9+' : bellCount}</Text>
            </View>
          )}
        </Pressable>
      ) : (
        <View style={styles.side} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  side: { width: 40, height: 28, alignItems: 'center', justifyContent: 'center' },
  title: { ...font(500), fontSize: 22, color: colors.textInverse, flex: 1, textAlign: 'center' },
  badge: {
    position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.notifBadge, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { ...font(700), fontSize: 9, color: colors.textInverse },
});
