import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';

export interface QuickAction {
  key: string;
  label: string;
  sub: string;
  icon: string;
  onPress: () => void;
}

export function QuickActionCard({ action }: { action: QuickAction }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={action.onPress}
      testID={`qa-${action.key}`}
    >
      <MaterialCommunityIcons name={action.icon as any} size={22} color={colors.brandPrimary} />
      <Text style={styles.label}>{action.label}</Text>
      <Text style={styles.sub}>{action.sub}</Text>
    </Pressable>
  );
}

export default function QuickActionGrid({ actions }: { actions: QuickAction[] }) {
  return (
    <View style={styles.grid}>
      {actions.map((a) => (
        <QuickActionCard key={a.key} action={a} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    width: '31%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  pressed: { opacity: 0.85 },
  label: { ...font(500), fontSize: 12, color: colors.textPrimary },
  sub: { ...font(400), fontSize: 10, color: colors.textTertiary },
});
