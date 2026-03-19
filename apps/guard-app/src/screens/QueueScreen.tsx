import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import VehicleCard from '../components/VehicleCard';
import { useQueueStore, type QueueEntry } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';

type NavProp = NativeStackNavigationProp<RootStackParamList, 'Queue'>;

export default function QueueScreen() {
  const navigation = useNavigation<NavProp>();
  const entries = useQueueStore((s) => s.entries);
  const logout = useAuthStore((s) => s.logout);

  const pendingEntries = entries.filter((e) => e.decision === 'guard_review');
  const recentEntries = entries.filter((e) => e.decision !== 'guard_review');

  const handleCardPress = useCallback(
    (entry: QueueEntry) => {
      navigation.navigate('Approve', { entryId: entry.id });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: QueueEntry }) => (
      <VehicleCard entry={item} onPress={handleCardPress} />
    ),
    [handleCardPress],
  );

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>
            Pending Review ({pendingEntries.length})
          </Text>
          <FlatList
            data={pendingEntries}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ListEmptyComponent={
              <Text style={styles.empty}>No vehicles pending review</Text>
            }
          />
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>
            Recent ({recentEntries.length})
          </Text>
          <FlatList
            data={recentEntries}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ListEmptyComponent={
              <Text style={styles.empty}>No recent entries</Text>
            }
          />
        </View>
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => navigation.navigate('OTPVerify')}
        >
          <Text style={styles.navButtonText}>Verify OTP</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => navigation.navigate('Incidents')}
        >
          <Text style={styles.navButtonText}>Log Incident</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navButton, styles.logoutButton]}
          onPress={logout}
        >
          <Text style={styles.navButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    padding: 16,
    gap: 16,
  },
  panel: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 12,
  },
  empty: {
    textAlign: 'center',
    color: '#94a3b8',
    marginTop: 40,
    fontSize: 14,
  },
  bottomBar: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#1e293b',
    gap: 12,
  },
  navButton: {
    flex: 1,
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  logoutButton: {
    backgroundColor: '#dc2626',
    flex: 0.5,
  },
  navButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
