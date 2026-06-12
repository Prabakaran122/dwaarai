import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { StatusBadge } from './ui';
import PlateText from './PlateText';
import type { UnitVehicle } from '../store/unitStore';

export default function VehicleRow({ vehicle }: { vehicle: UnitVehicle }) {
  return (
    <View style={styles.row}>
      <View style={styles.mid}>
        <PlateText plate={vehicle.plate} size="sm" />
        {!!vehicle.makeModel && <Text style={type.micro}>{vehicle.makeModel}</Text>}
      </View>
      <StatusBadge preset={vehicle.fastagLinked ? 'granted' : 'info'} label={vehicle.fastagLinked ? 'FASTag' : 'No FASTag'} size="sm" />
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm },
  mid: { gap: 4, flex: 1 },
});
