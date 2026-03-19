import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { Vehicle } from '../store/vehicleStore';

interface VehicleCardProps {
  vehicle: Vehicle;
  onPress: (vehicle: Vehicle) => void;
  onDelete: (id: string) => void;
}

export default function VehicleCard({
  vehicle,
  onPress,
  onDelete,
}: VehicleCardProps) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(vehicle)}
      onLongPress={() => onDelete(vehicle.id)}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        <Text style={styles.plate}>{vehicle.plate}</Text>
        <View
          style={[
            styles.rfidBadge,
            vehicle.rfidTag ? styles.rfidActive : styles.rfidInactive,
          ]}
        >
          <Text style={styles.rfidText}>
            {vehicle.rfidTag ? 'RFID' : 'No RFID'}
          </Text>
        </View>
      </View>
      <View style={styles.row}>
        <Text style={styles.detail}>
          {vehicle.make} {vehicle.model}
        </Text>
        <Text style={styles.type}>{vehicle.type}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  plate: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
    letterSpacing: 1,
  },
  detail: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  type: {
    fontSize: 13,
    color: '#94a3b8',
    textTransform: 'capitalize',
  },
  rfidBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  rfidActive: { backgroundColor: '#dcfce7' },
  rfidInactive: { backgroundColor: '#f1f5f9' },
  rfidText: { fontSize: 12, fontWeight: '600', color: '#475569' },
});
