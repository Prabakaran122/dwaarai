import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import type { UnitPet } from '../store/unitStore';

const ICON: Record<string, string> = { dog: 'dog', cat: 'cat', bird: 'bird', rabbit: 'rabbit', other: 'paw' };

export default function PetRow({ pet }: { pet: UnitPet }) {
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons name={(ICON[pet.species] || 'paw') as any} size={22} color={colors.brandPrimary} />
      <View style={styles.mid}>
        <Text style={type.body}>{pet.name}</Text>
        {!!pet.breed && <Text style={type.micro}>{pet.breed}</Text>}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  mid: { flex: 1, gap: 2 },
});
