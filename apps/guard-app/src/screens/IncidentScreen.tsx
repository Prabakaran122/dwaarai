import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { createIncident } from '../api/client';
import { useAuthStore } from '../store/authStore';

const INCIDENT_TYPES = [
  { key: 'unauthorized_entry', label: 'Unauthorized Entry', icon: 'account-alert' as const },
  { key: 'tailgating', label: 'Tailgating', icon: 'car-multiple' as const },
  { key: 'suspicious_person', label: 'Suspicious Person', icon: 'eye' as const },
  { key: 'vehicle_damage', label: 'Vehicle Damage', icon: 'car-wrench' as const },
  { key: 'equipment_malfunction', label: 'Equipment Fault', icon: 'cog-off' as const },
  { key: 'other', label: 'Other', icon: 'dots-horizontal' as const },
];

export default function IncidentScreen() {
  const [type, setType] = useState(INCIDENT_TYPES[0].key);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const gateId = useAuthStore((s) => s.user?.gateId ?? '');

  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert('Error', 'Please enter a description');
      return;
    }
    setLoading(true);
    try {
      await createIncident({ type, description: description.trim(), gateId });
      Alert.alert('Success', 'Incident logged successfully');
      setDescription('');
      setType(INCIDENT_TYPES[0].key);
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to log incident';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Failed to log incident');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <AnimatedEntry direction="fade" duration={500}>
          <GlowCard variant="danger" style={styles.card}>
            <View style={styles.titleRow}>
              <MaterialCommunityIcons name="alert" size={24} color={colors.danger} />
              <Text style={styles.title}>Report Incident</Text>
            </View>

            <Text style={styles.label}>INCIDENT TYPE</Text>
            <View style={styles.chipGrid}>
              {INCIDENT_TYPES.map((t) => {
                const isActive = type === t.key;
                return (
                  <TouchableOpacity key={t.key} onPress={() => setType(t.key)} activeOpacity={0.7}>
                    {isActive ? (
                      <LinearGradient
                        colors={colors.gradientDanger as [string, string]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.chip}
                      >
                        <MaterialCommunityIcons name={t.icon} size={16} color={colors.white} />
                        <Text style={styles.chipTextActive}>{t.label}</Text>
                      </LinearGradient>
                    ) : (
                      <View style={styles.chipInactive}>
                        <MaterialCommunityIcons name={t.icon} size={16} color={colors.textMuted} />
                        <Text style={styles.chipText}>{t.label}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>DESCRIPTION</Text>
            <TextInput
              style={[styles.textArea, focused && styles.textAreaFocused]}
              placeholder="Describe the incident..."
              placeholderTextColor={colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />

            <GradientButton
              title="Submit Report"
              icon="alert"
              variant="danger"
              onPress={handleSubmit}
              loading={loading}
              disabled={!description.trim()}
            />
          </GlowCard>
        </AnimatedEntry>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing['2xl'], alignItems: 'center' },
  card: { width: 600 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing['2xl'] },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing['2xl'] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  chipInactive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: colors.white, fontSize: 13, fontWeight: '600' },
  textArea: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 120,
    marginBottom: spacing['2xl'],
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  textAreaFocused: {
    borderColor: 'rgba(239,68,68,0.4)',
  },
});
