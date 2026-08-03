import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';

interface Props {
  title: string;
  icon: string;
  accentColor: string;
  children: React.ReactNode;
}

// One verification layer (FASTag / ANPR / Face) on the triple-layer screen
// (BRD §5.2) — a bordered card with a color-coded left accent per layer.
export default function LayerCard({ title, icon, accentColor, children }: Props) {
  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>
      <View style={styles.header}>
        <MaterialCommunityIcons name={icon as any} size={18} color={accentColor} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...font(700), fontSize: 13, color: colors.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  body: { gap: spacing.xs },
});
