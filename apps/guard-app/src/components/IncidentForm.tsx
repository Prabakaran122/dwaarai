import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import { createIncident } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useT } from '../store/langStore';

const INCIDENT_TYPES = [
  { key: 'unauthorized_entry', labelKey: 'incUnauthorized', icon: 'account-alert' },
  { key: 'tailgating', labelKey: 'incTailgating', icon: 'car-multiple' },
  { key: 'suspicious_person', labelKey: 'incSuspicious', icon: 'eye' },
  { key: 'vehicle_damage', labelKey: 'incDamage', icon: 'car-wrench' },
  { key: 'equipment_malfunction', labelKey: 'incEquipment', icon: 'cog-off' },
  { key: 'other', labelKey: 'incOther', icon: 'dots-horizontal' },
];

export default function IncidentForm() {
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const tr = useT();
  const [expanded, setExpanded] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setSelectedType('');
    setDescription('');
    setExpanded(false);
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!selectedType || !gateId) return;
    setLoading(true);
    try {
      await createIncident({ type: selectedType, description: description.trim(), gateId });
      Alert.alert(tr('incidentLogged'), tr('reportSubmitted'));
      resetForm();
    } catch {
      Alert.alert(tr('error'), tr('failIncident'));
      setLoading(false);
    }
  };

  if (!expanded) {
    return (
      <TouchableOpacity onPress={() => setExpanded(true)} activeOpacity={0.7}>
        <GlowCard variant="warning" style={styles.button}>
          <View style={styles.buttonRow}>
            <MaterialCommunityIcons name="alert-circle" size={18} color={colors.warning} />
            <Text style={styles.buttonText}>{tr('logIncident')}</Text>
          </View>
        </GlowCard>
      </TouchableOpacity>
    );
  }

  return (
    <GlowCard variant="warning" style={styles.container}>
      <Text style={styles.label}>{tr('logIncidentTitle')}</Text>
      <View style={styles.chipGrid}>
        {INCIDENT_TYPES.map((it) => (
          <TouchableOpacity key={it.key} onPress={() => setSelectedType(it.key)}>
            {selectedType === it.key ? (
              <LinearGradient colors={colors.gradientDanger as [string, string]} style={styles.chip}>
                <MaterialCommunityIcons name={it.icon as any} size={14} color={colors.white} />
                <Text style={styles.chipTextActive}>{tr(it.labelKey)}</Text>
              </LinearGradient>
            ) : (
              <View style={styles.chipInactive}>
                <MaterialCommunityIcons name={it.icon as any} size={14} color={colors.textMuted} />
                <Text style={styles.chipText}>{tr(it.labelKey)}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder={tr('description')}
        placeholderTextColor={colors.textMuted}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <GradientButton title={tr('cancel')} variant="danger" onPress={resetForm} />
        </View>
        <View style={{ flex: 1 }}>
          <GradientButton title={tr('submit')} variant="primary" icon="send" onPress={handleSubmit} loading={loading} disabled={!selectedType} />
        </View>
      </View>
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  container: {},
  button: {},
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  buttonText: { color: colors.warning, fontSize: 14, fontWeight: '700' },
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill,
  },
  chipInactive: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
  },
  chipText: { color: colors.textMuted, fontSize: 11 },
  chipTextActive: { color: colors.white, fontSize: 11, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.sm, fontSize: 13, color: colors.textPrimary, marginBottom: spacing.md, minHeight: 60,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
