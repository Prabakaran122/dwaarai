import React from 'react';
import { View, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'hero';
  accent?: string;          // optional left-border status accent colour
  style?: ViewStyle;
  onPress?: () => void;
}

export default function Card({ children, variant = 'default', accent, style, onPress }: CardProps) {
  const content = (
    <View
      style={[
        styles.base,
        variant === 'hero' ? styles.hero : styles.default,
        accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
        {content}
      </Pressable>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, padding: spacing.lg },
  default: { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.surfaceBorder },
  hero: { backgroundColor: colors.brandPrimary },
});
