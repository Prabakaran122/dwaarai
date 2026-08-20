import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button } from '../components/ui';
import { useEventsStore, Stall, StallType } from '../store/eventsStore';
import { useAuthStore } from '../store/authStore';
import { payWithRazorpay, confirmPayment } from '../lib/checkout';

// Mirrors platformFeePaise() in services/api-gateway/src/lib/money.js: 3% of
// the stall fee, rounded to a whole rupee. Duplicated deliberately so the
// summary can be shown before the server is asked — the server's figure is
// still the one charged.
export const PLATFORM_FEE_RATE = 0.03;

export function platformFeePaise(stallFeePaise: number): number {
  return Math.round((stallFeePaise * PLATFORM_FEE_RATE) / 100) * 100;
}

export function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TYPES: { key: StallType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'standard', label: 'Standard' },
  { key: 'premium', label: 'Premium' },
  { key: 'corner', label: 'Corner' },
];

export default function StallBookingScreen({
  eventId, eventTitle, onBack, onBooked,
}: {
  eventId: string;
  eventTitle: string;
  onBack: () => void;
  onBooked: (stallCode: string, amountPaise: number) => void;
}) {
  const { stalls, loading, fetchStalls, book } = useEventsStore();
  const user = useAuthStore((s) => s.user);
  const [selected, setSelected] = useState<Stall | null>(null);
  const [typeFilter, setTypeFilter] = useState<StallType | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { fetchStalls(eventId); }, [eventId, fetchStalls]);

  const available = stalls.filter((s) => s.status === 'available').length;

  // Grid position comes from the server so the map matches the layout the RWA
  // built in the admin portal.
  const rows = useMemo(() => {
    const byRow = new Map<number, Stall[]>();
    for (const s of stalls) {
      const list = byRow.get(s.rowIndex) ?? [];
      list.push(s);
      byRow.set(s.rowIndex, list);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, list]) => list.sort((a, b) => a.colIndex - b.colIndex));
  }, [stalls]);

  const fee = selected ? platformFeePaise(selected.pricePaise) : 0;
  const total = selected ? selected.pricePaise + fee : 0;

  const pay = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await book(eventId, selected.id);
      if ('error' in res) {
        setMessage(res.error === 'taken'
          ? 'That stall was just taken. Pick another one.'
          : 'Could not start the booking. Please try again.');
        setSelected(null);
        return;
      }

      const outcome = await payWithRazorpay(
        res.payment,
        { name: user?.name, phone: user?.phone },
        `${eventTitle} · Stall ${selected.code}`,
      );

      if (!outcome.ok) {
        setMessage(
          outcome.reason === 'unavailable'
            ? 'Payments are not enabled in this build yet. Your stall is held for 15 minutes.'
            : outcome.reason === 'cancelled'
              ? 'Payment cancelled. The stall is held for 15 minutes.'
              : outcome.message ?? 'Payment failed.',
        );
        return;
      }

      // The gateway said yes; the server has the final word.
      const status = await confirmPayment(res.payment.paymentOrderId);
      if (status === 'paid') {
        onBooked(selected.code, total);
      } else if (status === 'pending') {
        setMessage('Payment is still confirming. We will update your booking as soon as it clears.');
      } else {
        setMessage('The payment did not go through. Nothing has been charged.');
      }
    } finally {
      setBusy(false);
      await fetchStalls(eventId);
    }
  }, [selected, busy, book, eventId, eventTitle, user, total, onBooked, fetchStalls]);

  return (
    <View style={styles.container}>
      <AppBar title="Book a stall" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <Text style={type.caption}>{eventTitle}</Text>
          <Text style={styles.stat} testID="availability">
            {available} of {stalls.length} stalls available
          </Text>
        </Card>

        <View style={styles.chips}>
          {TYPES.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTypeFilter(t.key)}
              style={[styles.chip, typeFilter === t.key && styles.chipActive]}
            >
              <Text style={typeFilter === t.key ? styles.chipLabelActive : styles.chipLabel}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {loading && !stalls.length ? (
          <ActivityIndicator style={styles.block} color={colors.brandPrimary} />
        ) : (
          <Card style={styles.block}>
            {rows.map((row, i) => (
              <View key={i} style={styles.row}>
                {row.map((s) => {
                  const taken = s.status !== 'available';
                  const dimmed = typeFilter !== 'all' && s.stallType !== typeFilter;
                  const isSelected = selected?.id === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      testID={`stall-${s.code}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Stall ${s.code}, ${s.stallType}, ${inr(s.pricePaise)}${taken ? ', already booked' : ''}`}
                      accessibilityState={{ disabled: taken, selected: isSelected }}
                      disabled={taken}
                      onPress={() => setSelected(isSelected ? null : s)}
                      style={[
                        styles.stall,
                        taken && styles.stallTaken,
                        isSelected && styles.stallSelected,
                        dimmed && styles.stallDimmed,
                      ]}
                    >
                      <Text style={[styles.stallCode, isSelected && styles.stallCodeSelected]}>{s.code}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <View style={styles.legend}>
              <Legend color={colors.surface} label="Available" bordered />
              <Legend color={colors.actionPrimary} label="Selected" />
              <Legend color={colors.textTertiary} label="Taken" />
            </View>
          </Card>
        )}

        {selected && (
          <Card style={styles.block}>
            <Text style={type.caption}>Booking summary</Text>
            <Line label={`Stall ${selected.code} (${selected.stallType})`} value={inr(selected.pricePaise)} />
            {/* A line item, not folded into the price — the product owner
                confirmed this in the BRD's open questions (OQ-02). */}
            <Line label="Platform fee (3%)" value={inr(fee)} />
            <View style={styles.divider} />
            <Line label="Total payable" value={inr(total)} strong />
          </Card>
        )}

        {message && <Text style={styles.message}>{message}</Text>}

        <View style={styles.block}>
          <Button
            title={selected ? `Pay ${inr(total)}` : 'Select a stall'}
            onPress={pay}
            disabled={!selected || busy}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={strong ? styles.lineLabelStrong : styles.lineLabel}>{label}</Text>
      <Text style={strong ? styles.lineValueStrong : styles.lineValue}>{value}</Text>
    </View>
  );
}

function Legend({ color, label, bordered }: { color: string; label: string; bordered?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }, bordered && styles.legendSwatchBordered]} />
      <Text style={type.micro}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  block: { marginTop: spacing.md },
  stat: { ...type.h3, color: colors.textPrimary, marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipLabel: { ...type.caption, color: colors.textSecondary },
  chipLabelActive: { ...type.caption, color: colors.textInverse },
  row: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  stall: {
    width: 52, height: 44, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  stallSelected: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  stallTaken: { backgroundColor: colors.textTertiary, borderColor: colors.textTertiary },
  // The BRD asks for non-matching stalls at 30% while a type filter is on.
  stallDimmed: { opacity: 0.3 },
  stallCode: { ...type.caption, color: colors.textPrimary },
  stallCodeSelected: { color: colors.textInverse },
  legend: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendSwatch: { width: 12, height: 12, borderRadius: 3 },
  legendSwatchBordered: { borderWidth: 1, borderColor: colors.surfaceBorder },
  line: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  lineLabel: { ...type.body, color: colors.textSecondary },
  lineValue: { ...type.body, color: colors.textPrimary },
  lineLabelStrong: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  lineValueStrong: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.surfaceBorder, marginTop: spacing.sm },
  message: { ...type.caption, color: colors.textError, marginTop: spacing.md },
});
