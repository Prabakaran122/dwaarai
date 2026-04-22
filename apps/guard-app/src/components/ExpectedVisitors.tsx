import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import AnimatedEntry from './AnimatedEntry';
import { getExpectedVisits, markVisitArrived } from '../api/client';

interface ExpectedGroup {
  id: string;
  visitor_name: string;
  visitor_role: string | null;
  units: string[];
  visit_ids: string[];
  time_from: string;
  time_until: string;
}

interface ArrivedEntry {
  visitor_name: string;
  visitor_role: string | null;
  unit_number: string;
  arrived_at: string;
  photo_url: string | null;
}

const ROLE_ICONS: Record<string, string> = {
  maid: 'broom',
  cook: 'chef-hat',
  driver: 'car',
  tutor: 'book-open-variant',
  newspaper: 'newspaper',
  other: 'account',
};

function formatTime(time: string) {
  const [h, m] = time.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

export default function ExpectedVisitors() {
  const [expected, setExpected] = useState<ExpectedGroup[]>([]);
  const [arrived, setArrived] = useState<ArrivedEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);

  const fetchVisits = useCallback(async () => {
    try {
      const res = await getExpectedVisits();
      const data = res.data.data;
      setExpected(data.expected || []);
      setArrived(data.arrived || []);
    } catch {
      // Silently fail — not critical
    }
  }, []);

  useEffect(() => {
    fetchVisits();
    const interval = setInterval(fetchVisits, 60000); // Poll every 60s
    return () => clearInterval(interval);
  }, [fetchVisits]);

  const handleArrived = async (group: ExpectedGroup) => {
    try {
      // Open camera
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Camera access is needed to take visitor photo');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        allowsEditing: false,
        aspect: [4, 3],
      });

      if (result.canceled) return;

      setLoading(group.id);

      const photo = result.assets[0];
      const formData = new FormData();
      formData.append('photo', {
        uri: photo.uri,
        type: 'image/jpeg',
        name: `${group.id}.jpg`,
      } as any);

      const res = await markVisitArrived(group.id, formData);
      const data = res.data.data;

      Alert.alert('Arrived', `${data.visitor_name} marked — ${data.marked} unit(s)`);
      fetchVisits();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error?.message || 'Failed to mark arrived');
    } finally {
      setLoading(null);
    }
  };

  if (expected.length === 0 && arrived.length === 0) {
    return null; // Hide panel when no expected visitors
  }

  return (
    <GlowCard style={styles.card}>
      <Text style={styles.label}>EXPECTED NOW ({expected.length})</Text>

      {expected.map((group, i) => {
        const icon = ROLE_ICONS[group.visitor_role || 'other'] || 'account';
        return (
          <AnimatedEntry key={group.id} direction="fade" delay={i * 50}>
            <View style={styles.visitorRow}>
              <MaterialCommunityIcons name={icon as any} size={20} color={colors.info} />
              <View style={styles.visitorInfo}>
                <Text style={styles.visitorName}>
                  {group.visitor_name}
                  {group.visitor_role ? ` · ${group.visitor_role}` : ''}
                </Text>
                <Text style={styles.visitorDetail}>
                  {group.units.length > 1 ? `Flats: ${group.units.join(', ')}` : `Flat ${group.units[0]}`}
                </Text>
                <Text style={styles.visitorTime}>
                  {formatTime(group.time_from)} - {formatTime(group.time_until)}
                </Text>
              </View>
              <View style={{ width: 90 }}>
                <GradientButton
                  title="Arrived"
                  icon="camera"
                  variant="success"
                  onPress={() => handleArrived(group)}
                  loading={loading === group.id}
                />
              </View>
            </View>
          </AnimatedEntry>
        );
      })}

      {arrived.length > 0 && (
        <>
          <Text style={[styles.label, { marginTop: spacing.md }]}>ARRIVED TODAY ({arrived.length})</Text>
          {arrived.map((entry, i) => {
            const time = new Date(entry.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <View key={`arrived-${i}`} style={styles.arrivedRow}>
                <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
                <Text style={styles.arrivedText}>
                  {entry.visitor_name} · Flat {entry.unit_number} · {time}
                </Text>
              </View>
            );
          })}
        </>
      )}
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  visitorRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  visitorInfo: { flex: 1, gap: 2 },
  visitorName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  visitorDetail: { fontSize: 12, color: colors.textSecondary },
  visitorTime: { fontSize: 11, color: colors.textMuted },
  arrivedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  arrivedText: { fontSize: 12, color: colors.textMuted },
});
