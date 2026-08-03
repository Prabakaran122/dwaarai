import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';

export interface QuickAction {
  key: string;
  label: string;
  icon: string;
  onPress: () => void;
}

// 2x2 quick actions grid on Gate Home (NAZ-006).
export default function QuickActionGrid({ actions }: { actions: QuickAction[] }) {
  return (
    <View style={styles.grid}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          testID={`quick-action-${a.key}`}
          style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
          onPress={a.onPress}
        >
          <MaterialCommunityIcons name={a.icon as any} size={24} color={colors.actionPrimary} />
          <Text style={styles.label}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  pressed: { opacity: 0.8 },
  label: { ...font(500), fontSize: 13, color: colors.textPrimary },
});
