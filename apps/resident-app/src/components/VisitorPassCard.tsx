import React from 'react';
import { View, Text, StyleSheet, Linking, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type as type_ } from '../theme/typography';
import Card from './ui/Card';
import Button from './ui/Button';
import StatusBadge from './ui/StatusBadge';
import type { BadgePreset } from './ui/StatusBadge';

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

/** Map pass status → StatusBadge preset */
function statusPreset(status: PassData['status']): BadgePreset {
  switch (status) {
    case 'active':  return 'granted';
    case 'used':    return 'info';
    case 'expired': return 'pending';
    case 'revoked': return 'denied';
  }
}

/** Map status → Card accent colour */
function accentColor(status: PassData['status']): string {
  switch (status) {
    case 'active':  return colors.success;
    case 'used':    return colors.info;
    case 'expired': return colors.textTertiary;
    case 'revoked': return colors.error;
  }
}

interface Props {
  pass: PassData;
  residentName: string;
  unitNumber: string;
  communityName?: string;
  onRevoke: (id: string) => void;
}

export default function VisitorPassCard({ pass, residentName, unitNumber, communityName, onRevoke }: Props) {
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
    <Card accent={accentColor(pass.status)} style={styles.card}>
      {/* Header row */}
      <View style={styles.header}>
        <View style={styles.info}>
          <Text style={styles.name}>{pass.visitor_name}</Text>
          {pass.visitor_vehicle ? (
            <Text style={styles.vehicle}>{pass.visitor_vehicle}</Text>
          ) : null}
          <Text style={styles.validity}>Valid until {validUntil} · {usesText}</Text>
        </View>
        <StatusBadge preset={statusPreset(pass.status)} size="sm" />
      </View>

      {/* OTP + actions — only when pass is active */}
      {pass.status === 'active' && (
        <View style={styles.activeSection}>
          {/* OTP box */}
          <View style={styles.otpBox}>
            <MaterialCommunityIcons name="qrcode" size={20} color={colors.teal} />
            <Text style={styles.otpCode}>{pass.otp}</Text>
          </View>

          {/* Action row */}
          <View style={styles.actions}>
            <Button
              title="Share"
              icon="whatsapp"
              variant="primary"
              onPress={shareWhatsApp}
              style={styles.shareBtn}
            />
            <Button
              title="Revoke"
              icon="close-circle-outline"
              variant="destructive"
              onPress={handleRevoke}
              style={styles.revokeBtn}
            />
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  info: { flex: 1, gap: 2, paddingRight: spacing.sm },
  name: { ...font(500), fontSize: 16, color: colors.textPrimary },
  vehicle: { ...font(400), fontSize: 13, fontFamily: 'monospace', color: colors.textInfo, letterSpacing: 1 },
  validity: { ...font(400), fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  activeSection: { gap: spacing.sm },
  otpBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.tintInfo,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  otpCode: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textInfo,
    letterSpacing: 4,
    fontFamily: 'monospace',
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  shareBtn: { flex: 1, minWidth: 0 },
  revokeBtn: { minWidth: 0 },
});
