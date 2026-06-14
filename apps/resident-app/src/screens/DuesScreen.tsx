import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button, SectionHeader } from '../components/ui';
import { useDueStore, Due } from '../store/dueStore';
import { useAuthStore } from '../store/authStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';

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
            : "The payment module isn’t bundled in this build yet.",
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
    <View style={styles.container}>
      <AppBar title="Maintenance dues" onBack={onClose} />

      <ScrollView contentContainerStyle={styles.scroll} refreshControl={undefined}>
        {/* Outstanding summary hero card */}
        <Card variant="hero" style={styles.summaryCard}>
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
        </Card>

        {loading && dues.length === 0 ? (
          <ActivityIndicator color={colors.info} style={{ marginTop: spacing.xl }} />
        ) : null}

        {/* Pending dues */}
        {dues.map((due) => (
          <Card key={due.id} style={styles.dueCard}>
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

            <Button
              title={paying === due.id ? 'Starting…' : 'Pay now'}
              icon="credit-card"
              variant="primary"
              onPress={() => handlePay(due)}
              loading={paying === due.id}
            />
          </Card>
        ))}

        {/* Payment history */}
        {history.length > 0 ? (
          <>
            <SectionHeader title="History" />
            {history.map((p) => (
              <Card key={p.id} style={styles.historyCard}>
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
              </Card>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  summaryCard: { marginBottom: spacing.lg, alignItems: 'center', paddingVertical: spacing.xl },
  summaryLabel: { ...type.caption, color: colors.textInverse, textTransform: 'uppercase', letterSpacing: 1 },
  summaryAmount: { fontSize: 40, fontFamily: 'DMSans_700Bold', color: colors.textInverse, marginVertical: spacing.xs },
  summaryHint: { ...type.bodySecondary, color: colors.overlayLight },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  clearText: { ...type.bodySecondary, color: colors.success, fontFamily: 'DMSans_500Medium' },
  dueCard: { marginBottom: spacing.md },
  dueTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  duePeriod: { ...type.h3, fontFamily: 'DMSans_700Bold' },
  dueDate: { ...type.micro, marginTop: 2 },
  overdue: { color: colors.danger },
  dueTotal: { fontSize: 20, fontFamily: 'DMSans_700Bold', color: colors.textPrimary },
  breakdown: { backgroundColor: colors.mist, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md, gap: spacing.xs },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel: { ...type.bodySecondary },
  breakdownVal: { ...type.bodySecondary, fontFamily: 'DMSans_500Medium', color: colors.textPrimary },
  historyCard: { marginBottom: spacing.sm },
  historyRow: { flexDirection: 'row', alignItems: 'center' },
  historyPeriod: { ...type.body, fontFamily: 'DMSans_500Medium' },
  historyMeta: { ...type.micro, marginTop: 2 },
  historyAmount: { fontSize: 15, fontFamily: 'DMSans_700Bold', color: colors.success },
});
