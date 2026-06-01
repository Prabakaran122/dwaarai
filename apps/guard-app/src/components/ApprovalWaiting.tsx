import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import AnimatedEntry from './AnimatedEntry';
import { useApprovalStore, type ApprovalRequest } from '../store/approvalStore';
import { getApproval } from '../api/client';
import { useT } from '../store/langStore';

interface Props {
  onDismiss: () => void;
  gateId: string;
}

export default function ApprovalWaiting({ onDismiss, gateId }: Props) {
  const approvals = useApprovalStore((s) => s.approvals);
  const updateApproval = useApprovalStore((s) => s.updateApproval);
  const removeApproval = useApprovalStore((s) => s.removeApproval);
  const t = useT();

  const current = approvals[0];

  // Countdown timer
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!current || current.status !== 'pending') return;

    const update = () => {
      const remaining = Math.max(0, Math.floor((new Date(current.expires_at).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [current?.id, current?.status, current?.expires_at]);

  // Polling fallback (every 3s when pending)
  useEffect(() => {
    if (!current || current.status !== 'pending') return;

    const poll = setInterval(async () => {
      try {
        const res = await getApproval(current.id);
        const data = res.data.data;
        if (data.status !== 'pending') {
          updateApproval(current.id, {
            status: data.status,
            responded_by_name: data.responded_by_name,
          });
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [current?.id, current?.status]);

  if (!current) return null;

  const isPending = current.status === 'pending';
  const isApproved = current.status === 'approved';
  const isDenied = current.status === 'denied';
  const isExpired = current.status === 'expired';

  const statusConfig = {
    pending: { icon: 'clock-outline' as const, color: colors.info, text: `${secondsLeft}s` },
    approved: { icon: 'check-circle' as const, color: colors.success, text: current.responded_by_name || t('resident') },
    denied: { icon: 'close-circle' as const, color: colors.danger, text: t('deniedByResident') },
    expired: { icon: 'clock-alert' as const, color: colors.warning, text: t('noResponse') },
  };

  const cfg = statusConfig[current.status] || statusConfig.pending;

  return (
    <AnimatedEntry direction="fade" duration={200}>
      <GlowCard variant={isApproved ? 'success' : isDenied ? 'danger' : undefined} style={styles.card}>
        <Text style={styles.label}>{t('approvalRequest')}</Text>

        <View style={styles.infoRow}>
          <Text style={styles.visitorName}>{current.visitor_name}</Text>
          <Text style={styles.detail}>Unit {current.unit_number} · {current.gate_name}</Text>
          {current.vehicle_plate && (
            <Text style={styles.detail}>Vehicle: {current.vehicle_plate}</Text>
          )}
        </View>

        <View style={styles.statusRow}>
          <MaterialCommunityIcons name={cfg.icon} size={28} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.text}</Text>
        </View>

        {isPending && (
          <Text style={styles.notifiedText}>
            {current.residents_notified} resident(s) notified
          </Text>
        )}

        <View style={styles.actions}>
          {(isExpired || isDenied) && (
            <GradientButton title={t('dismiss')} variant="danger" onPress={() => {
              removeApproval(current.id);
              if (approvals.length <= 1) onDismiss();
            }} />
          )}
          {isApproved && (
            <GradientButton title={t('done')} variant="success" onPress={() => {
              removeApproval(current.id);
              if (approvals.length <= 1) onDismiss();
            }} />
          )}
        </View>

        {approvals.length > 1 && (
          <Text style={styles.queueText}>+{approvals.length - 1} more pending</Text>
        )}
      </GlowCard>
    </AnimatedEntry>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  infoRow: { gap: spacing.xs },
  visitorName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  detail: { fontSize: 13, color: colors.textSecondary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  statusText: { fontSize: 16, fontWeight: '700' },
  notifiedText: { fontSize: 12, color: colors.textMuted },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  queueText: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
});
