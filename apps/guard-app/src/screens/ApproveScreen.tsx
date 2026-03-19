import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../App';
import StatusBadge from '../components/StatusBadge';
import { useQueueStore } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';
import { sendGateCommand } from '../api/client';

type RouteParams = RouteProp<RootStackParamList, 'Approve'>;

export default function ApproveScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { entryId } = route.params;

  const entry = useQueueStore((s) =>
    s.entries.find((e) => e.id === entryId),
  );
  const removeEntry = useQueueStore((s) => s.removeEntry);
  const gateId = useAuthStore((s) => s.user?.gateId ?? '');
  const [loading, setLoading] = useState(false);

  if (!entry) {
    return (
      <View style={styles.container}>
        <Text style={styles.notFound}>Entry not found</Text>
      </View>
    );
  }

  const handleDecision = async (action: 'open' | 'deny') => {
    setLoading(true);
    try {
      await sendGateCommand(gateId, action);
      removeEntry(entryId);
      navigation.goBack();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Command failed';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.detailPanel}>
        {entry.snapshot ? (
          <Image
            source={{ uri: entry.snapshot }}
            style={styles.snapshot}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.noSnapshot}>
            <Text style={styles.noSnapshotText}>No snapshot available</Text>
          </View>
        )}
      </View>

      <View style={styles.infoPanel}>
        <Text style={styles.plate}>{entry.plate}</Text>
        <StatusBadge status={entry.decision} />

        <View style={styles.detailRow}>
          <Text style={styles.label}>Method</Text>
          <Text style={styles.value}>{entry.method.toUpperCase()}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.label}>Time</Text>
          <Text style={styles.value}>
            {new Date(entry.timestamp).toLocaleTimeString()}
          </Text>
        </View>
        {entry.reason ? (
          <View style={styles.detailRow}>
            <Text style={styles.label}>Reason</Text>
            <Text style={styles.value}>{entry.reason}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {loading ? (
            <ActivityIndicator size="large" color="#2563eb" />
          ) : (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, styles.approveBtn]}
                onPress={() => handleDecision('open')}
              >
                <Text style={styles.actionText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.denyBtn]}
                onPress={() => handleDecision('deny')}
              >
                <Text style={styles.actionText}>Deny</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    padding: 16,
    gap: 16,
  },
  detailPanel: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  snapshot: {
    width: '90%',
    height: '90%',
    borderRadius: 8,
  },
  noSnapshot: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  noSnapshotText: {
    color: '#64748b',
    fontSize: 16,
  },
  infoPanel: {
    width: 360,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    gap: 12,
  },
  plate: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1e293b',
    letterSpacing: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  label: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  value: {
    fontSize: 14,
    color: '#1e293b',
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  approveBtn: {
    backgroundColor: '#22c55e',
  },
  denyBtn: {
    backgroundColor: '#ef4444',
  },
  actionText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  notFound: {
    flex: 1,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 18,
    color: '#64748b',
  },
});
