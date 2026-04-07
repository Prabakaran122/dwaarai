import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';

export interface PassData {
  id: string;
  visitor_name: string;
  visitor_mobile?: string;
  visitor_vehicle?: string;
  otp: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  valid_from: string;
  valid_until: string;
  uses_count: number;
  max_uses: number;
}

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  active: { color: colors.success, bg: colors.successBg, label: 'Active' },
  used: { color: colors.info, bg: colors.infoBg, label: 'Used' },
  expired: { color: colors.textMuted, bg: colors.surface, label: 'Expired' },
  revoked: { color: colors.danger, bg: colors.dangerBg, label: 'Revoked' },
};

interface Props {
  pass: PassData;
  residentName: string;
  unitNumber: string;
  communityName?: string;
  onRevoke: (id: string) => void;
}

export default function VisitorPassCard({ pass, residentName, unitNumber, communityName, onRevoke }: Props) {
  const status = statusConfig[pass.status] || statusConfig.expired;
  const variant = pass.status === 'active' ? 'success' : pass.status === 'revoked' ? 'danger' : 'default';
  const validUntil = new Date(pass.valid_until).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const usesText = `${pass.uses_count}/${pass.max_uses} uses`;

  const shareWhatsApp = () => {
    const validFrom = new Date(pass.valid_from).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const msg = [
      `Hi! I've shared a visitor pass for you at ${communityName || 'our community'}.`,
      '',
      `Gate Code: ${pass.otp}`,
      `Valid: ${validFrom} - ${validUntil}`,
      '',
      `- ${residentName}, ${unitNumber}`,
    ].join('\n');

    const url = `whatsapp://send?text=${encodeURIComponent(msg)}`;
    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) Linking.openURL(url);
        else Alert.alert('WhatsApp not installed');
      })
      .catch(() => Alert.alert('Could not open WhatsApp'));
  };

  const handleRevoke = () => {
    Alert.alert('Revoke Pass', 'This will invalidate the visitor pass.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => onRevoke(pass.id) },
    ]);
  };

  return (
    <GlowCard variant={variant} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.info}>
          <Text style={styles.name}>{pass.visitor_name}</Text>
          {pass.visitor_vehicle ? (
            <Text style={styles.vehicle}>{pass.visitor_vehicle}</Text>
          ) : null}
          <Text style={styles.validity}>Valid until {validUntil} · {usesText}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      {pass.status === 'active' && (
        <View style={styles.activeSection}>
          <View style={styles.otpBox}>
            <MaterialCommunityIcons name="qrcode" size={20} color={colors.info} />
            <Text style={styles.otpCode}>{pass.otp}</Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity onPress={shareWhatsApp} style={styles.shareButton}>
              <LinearGradient
                colors={colors.gradientSuccess as [string, string]}
                style={styles.shareGradient}
              >
                <MaterialCommunityIcons name="whatsapp" size={18} color={colors.white} />
                <Text style={styles.shareText}>Share</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleRevoke} style={styles.revokeButton}>
              <MaterialCommunityIcons name="close-circle-outline" size={18} color={colors.danger} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  vehicle: { fontSize: 13, fontFamily: 'monospace', color: colors.info, letterSpacing: 1 },
  validity: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: '700' },
  activeSection: { marginTop: spacing.md },
  otpBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.infoBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  otpCode: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.info,
    letterSpacing: 4,
    fontFamily: 'monospace',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  shareButton: { flex: 1 },
  shareGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  shareText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  revokeButton: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
});
