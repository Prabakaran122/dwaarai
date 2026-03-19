import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { getEvents, getPasses } from '../api/client';
import { useVehicleStore } from '../store/vehicleStore';
import { useAuthStore } from '../store/authStore';

interface EntryEvent {
  id: string;
  visitorName: string;
  gate: string;
  timestamp: string;
}

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const { vehicles, fetch: fetchVehicles } = useVehicleStore();
  const [activePasses, setActivePasses] = useState(0);
  const [recentEntries, setRecentEntries] = useState<EntryEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      await fetchVehicles();
      const [passRes, eventRes] = await Promise.all([
        getPasses(),
        getEvents({ limit: '5' }),
      ]);
      const passes = passRes.data.data || [];
      setActivePasses(passes.filter((p: any) => p.status === 'active').length);
      setRecentEntries(eventRes.data.data || []);
    } catch {
      /* silently fail on refresh */
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.greeting}>Hello, {user?.name ?? 'Resident'}</Text>

      <View style={styles.cardsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{vehicles.length}</Text>
          <Text style={styles.statLabel}>Vehicles</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{activePasses}</Text>
          <Text style={styles.statLabel}>Active Passes</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Recent Entries</Text>
      {recentEntries.length === 0 ? (
        <Text style={styles.empty}>No recent entries</Text>
      ) : (
        recentEntries.map((e) => (
          <View key={e.id} style={styles.entryRow}>
            <View>
              <Text style={styles.entryName}>{e.visitorName}</Text>
              <Text style={styles.entryGate}>{e.gate}</Text>
            </View>
            <Text style={styles.entryTime}>
              {new Date(e.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 16,
  },
  cardsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  statNumber: { fontSize: 32, fontWeight: '700', color: '#2563eb' },
  statLabel: { fontSize: 14, color: '#64748b', marginTop: 4 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 12,
  },
  empty: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 8 },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    elevation: 1,
  },
  entryName: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  entryGate: { fontSize: 13, color: '#64748b', marginTop: 2 },
  entryTime: { fontSize: 14, color: '#64748b' },
});
