import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, Modal, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import * as api from '../api/client';

interface Pass {
  id: string;
  visitorName: string;
  visitorPhone: string;
  otp: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  validFrom: string;
  validUntil: string;
}

const statusConfig: Record<Pass['status'], { color: string; bg: string; label: string }> = {
  active: { color: colors.success, bg: colors.successBg, label: 'Active' },
  used: { color: colors.info, bg: colors.infoBg, label: 'Used' },
  expired: { color: colors.textMuted, bg: colors.surface, label: 'Expired' },
  revoked: { color: colors.danger, bg: colors.dangerBg, label: 'Revoked' },
};

const DURATION_OPTIONS = ['4', '12', '24', '48'];

export default function PassesScreen() {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [hours, setHours] = useState('24');
  const [expandedOtp, setExpandedOtp] = useState<string | null>(null);

  const fetchPasses = async () => {
    setLoading(true);
    try { const res = await api.getPasses(); setPasses(res.data.data || []); } finally { setLoading(false); }
  };

  useEffect(() => { fetchPasses(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || !phone.trim()) { Alert.alert('Error', 'Name and phone are required'); return; }
    try {
      const now = new Date();
      const until = new Date(now.getTime() + parseInt(hours, 10) * 3600000);
      await api.createPass({ visitorName: name.trim(), visitorPhone: phone.trim(), validFrom: now.toISOString(), validUntil: until.toISOString() });
      setName(''); setPhone(''); setHours('24'); setShowForm(false); fetchPasses();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.error || 'Failed to create pass'); }
  };

  const handleRevoke = (id: string) => {
    Alert.alert('Revoke Pass', 'This will invalidate the visitor pass.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => { await api.revokePass(id); fetchPasses(); } },
    ]);
  };

  const renderPass = ({ item, index }: { item: Pass; index: number }) => {
    const status = statusConfig[item.status];
    const variant = item.status === 'active' ? 'success' : item.status === 'revoked' ? 'danger' : 'default';
    const isExpanded = expandedOtp === item.id;
    const validUntil = new Date(item.validUntil).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return (
      <AnimatedEntry direction="left" delay={index * 80}>
        <GlowCard variant={variant} style={styles.passCard}>
          <TouchableOpacity onPress={() => setExpandedOtp(isExpanded ? null : item.id)} activeOpacity={0.7}>
            <View style={styles.passHeader}>
              <View style={styles.passInfo}>
                <Text style={styles.passName}>{item.visitorName}</Text>
                <Text style={styles.passPhone}>{item.visitorPhone}</Text>
                <Text style={styles.passValidity}>Valid until {validUntil}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
              </View>
            </View>

            {isExpanded && item.status === 'active' && (
              <AnimatedEntry direction="fade" duration={300}>
                <View style={styles.otpBox}>
                  <Text style={styles.otpLabel}>OTP</Text>
                  <Text style={styles.otpCode}>{item.otp}</Text>
                </View>
                <View style={styles.revokeWrap}>
                  <GradientButton title="Revoke" icon="close-circle" variant="danger" onPress={() => handleRevoke(item.id)} />
                </View>
              </AnimatedEntry>
            )}
          </TouchableOpacity>
        </GlowCard>
      </AnimatedEntry>
    );
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <FlatList
        data={passes}
        keyExtractor={(p) => p.id}
        refreshing={loading}
        onRefresh={fetchPasses}
        contentContainerStyle={styles.list}
        renderItem={renderPass}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="ticket-account" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No visitor passes</Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.fabWrap} onPress={() => setShowForm(true)} activeOpacity={0.8}>
        <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.fab}>
          <MaterialCommunityIcons name="plus" size={28} color={colors.white} />
        </LinearGradient>
      </TouchableOpacity>

      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Visitor Pass</Text>
            <TextInput style={styles.input} placeholder="Visitor name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Visitor phone" placeholderTextColor={colors.textMuted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Text style={styles.durationLabel}>DURATION</Text>
            <View style={styles.durationChips}>
              {DURATION_OPTIONS.map((h) => (
                <TouchableOpacity key={h} onPress={() => setHours(h)}>
                  {hours === h ? (
                    <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.durationChip}>
                      <Text style={styles.durationChipTextActive}>{h}h</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.durationChipInactive}>
                      <Text style={styles.durationChipText}>{h}h</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={() => setShowForm(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Create" variant="success" icon="ticket-account" onPress={handleCreate} />
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
  list: { padding: spacing.lg, paddingBottom: 100 },
  passCard: { marginBottom: spacing.md },
  passHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  passInfo: { flex: 1, gap: 2 },
  passName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  passPhone: { fontSize: 13, color: colors.textMuted },
  passValidity: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: '700' },
  otpBox: { marginTop: spacing.lg, backgroundColor: colors.infoBg, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center' },
  otpLabel: { fontSize: 11, color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.xs },
  otpCode: { fontSize: 28, fontWeight: '800', color: colors.info, letterSpacing: 4, fontFamily: 'monospace' },
  revokeWrap: { marginTop: spacing.md },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md,
  },
  durationLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm },
  durationChips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  durationChip: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.pill },
  durationChipInactive: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  durationChipText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  durationChipTextActive: { color: colors.white, fontSize: 14, fontWeight: '600' },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
});
