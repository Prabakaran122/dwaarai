import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Pass {
  id: string;
  visitorName: string;
  visitorPhone: string;
  otp: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  validFrom: string;
  validUntil: string;
}

interface PassCardProps {
  pass: Pass;
  onRevoke: (id: string) => void;
}

const STATUS_COLORS: Record<Pass['status'], string> = {
  active: '#16a34a',
  used: '#2563eb',
  expired: '#94a3b8',
  revoked: '#dc2626',
};

export default function PassCard({ pass, onRevoke }: PassCardProps) {
  const [showOtp, setShowOtp] = useState(false);

  const validUntil = new Date(pass.validUntil).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setShowOtp((v) => !v)}
      onLongPress={() => pass.status === 'active' && onRevoke(pass.id)}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        <Text style={styles.name}>{pass.visitorName}</Text>
        <View
          style={[
            styles.badge,
            { backgroundColor: STATUS_COLORS[pass.status] + '20' },
          ]}
        >
          <Text
            style={[styles.badgeText, { color: STATUS_COLORS[pass.status] }]}
          >
            {pass.status}
          </Text>
        </View>
      </View>
      <Text style={styles.phone}>{pass.visitorPhone}</Text>
      <Text style={styles.validity}>Valid until {validUntil}</Text>

      {showOtp && pass.status === 'active' && (
        <View style={styles.otpBox}>
          <Text style={styles.otpLabel}>OTP</Text>
          <Text style={styles.otpCode}>{pass.otp}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  name: { fontSize: 17, fontWeight: '600', color: '#1e293b' },
  phone: { fontSize: 14, color: '#64748b', marginBottom: 2 },
  validity: { fontSize: 13, color: '#94a3b8' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  otpBox: {
    marginTop: 12,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  otpLabel: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  otpCode: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2563eb',
    letterSpacing: 4,
  },
});
