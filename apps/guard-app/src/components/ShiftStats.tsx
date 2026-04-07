import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import GlowCard from './GlowCard';
import { useQueueStore } from '../store/queueStore';

function formatDuration(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ShiftStats() {
  const stats = useQueueStore((s) => s.shiftStats);
  const [duration, setDuration] = useState(formatDuration(stats.shiftStart));

  useEffect(() => {
    const interval = setInterval(() => {
      setDuration(formatDuration(stats.shiftStart));
    }, 60000);
    return () => clearInterval(interval);
  }, [stats.shiftStart]);

  return (
    <GlowCard style={styles.container}>
      <Text style={styles.label}>SHIFT</Text>
      <Text style={styles.since}>On since {formatTime(stats.shiftStart)} · {duration}</Text>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{stats.totalEntries}</Text>
          <Text style={styles.statLabel}>Entries</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={[styles.statNumber, { color: colors.danger }]}>{stats.totalDenied}</Text>
          <Text style={styles.statLabel}>Denied</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={[styles.statNumber, { color: colors.info }]}>{stats.totalVisitors}</Text>
          <Text style={styles.statLabel}>Visitors</Text>
        </View>
      </View>
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  container: {},
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.xs },
  since: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center' },
  statNumber: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  statLabel: { fontSize: 9, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
  divider: { width: 1, height: 28, backgroundColor: colors.surfaceBorder },
});
