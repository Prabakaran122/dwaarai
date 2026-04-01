import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
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
    try { const res = await getEvents({ limit: '50' }); setEvents(res.data.data || []); } finally { setLoading(false); }
  };

  useEffect(() => { fetchEvents(); }, []);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchEvents} tintColor={colors.info} />}
        renderItem={({ item, index }) => (
          <AnimatedEntry direction="left" delay={index * 60}>
            <GlowCard style={styles.card}>
              <View style={styles.row}>
                <IconBadge
                  icon={item.type === 'gate' ? 'gate' : 'car'}
                  color={colors.info}
                  gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']}
                  size={32}
                />
                <View style={styles.info}>
                  <Text style={styles.name}>{item.visitorName}</Text>
                  <Text style={styles.gate}>{item.gate}</Text>
                </View>
                <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
              </View>
            </GlowCard>
          </AnimatedEntry>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="bell-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No notifications yet</Text>
          </View>
        }
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  gate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  time: { fontSize: 11, color: colors.textSecondary },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
