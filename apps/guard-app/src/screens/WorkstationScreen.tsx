import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import ActionZone from '../components/ActionZone';
import LiveFeed from '../components/LiveFeed';
import ToolsPanel from '../components/ToolsPanel';
import SosButton from '../components/SosButton';
import SosBanner from '../components/SosBanner';
import HandoverCard from '../components/HandoverCard';
import GradientButton from '../components/GradientButton';
import GlowCard from '../components/GlowCard';
import { useAuthStore } from '../store/authStore';
import { useQueueStore } from '../store/queueStore';
import { useSosStore } from '../store/sosStore';
import { useDeliveryStore } from '../store/deliveryStore';
import { useHandoverStore } from '../store/handoverStore';
import { useT } from '../store/langStore';

export default function WorkstationScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const totalEntries = useQueueStore((s) => s.shiftStats.totalEntries);
  const shiftStart = useQueueStore((s) => s.shiftStats.shiftStart);
  const fetchActiveSos = useSosStore((s) => s.fetchActive);
  const sosCount = useSosStore((s) => s.active.length);
  const deliveryCount = useDeliveryStore((s) => s.active.length);
  const submitHandover = useHandoverStore((s) => s.submit);
  const [showHandover, setShowHandover] = useState(false);
  const [note, setNote] = useState('');
  const [ending, setEnding] = useState(false);
  const t = useT();

  React.useEffect(() => { fetchActiveSos(); }, []);

  const shiftTime = new Date(shiftStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleLogout = () => setShowHandover(true);

  const endShift = async () => {
    if (note.trim()) {
      setEnding(true);
      try { await submitHandover(note.trim()); } catch { /* still log out */ }
      setEnding(false);
    }
    setShowHandover(false);
    logout();
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
          <Text style={styles.gateName}>{t('mainGate')}</Text>
        </View>
        <Text style={styles.shiftInfo}>{shiftTime} · {totalEntries}</Text>
        <View style={styles.headerRight}>
          <SosButton />
          <Text style={styles.guardName}>{user?.name || t('guard')}</Text>
          <TouchableOpacity onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={20} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Active emergency banner(s) */}
      <SosBanner />

      {/* Incoming-shift handover */}
      <HandoverCard />

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

      {/* End-of-shift handover */}
      <Modal visible={showHandover} transparent animationType="fade" onRequestClose={() => setShowHandover(false)}>
        <View style={styles.overlay}>
          <GlowCard style={styles.handoverCard}>
            <Text style={styles.handoverTitle}>{t('handoverTitle')}</Text>
            <Text style={styles.handoverItems}>
              {t('openItems')}: {sosCount} {t('sosActiveCount')} · {deliveryCount} {t('deliveriesWaitingCount')}
            </Text>
            <TextInput
              style={styles.handoverInput}
              placeholder={t('handoverPrompt')}
              placeholderTextColor={colors.textMuted}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View style={styles.handoverActions}>
              <View style={{ flex: 1 }}>
                <GradientButton title={t('skipLogout')} variant="danger" onPress={() => { setShowHandover(false); logout(); }} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title={t('endShiftSubmit')} variant="success" icon="check-circle" onPress={endShift} loading={ending} />
              </View>
            </View>
          </GlowCard>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  handoverCard: { width: 440, maxWidth: '90%' },
  handoverTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.sm },
  handoverItems: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  handoverInput: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 15, color: colors.textPrimary, minHeight: 70, marginBottom: spacing.md,
  },
  handoverActions: { flexDirection: 'row', gap: spacing.md },
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
