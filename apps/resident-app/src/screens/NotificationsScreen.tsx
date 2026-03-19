import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { getEvents } from '../api/client';

interface Notification {
  id: string;
  visitorName: string;
  gate: string;
  timestamp: string;
  type: string;
}

export default function NotificationsScreen() {
  const [events, setEvents] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const res = await getEvents({ limit: '50' });
      setEvents(res.data.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${date}, ${time}`;
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchEvents} />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.name}>{item.visitorName}</Text>
              <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
            </View>
            <Text style={styles.gate}>{item.gate}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No notifications yet</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  name: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  time: { fontSize: 13, color: '#64748b' },
  gate: { fontSize: 14, color: '#94a3b8' },
  empty: {
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
  },
});
