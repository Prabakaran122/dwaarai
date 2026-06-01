import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import OTPInput from './OTPInput';
import ExpectedVisitors from './ExpectedVisitors';
import ShiftStats from './ShiftStats';
import IncidentForm from './IncidentForm';
import DeliveryPanel from './DeliveryPanel';
import StaffPanel from './StaffPanel';
import LanguageSwitcher from './LanguageSwitcher';
import { useAuthStore } from '../store/authStore';
import { useT } from '../store/langStore';
import { sendGateCommand } from '../api/client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MUTE_KEY = 'communitygate_guard_muted';

export default function ToolsPanel() {
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const t = useT();
  const [muted, setMuted] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem(MUTE_KEY).then((v) => { if (v === '1') setMuted(true); });
  }, []);

  const toggleMute = () => {
    const newVal = !muted;
    setMuted(newVal);
    AsyncStorage.setItem(MUTE_KEY, newVal ? '1' : '0').catch(() => {});
  };

  const handleManualGate = async (action: string) => {
    if (!gateId) return;
    setGateLoading(true);
    try {
      await sendGateCommand(gateId, action);
    } catch {
      Alert.alert(t('error'), t('failOpenGate'));
    } finally {
      setGateLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <GlowCard style={styles.gateCard}>
        <View style={styles.gateHeader}>
          <View style={styles.gateStatus}>
            <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
            <Text style={styles.gateLabel}>{t('gateControls')}</Text>
          </View>
          <TouchableOpacity onPress={toggleMute}>
            <MaterialCommunityIcons
              name={muted ? 'bell-off' : 'bell'}
              size={20}
              color={muted ? colors.textMuted : colors.warning}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.gateButtons}>
          <View style={{ flex: 1 }}>
            <GradientButton title={t('open')} icon="gate" variant="success" onPress={() => handleManualGate('open')} loading={gateLoading} />
          </View>
          <View style={{ flex: 1 }}>
            <GradientButton title={t('close')} icon="gate" variant="danger" onPress={() => handleManualGate('close')} loading={gateLoading} />
          </View>
        </View>
      </GlowCard>

      <GlowCard>
        <LanguageSwitcher compact />
      </GlowCard>

      <OTPInput />
      <StaffPanel />
      <ExpectedVisitors />
      <DeliveryPanel />
      <ShiftStats />
      <IncidentForm />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  gateCard: {},
  gateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  gateStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  gateLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  gateButtons: { flexDirection: 'row', gap: spacing.sm },
});
