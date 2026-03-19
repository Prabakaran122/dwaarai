import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { createIncident } from '../api/client';
import { useAuthStore } from '../store/authStore';

const INCIDENT_TYPES = [
  'unauthorized_entry',
  'tailgating',
  'suspicious_person',
  'vehicle_damage',
  'equipment_malfunction',
  'other',
] as const;

const TYPE_LABELS: Record<(typeof INCIDENT_TYPES)[number], string> = {
  unauthorized_entry: 'Unauthorized Entry',
  tailgating: 'Tailgating',
  suspicious_person: 'Suspicious Person',
  vehicle_damage: 'Vehicle Damage',
  equipment_malfunction: 'Equipment Malfunction',
  other: 'Other',
};

export default function IncidentScreen() {
  const [type, setType] = useState<string>(INCIDENT_TYPES[0]);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
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
      setType(INCIDENT_TYPES[0]);
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to log incident';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Log Security Incident</Text>

        <Text style={styles.label}>Incident Type</Text>
        <View style={styles.typeGrid}>
          {INCIDENT_TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.typeChip, type === t && styles.typeChipActive]}
              onPress={() => setType(t)}
            >
              <Text
                style={[
                  styles.typeChipText,
                  type === t && styles.typeChipTextActive,
                ]}
              >
                {TYPE_LABELS[t]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Describe the incident..."
          placeholderTextColor="#94a3b8"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.disabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Submit Incident Report</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  content: {
    padding: 24,
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    width: 600,
    elevation: 3,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 8,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  typeChipActive: {
    backgroundColor: '#1e40af',
    borderColor: '#1e40af',
  },
  typeChipText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  typeChipTextActive: {
    color: '#fff',
  },
  textArea: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#1e293b',
    minHeight: 120,
    marginBottom: 24,
  },
  submitBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
