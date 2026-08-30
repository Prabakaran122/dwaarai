import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { Card } from './ui';
import * as api from '../api/client';
import type { DonationFund } from '../store/eventsStore';

/**
 * Community donation card (BRD FR-DON-02, FR-DON-03).
 *
 * No platform fee is charged on donations — that is a deliberate product
 * decision, not an oversight (FR-DON-04): taking a cut of a religious or
 * community collection is what turns residents against the platform. The card
 * says so out loud, because the resident has no other way to know.
 */

// FR-DON-03. The amounts are the customary Indian offering denominations, not
// round numbers — ₹51 and ₹101 are what people actually give.
const QUICK_AMOUNTS = [51, 101, 251, 501];

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function DonationCard({
  fund, onDonated,
}: {
  fund: DonationFund;
  onDonated?: () => void;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const chosenRupees = amount ?? (custom.trim() ? Number(custom.trim()) : 0);
  const valid = Number.isFinite(chosenRupees) && chosenRupees > 0;

  const give = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.donate(fund.id, Math.round(chosenRupees * 100));
      setDone(true);
      setAmount(null);
      setCustom('');
      onDonated?.();
    } catch {
      setError('Could not start the payment. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID={`donation-fund-${fund.id}`}>
      <Text style={type.h3}>{fund.name}</Text>
      {fund.description ? <Text style={type.bodySecondary}>{fund.description}</Text> : null}

      {/* FR-DON-02: raised, target, and a filled progress bar. */}
      <View style={styles.progressRow}>
        <Text style={styles.raised}>{rupees(fund.raisedPaise)}</Text>
        <Text style={styles.target}>of {rupees(fund.targetPaise)}</Text>
      </View>
      <View style={styles.track} testID="donation-progress">
        <View style={[styles.fill, { width: `${Math.min(100, fund.percent)}%` }]} />
      </View>
      <Text style={styles.meta}>
        {fund.percent}% raised · {fund.donorCount} {fund.donorCount === 1 ? 'donor' : 'donors'}
      </Text>

      {done ? (
        <Text style={styles.thanks} testID="donation-thanks">
          Thank you — your contribution has been recorded.
        </Text>
      ) : (
        <>
          <View style={styles.amounts}>
            {QUICK_AMOUNTS.map((a) => (
              <Pressable
                key={a}
                testID={`donate-${a}`}
                onPress={() => { setAmount(a); setCustom(''); }}
                style={[styles.amount, amount === a && styles.amountOn]}
              >
                <Text style={[styles.amountText, amount === a && styles.amountTextOn]}>₹{a}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            testID="donate-custom"
            value={custom}
            onChangeText={(t) => { setCustom(t.replace(/[^0-9]/g, '')); setAmount(null); }}
            placeholder="Other amount"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
            style={styles.input}
          />

          {error && <Text style={styles.error} testID="donation-error">{error}</Text>}

          <Pressable
            testID="donate-submit"
            onPress={give}
            disabled={!valid || busy}
            style={[styles.cta, (!valid || busy) && styles.ctaOff]}
          >
            {busy
              ? <ActivityIndicator color={colors.textInverse} />
              : <Text style={styles.ctaText}>Donate{valid ? ` ₹${chosenRupees}` : ''}</Text>}
          </Pressable>

          {/* FR-DON-04, stated to the resident rather than only in the schema. */}
          <Text style={styles.noFee}>No platform fee is charged on donations.</Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginTop: spacing.sm },
  raised: { ...font(700), fontSize: 20, color: colors.textPrimary },
  target: { ...font(400), fontSize: 13, color: colors.textSecondary },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceBorder, marginTop: spacing.xs, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.teal },
  meta: { ...font(400), fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs },
  amounts: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  amount: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  amountOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  amountText: { ...font(500), fontSize: 14, color: colors.textPrimary },
  amountTextOn: { color: colors.textInverse },
  input: {
    marginTop: spacing.sm, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  cta: {
    marginTop: spacing.md, backgroundColor: colors.teal, borderRadius: radius.sm,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  ctaOff: { opacity: 0.4 },
  ctaText: { ...font(700), fontSize: 15, color: colors.textInverse },
  noFee: { ...font(400), fontSize: 11, color: colors.textTertiary, marginTop: spacing.xs, textAlign: 'center' },
  thanks: { ...font(500), fontSize: 14, color: colors.textSuccess, marginTop: spacing.md },
  error: { ...font(500), fontSize: 13, color: colors.danger, marginTop: spacing.sm },
});
