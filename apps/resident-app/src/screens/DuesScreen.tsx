import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { useDueStore, Due } from '../store/dueStore';
import { useAuthStore } from '../store/authStore';

// Razorpay checkout is a native module that must be added to a dev/production build.
// We load it optionally so the rest of the app runs in Expo Go without it.
function getRazorpayCheckout(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-razorpay').default;
  } catch {
    return null;
  }
}

function inr(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DuesScreen({ onClose }: { onClose: () => void }) {
  const { dues, outstanding, history, loading, fetch, fetchHistory, startPayment, checkPayment } = useDueStore();
  const user = useAuthStore((s) => s.user);
  const [paying, setPaying] = useState<string | null>(null);

  useEffect(() => {
    fetch();
    fetchHistory().catch(() => {});
  }, []);

  const pollPayment = async (paymentId: string) => {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const { status } = await checkPayment(paymentId);
        if (status === 'paid') {
          Alert.alert('Payment confirmed', 'Your maintenance payment is recorded. A receipt is available in your history.');
          await fetch();
          await fetchHistory().catch(() => {});
          return;
        }
      } catch { /* keep polling */ }
    }
    // Not confirmed within the window — refresh quietly; the webhook may still land.
    await fetch();
  };

  const handlePay = async (due: Due) => {
    setPaying(due.id);
    try {
      const order = await startPayment(due.id);
      const Checkout = getRazorpayCheckout();

      if (!Checkout || !order.keyId) {
        Alert.alert(
          'Checkout not available in this build',
          order.testMode
            ? 'Payments are in test mode — add Razorpay keys and the react-native-razorpay module to take live payments. Your due is unchanged.'
            : 'The payment module isn’t bundled in this build yet.',
        );
        return;
      }

      const result = await Checkout.open({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Dwaar AI',
        description: `Maintenance · ${due.period}`,
        prefill: { name: user?.name, contact: user?.phone },
        theme: { color: '#3b82f6' },
      });

      if (result?.razorpay_payment_id) {
        // Don't claim success yet — the server confirms via webhook. Poll for it.
        await pollPayment(order.paymentId);
      }
    } catch (err: any) {
      // User-cancelled checkouts throw too; only surface real errors.
      const msg = err?.response?.data?.error?.message;
      if (msg) Alert.alert('Payment error', msg);
    } finally {
      setPaying(null);
    }
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Maintenance</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} refreshControl={undefined}>
        {/* Outstanding summary */}
        <AnimatedEntry direction="fade">
          <GlowCard style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total outstanding</Text>
            <Text style={styles.summaryAmount}>{inr(outstanding)}</Text>
            {outstanding === 0 ? (
              <View style={styles.clearRow}>
                <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
                <Text style={styles.clearText}>You're all paid up.</Text>
              </View>
            ) : (
              <Text style={styles.summaryHint}>{dues.length} pending {dues.length === 1 ? 'item' : 'items'}</Text>
            )}
          </GlowCard>
        </AnimatedEntry>

        {loading && dues.length === 0 ? (
          <ActivityIndicator color={colors.info} style={{ marginTop: spacing.xl }} />
        ) : null}

        {/* Pending dues */}
        {dues.map((due, i) => (
          <AnimatedEntry key={due.id} direction="up" delay={100 + i * 80}>
            <GlowCard style={styles.dueCard}>
              <View style={styles.dueTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.duePeriod}>{due.description || 'Maintenance'} · {due.period}</Text>
                  {due.dueDate ? (
                    <Text style={[styles.dueDate, due.isOverdue && styles.overdue]}>
                      {due.isOverdue ? 'Overdue · ' : 'Due '}{new Date(due.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.dueTotal}>{inr(due.totalAmount)}</Text>
              </View>

              <View style={styles.breakdown}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Base amount</Text>
                  <Text style={styles.breakdownVal}>{inr(due.baseAmount)}</Text>
                </View>
                {due.penaltyAmount > 0 ? (
                  <View style={styles.breakdownRow}>
                    <Text style={[styles.breakdownLabel, styles.overdue]}>Late penalty</Text>
                    <Text style={[styles.breakdownVal, styles.overdue]}>{inr(due.penaltyAmount)}</Text>
                  </View>
                ) : null}
              </View>

              <GradientButton
                title={paying === due.id ? 'Starting…' : 'Pay now'}
                icon="credit-card"
                variant="success"
                onPress={() => handlePay(due)}
              />
            </GlowCard>
          </AnimatedEntry>
        ))}

        {/* Payment history */}
        {history.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Payment history</Text>
            {history.map((p) => (
              <GlowCard key={p.id} style={styles.historyCard}>
                <View style={styles.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyPeriod}>{p.description || 'Maintenance'} · {p.period}</Text>
                    <Text style={styles.historyMeta}>
                      {p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                      {p.receiptNo ? `  ·  ${p.receiptNo}` : ''}
                      {p.gateway === 'manual' ? '  ·  offline' : ''}
                    </Text>
                  </View>
                  <Text style={styles.historyAmount}>{inr(p.amount)}</Text>
                </View>
              </GlowCard>
            ))}
          </>
        ) : null}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing['3xl'], paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { width: 28, alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  summaryCard: { marginBottom: spacing.lg, alignItems: 'center', paddingVertical: spacing.xl },
  summaryLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  summaryAmount: { fontSize: 40, fontWeight: '800', color: colors.textPrimary, marginVertical: spacing.xs },
  summaryHint: { fontSize: 13, color: colors.textMuted },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  clearText: { fontSize: 13, color: colors.success, fontWeight: '600' },
  dueCard: { marginBottom: spacing.md },
  dueTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  duePeriod: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  dueDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  overdue: { color: colors.danger },
  dueTotal: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  breakdown: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md, gap: spacing.xs },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel: { fontSize: 13, color: colors.textMuted },
  breakdownVal: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.md },
  historyCard: { marginBottom: spacing.sm },
  historyRow: { flexDirection: 'row', alignItems: 'center' },
  historyPeriod: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  historyMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  historyAmount: { fontSize: 15, fontWeight: '700', color: colors.success },
});
