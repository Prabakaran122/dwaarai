import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import OTPInput from './OTPInput';
import ShiftStats from './ShiftStats';
import IncidentForm from './IncidentForm';
import { useAuthStore } from '../store/authStore';
import { sendGateCommand } from '../api/client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MUTE_KEY = 'communitygate_guard_muted';

export default function ToolsPanel() {
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
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
      Alert.alert('Error', `Failed to ${action} gate`);
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
            <Text style={styles.gateLabel}>GATE CONTROLS</Text>
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
            <GradientButton title="Open" icon="gate" variant="success" onPress={() => handleManualGate('open')} loading={gateLoading} />
          </View>
          <View style={{ flex: 1 }}>
            <GradientButton title="Close" icon="gate" variant="danger" onPress={() => handleManualGate('close')} loading={gateLoading} />
          </View>
        </View>
      </GlowCard>

      <OTPInput />
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
