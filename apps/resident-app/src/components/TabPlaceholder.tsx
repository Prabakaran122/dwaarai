import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar } from './ui';

interface Props {
  name: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

export default function TabPlaceholder({ name, icon }: Props) {
  return (
    <View style={styles.container}>
      <AppBar title={name} />
      <View style={styles.center}>
        <MaterialCommunityIcons name={icon} size={48} color={colors.brandPrimary} />
        <Text style={[type.h2, styles.title]}>{name}</Text>
        <Text style={type.bodySecondary}>Coming in this redesign</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  title: { marginTop: spacing.lg },
});
