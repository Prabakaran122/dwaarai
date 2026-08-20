import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button } from '../components/ui';
import { useEventsStore, Fund } from '../store/eventsStore';
import { useAuthStore } from '../store/authStore';
import { payWithRazorpay, confirmPayment } from '../lib/checkout';
import { inr } from './StallBookingScreen';

// The BRD's quick-select ladder, in paise.
export const QUICK_AMOUNTS = [5100, 10100, 25100, 50100];

export function progressPercent(raisedPaise: number, targetPaise: number): number {
  if (!targetPaise || targetPaise <= 0) return 0;
  // Capped: a fund that overshoots its target should read as full, not as a
  // bar running off the end of the card.
  return Math.min(100, Math.round((raisedPaise / targetPaise) * 100));
}

export function parseCustomAmount(text: string): number | null {
  const rupees = Number(String(text).replace(/[^0-9.]/g, ''));
  if (!isFinite(rupees) || rupees <= 0) return null;
  return Math.round(rupees * 100);
}

export default function DonateSheet({
  fund, onClose, onDonated,
}: {
  fund: Fund;
  onClose: () => void;
  onDonated: (amountPaise: number) => void;
}) {
  const { startDonation, fetchFunds } = useEventsStore();
  const user = useAuthStore((s) => s.user);
  const [amountPaise, setAmountPaise] = useState<number>(QUICK_AMOUNTS[1]);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const parsed = parseCustomAmount(custom);
    if (parsed) setAmountPaise(parsed);
  }, [custom]);

  const pct = progressPercent(fund.raisedPaise, fund.targetPaise);

  const give = useCallback(async () => {
    if (busy || amountPaise <= 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await startDonation(fund.id, amountPaise);
      if ('error' in res) {
        setMessage('Could not start the donation. Please try again.');
        return;
      }

      const outcome = await payWithRazorpay(
        res.payment,
        { name: user?.name, phone: user?.phone },
        `Donation · ${fund.name}`,
      );
      if (!outcome.ok) {
        setMessage(
          outcome.reason === 'unavailable'
            ? 'Payments are not enabled in this build yet.'
            : outcome.reason === 'cancelled'
              ? 'Donation cancelled. Nothing has been charged.'
              : outcome.message ?? 'Payment failed.',
        );
        return;
      }

      const status = await confirmPayment(res.payment.paymentOrderId);
      if (status === 'paid') {
        onDonated(amountPaise);
      } else if (status === 'pending') {
        setMessage('Your donation is confirming. The total will update shortly.');
      } else {
        setMessage('The payment did not go through. Nothing has been charged.');
      }
    } finally {
      setBusy(false);
      await fetchFunds();
    }
  }, [busy, amountPaise, startDonation, fund, user, onDonated, fetchFunds]);

  return (
    <View style={styles.container}>
      <AppBar title="Donate" onBack={onClose} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <Text style={type.h2}>{fund.name}</Text>
          {!!fund.description && <Text style={styles.desc}>{fund.description}</Text>}

          <View style={styles.track} testID="fund-progress" accessibilityLabel={`${pct} percent of target raised`}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.raised}>
            {inr(fund.raisedPaise)} raised of {inr(fund.targetPaise)}
          </Text>
        </Card>

        <Card style={styles.block}>
          <Text style={type.caption}>Choose an amount</Text>
          <View style={styles.chips}>
            {QUICK_AMOUNTS.map((a) => (
              <Pressable
                key={a}
                onPress={() => { setCustom(''); setAmountPaise(a); }}
                accessibilityState={{ selected: amountPaise === a && !custom }}
                style={[styles.chip, amountPaise === a && !custom && styles.chipActive]}
              >
                <Text style={amountPaise === a && !custom ? styles.chipLabelActive : styles.chipLabel}>
                  {`₹${a / 100}`}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Other amount"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
            value={custom}
            onChangeText={setCustom}
          />
          {/* No platform fee line, and not by omission: the BRD makes
              donations fee-free on purpose (FR-DON-04). */}
          <Text style={type.micro}>Every rupee goes to the fund. Dwaar AI takes no fee on donations.</Text>
        </Card>

        {message && <Text style={styles.message}>{message}</Text>}

        <View style={styles.block}>
          <Button title={`Donate ${inr(amountPaise)}`} onPress={give} disabled={busy || amountPaise <= 0} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  block: { marginTop: spacing.md },
  desc: { ...type.bodySecondary, marginTop: spacing.xs },
  track: {
    height: 10, borderRadius: radius.pill, backgroundColor: colors.mist,
    marginTop: spacing.md, overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.teal },
  raised: { ...type.caption, marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  chipLabel: { ...type.body, color: colors.textSecondary },
  chipLabelActive: { ...type.body, color: colors.textInverse },
  input: {
    borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginTop: spacing.sm, marginBottom: spacing.sm, color: colors.textPrimary,
  },
  message: { ...type.caption, color: colors.textError, marginTop: spacing.md },
});
