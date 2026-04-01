import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../App';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import StatusPill from '../components/StatusPill';
import PlateText from '../components/PlateText';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useQueueStore } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';
import { sendGateCommand } from '../api/client';

type RouteParams = RouteProp<RootStackParamList, 'Approve'>;

export default function ApproveScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { entryId } = route.params;
  const entry = useQueueStore((s) => s.entries.find((e) => e.id === entryId));
  const removeEntry = useQueueStore((s) => s.removeEntry);
  const gateId = useAuthStore((s) => s.user?.gateId ?? '');
  const [loading, setLoading] = useState(false);

  if (!entry) {
    return (
      <LinearGradient colors={colors.gradientBg} style={styles.container}>
        <View style={styles.notFoundWrap}>
          <MaterialCommunityIcons name="car-off" size={48} color={colors.textMuted} />
          <Text style={styles.notFound}>Entry not found</Text>
        </View>
      </LinearGradient>
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
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Command failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <View style={styles.content}>
        {/* Snapshot panel */}
        <View style={styles.snapshotPanel}>
          {entry.snapshot ? (
            <Image source={{ uri: entry.snapshot }} style={styles.snapshot} resizeMode="contain" />
          ) : (
            <View style={styles.noSnapshot}>
              <MaterialCommunityIcons name="camera-off" size={48} color={colors.textMuted} />
              <Text style={styles.noSnapshotText}>No snapshot</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', colors.bgPrimary]}
            style={styles.snapshotOverlay}
          />
        </View>

        {/* Info panel */}
        <AnimatedEntry direction="up" duration={500}>
          <GlowCard variant={entry.decision === 'deny' ? 'danger' : 'warning'} style={styles.infoCard}>
            <PlateText plate={entry.plate} size="lg" />
            <View style={styles.statusRow}>
              <StatusPill status={entry.decision} />
            </View>

            <View style={styles.detailGrid}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>METHOD</Text>
                <View style={styles.detailValueRow}>
                  <MaterialCommunityIcons
                    name={entry.method === 'anpr' ? 'camera' : entry.method === 'rfid' ? 'card-bulleted' : 'account'}
                    size={16}
                    color={colors.info}
                  />
                  <Text style={styles.detailValue}>{entry.method.toUpperCase()}</Text>
                </View>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>TIME</Text>
                <View style={styles.detailValueRow}>
                  <MaterialCommunityIcons name="clock-outline" size={16} color={colors.info} />
                  <Text style={styles.detailValue}>{new Date(entry.timestamp).toLocaleTimeString()}</Text>
                </View>
              </View>
              {entry.reason ? (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>REASON</Text>
                  <Text style={styles.detailValue}>{entry.reason}</Text>
                </View>
              ) : null}
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={colors.info} style={styles.loader} />
            ) : (
              <View style={styles.actions}>
                <View style={styles.actionBtn}>
                  <GradientButton
                    title="Approve"
                    icon="check-circle"
                    variant="success"
                    onPress={() => handleDecision('open')}
                  />
                </View>
                <View style={styles.actionBtn}>
                  <GradientButton
                    title="Deny"
                    icon="close-circle"
                    variant="danger"
                    onPress={() => handleDecision('deny')}
                  />
                </View>
              </View>
            )}
          </GlowCard>
        </AnimatedEntry>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, flexDirection: 'row', padding: spacing.lg, gap: spacing.lg },
  snapshotPanel: { flex: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.02)', justifyContent: 'center', alignItems: 'center' },
  snapshot: { width: '90%', height: '90%', borderRadius: radius.md },
  noSnapshot: { justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  noSnapshotText: { color: colors.textMuted, fontSize: 14 },
  snapshotOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  infoCard: { width: 380 },
  statusRow: { flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.xl },
  detailGrid: { gap: spacing.lg, marginBottom: spacing['2xl'] },
  detailItem: { gap: spacing.xs },
  detailLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  detailValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.md },
  actionBtn: { flex: 1 },
  loader: { marginVertical: spacing['2xl'] },
  notFoundWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  notFound: { color: colors.textMuted, fontSize: 16 },
});
