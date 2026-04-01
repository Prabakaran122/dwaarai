// apps/guard-app/src/components/IconBadge.tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface IconBadgeProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  gradientColors: readonly [string, string];
  size?: number;
}

export default function IconBadge({ icon, color, gradientColors, size = 40 }: IconBadgeProps) {
  return (
    <LinearGradient
      colors={gradientColors as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.container, { width: size, height: size, borderRadius: size * 0.25 }]}
    >
      <MaterialCommunityIcons name={icon} size={size * 0.5} color={color} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
