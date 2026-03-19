import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import StatusBadge from './StatusBadge';
import type { QueueEntry } from '../store/queueStore';

interface VehicleCardProps {
  entry: QueueEntry;
  onPress: (entry: QueueEntry) => void;
}

const METHOD_LABELS: Record<QueueEntry['method'], string> = {
  anpr: 'ANPR',
  rfid: 'RFID',
  otp: 'OTP',
  manual: 'Manual',
};

export default function VehicleCard({ entry, onPress }: VehicleCardProps) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(entry)}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        <Text style={styles.plate}>{entry.plate}</Text>
        <StatusBadge status={entry.decision} />
      </View>
      <View style={styles.row}>
        <Text style={styles.method}>{METHOD_LABELS[entry.method]}</Text>
        <Text style={styles.time}>{time}</Text>
      </View>
      {entry.reason ? (
        <Text style={styles.reason} numberOfLines={1}>
          {entry.reason}
        </Text>
      ) : null}
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
    fontSize: 22,
    fontWeight: '700',
    color: '#1e293b',
    letterSpacing: 1,
  },
  method: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  time: {
    fontSize: 14,
    color: '#64748b',
  },
  reason: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
});
