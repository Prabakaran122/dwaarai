import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { useT } from '../store/langStore';

interface Props {
  name: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

export default function TabPlaceholder({ name, icon }: Props) {
  const t = useT();
  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name={icon} size={48} color={colors.actionPrimary} />
      <Text style={[type.h2, styles.title]}>{name}</Text>
      <Text style={type.bodySecondary}>{t('comingInThisRedesign')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.bgPrimary },
  title: { marginTop: spacing.lg },
});
