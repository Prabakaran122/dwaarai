// apps/guard-app/src/components/GlowCard.tsx
import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { radius } from '../theme/spacing';

type Variant = 'default' | 'success' | 'danger' | 'warning';

interface GlowCardProps {
  children: React.ReactNode;
  variant?: Variant;
  style?: ViewStyle;
  onPress?: () => void;
}

const borderColors: Record<Variant, readonly [string, string]> = {
  default: ['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)'],
  success: ['rgba(34,197,94,0.4)', 'rgba(16,185,129,0.1)'],
  danger: ['rgba(239,68,68,0.4)', 'rgba(220,38,38,0.1)'],
  warning: ['rgba(251,191,36,0.4)', 'rgba(245,158,11,0.1)'],
};

export default function GlowCard({ children, variant = 'default', style }: GlowCardProps) {
  return (
    <LinearGradient
      colors={borderColors[variant] as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.border, style]}
    >
      <View style={styles.inner}>
        {children}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  border: {
    borderRadius: radius.lg,
    padding: 1,
  },
  inner: {
    backgroundColor: colors.bgPrimary,
    borderRadius: radius.lg - 1,
    padding: 16,
  },
});
