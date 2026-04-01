// apps/guard-app/src/components/PlateText.tsx
import React from 'react';
import { Text, StyleSheet, Platform } from 'react-native';
import { colors } from '../theme/colors';

type Size = 'sm' | 'md' | 'lg';

interface PlateTextProps {
  plate: string;
  size?: Size;
}

const fontSizes: Record<Size, number> = { sm: 14, md: 16, lg: 24 };

export default function PlateText({ plate, size = 'md' }: PlateTextProps) {
  return (
    <Text style={[styles.text, { fontSize: fontSizes[size] }]}>
      {plate}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
