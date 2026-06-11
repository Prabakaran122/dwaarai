import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { radius, spacing } from '../theme/spacing';

type Size = 'sm' | 'md' | 'lg';

interface Props {
  plate: string;
  size?: Size;
}

// IND yellow number-plate look (Brief: vehicles show plates in IND plate format).
export default function PlateText({ plate, size = 'md' }: Props) {
  return (
    <View style={[styles.plate, size === 'sm' && styles.plateSm]}>
      <Text style={[styles.text, size === 'sm' && styles.textSm, size === 'lg' && styles.textLg]}>
        {plate.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    backgroundColor: '#F4C430', borderRadius: radius.sm, borderWidth: 1, borderColor: '#1B1B1B',
    paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start',
  },
  plateSm: { paddingHorizontal: 6 },
  text: {
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
    fontSize: 15, fontWeight: '700', letterSpacing: 1, color: '#1B1B1B',
  },
  textSm: { fontSize: 12 },
  textLg: { fontSize: 20 },
});
