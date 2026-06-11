import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { font } from '../../theme/typography';

const SIZES = { sm: 32, md: 44, lg: 64 } as const;

interface Props {
  name?: string;
  uri?: string;
  size?: keyof typeof SIZES;
}

function initials(name?: string): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
}

export default function Avatar({ name, uri, size = 'md' }: Props) {
  const d = SIZES[size];
  const base = { width: d, height: d, borderRadius: d / 2 };
  if (uri) return <Image source={{ uri }} style={base} />;
  return (
    <View style={[base, styles.fallback]}>
      <Text style={[styles.initials, { fontSize: d * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  initials: { ...font(700), color: colors.brandPrimary },
});
