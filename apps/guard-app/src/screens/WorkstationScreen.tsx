import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import ActionZone from '../components/ActionZone';
import LiveFeed from '../components/LiveFeed';
import ToolsPanel from '../components/ToolsPanel';
import { useAuthStore } from '../store/authStore';
import { useQueueStore } from '../store/queueStore';

export default function WorkstationScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const totalEntries = useQueueStore((s) => s.shiftStats.totalEntries);
  const shiftStart = useQueueStore((s) => s.shiftStats.shiftStart);

  const shiftTime = new Date(shiftStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleLogout = () => {
    Alert.alert('End Shift', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
          <Text style={styles.gateName}>Main Gate</Text>
        </View>
        <Text style={styles.shiftInfo}>On since {shiftTime} · {totalEntries} events</Text>
        <View style={styles.headerRight}>
          <Text style={styles.guardName}>{user?.name || 'Guard'}</Text>
          <TouchableOpacity onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={20} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Three panels */}
      <View style={styles.panels}>
        <View style={styles.leftPanel}>
          <ActionZone />
        </View>
        <View style={styles.divider} />
        <View style={styles.centerPanel}>
          <LiveFeed />
        </View>
        <View style={styles.divider} />
        <View style={styles.rightPanel}>
          <ToolsPanel />
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  gateName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  shiftInfo: { fontSize: 12, color: colors.textMuted, flex: 1, textAlign: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1, justifyContent: 'flex-end' },
  guardName: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  panels: { flex: 1, flexDirection: 'row' },
  leftPanel: { flex: 35 },
  centerPanel: { flex: 35 },
  rightPanel: { flex: 30 },
  divider: { width: 1, backgroundColor: colors.surfaceBorder },
});
