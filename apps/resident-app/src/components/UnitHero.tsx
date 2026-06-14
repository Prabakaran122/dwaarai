import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';
import { StatusBadge } from './ui';
import type { UnitProfile } from '../store/unitStore';

export default function UnitHero({ unit }: { unit: NonNullable<UnitProfile['unit']> }) {
  const locationBits = [
    unit.floor != null ? `Floor ${unit.floor}` : null,
    unit.wing ? `Wing ${unit.wing}` : null,
    unit.ownershipType ? (unit.ownershipType === 'owner' ? 'Owner' : 'Tenant') : null,
  ].filter(Boolean).join(' · ');
  return (
    <View style={styles.card}>
      <Text style={styles.unit}>{unit.unitNumber}</Text>
      {!!locationBits && <Text style={styles.sub}>{locationBits}</Text>}
      <Text style={styles.community}>{unit.communityName}</Text>
      {unit.verified && <View style={styles.badge}><StatusBadge preset="verified" label="Verified" size="sm" /></View>}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg, gap: 2 },
  unit: { ...font(700), fontSize: 28, color: colors.textInverse },
  sub: { ...font(400), fontSize: 13, color: colors.mist },
  community: { ...font(400), fontSize: 13, color: colors.teal, marginTop: 2 },
  badge: { marginTop: spacing.sm },
});
