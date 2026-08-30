import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { AppBar, Card, Button } from '../components/ui';
import * as api from '../api/client';
import type { Stall } from '../store/eventsStore';

/**
 * Stall map and booking summary (BRD FR-STL-01..08).
 *
 * Every rupee shown here comes from the server. The gateway computes the stall
 * fee, the 3% platform fee and the total in paise; this screen only formats
 * them. Recomputing the fee client-side is how a checkout total starts
 * disagreeing with the receipt the guest is emailed.
 */

const STALL_TYPES = ['standard', 'premium', 'corner'] as const;
type StallType = (typeof STALL_TYPES)[number];

function rupees(paise: number): string {
  // Whole rupees read better at a stall counter; the paise are always .00 for
  // the fee anyway (money.js rounds it to the nearest rupee).
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function StallBookingScreen({
  eventId, eventTitle, onBack, onBooked,
}: {
  eventId: string;
  eventTitle: string;
  onBack: () => void;
  onBooked?: (booking: { stallCode: string; totalPaise: number; paymentPlaceholder: boolean }) => void;
}) {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<StallType | null>(null);
  const [selected, setSelected] = useState<Stall | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The gateway tells us when an order is a placeholder. Saying "paid" when no
  // money moved is the one thing this screen must never do.
  const [placeholder, setPlaceholder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getEventStalls(eventId);
      setStalls(res.data.data?.stalls || []);
      setError(null);
    } catch {
      setError('Could not load the stall map.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // FR-STL-06: a stall booked by anyone else — including through the public
  // guest link — must stop being offered here. Polling is the floor; the map
  // is small and a stale "available" that fails at payment is worse.
  useEffect(() => {
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  // FR-STL-03: one stall per booking session. Selecting another replaces the
  // selection rather than adding to it.
  const select = (stall: Stall) => {
    if (stall.status !== 'available') return;
    setSelected((prev) => (prev?.id === stall.id ? null : stall));
  };

  const confirm = async () => {
    if (!selected) return;
    setBooking(true);
    setError(null);
    try {
      const res = await api.bookStall(eventId, selected.id);
      const data = res.data.data || {};
      setPlaceholder(Boolean(data.paymentPlaceholder));
      onBooked?.({
        stallCode: selected.code,
        totalPaise: selected.totalPaise,
        paymentPlaceholder: Boolean(data.paymentPlaceholder),
      });
      // The server reserves the stall and opens a payment order; the reservation
      // expires on its own if checkout is abandoned, so nothing leaks.
      setSelected(null);
      await load();
    } catch (err) {
      const code = (err as { response?: { status?: number } })?.response?.status;
      const message = code === 409
        ? 'Someone just booked that stall. Pick another.'
        : 'Could not reserve that stall. Try again.';
      // Refresh FIRST, then set the message. load() clears `error` on success,
      // so setting it before the refresh would silently wipe the very message
      // explaining why the booking failed.
      await load();
      setError(message);
      setSelected(null);
    } finally {
      setBooking(false);
    }
  };

  const rows = Array.from(new Set(stalls.map((s) => s.row))).sort((a, b) => a - b);

  return (
    <View style={styles.container}>
      <AppBar title="Book a stall" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={type.bodySecondary}>{eventTitle}</Text>

        {/* FR-STL-08: non-matching stalls fade rather than disappear, so the
            map keeps its shape and a stall's position stays recognisable. */}
        <View style={styles.chips}>
          <Pressable
            testID="stall-type-all"
            onPress={() => setTypeFilter(null)}
            style={[styles.chip, !typeFilter && styles.chipOn]}
          >
            <Text style={[styles.chipText, !typeFilter && styles.chipTextOn]}>All</Text>
          </Pressable>
          {STALL_TYPES.map((t) => (
            <Pressable
              key={t}
              testID={`stall-type-${t}`}
              onPress={() => setTypeFilter(typeFilter === t ? null : t)}
              style={[styles.chip, typeFilter === t && styles.chipOn]}
            >
              <Text style={[styles.chipText, typeFilter === t && styles.chipTextOn]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        {loading && stalls.length === 0 ? (
          <ActivityIndicator color={colors.teal} style={{ marginTop: spacing.xl }} />
        ) : stalls.length === 0 ? (
          <Card><Text style={type.bodySecondary}>No stalls have been set up for this event yet.</Text></Card>
        ) : (
          <View style={styles.map} testID="stall-map">
            {rows.map((r) => (
              <View key={r} style={styles.row}>
                {stalls.filter((s) => s.row === r).sort((a, b) => a.col - b.col).map((s) => {
                  const dimmed = typeFilter !== null && s.stallType !== typeFilter;
                  const isSelected = selected?.id === s.id;
                  const taken = s.status !== 'available';
                  return (
                    <Pressable
                      key={s.id}
                      testID={`stall-${s.code}`}
                      onPress={() => select(s)}
                      disabled={taken}
                      style={[
                        styles.stall,
                        taken && styles.stallTaken,
                        isSelected && styles.stallSelected,
                        dimmed && styles.stallDimmed,
                      ]}
                    >
                      <Text style={[styles.stallCode, isSelected && styles.stallCodeOn]}>{s.code}</Text>
                      <Text style={styles.stallPrice}>{rupees(s.pricePaise)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        <View style={styles.legend}>
          <Legend color={colors.surface} label="Available" />
          <Legend color={colors.actionPrimary} label="Selected" />
          <Legend color={colors.surfaceBorder} label="Booked" />
        </View>

        {placeholder && (
          <Text style={styles.placeholder} testID="payment-placeholder">
            Online payment is not live yet — this reserves the stall only.
          </Text>
        )}

        {error && <Text style={styles.error} testID="stall-error">{error}</Text>}
      </ScrollView>

      {/* FR-STL-04: the summary names every figure separately — stall fee,
          platform fee, total — so the 3% is never a surprise at payment. */}
      {selected && (
        <View style={styles.summary} testID="booking-summary">
          <SummaryRow label={`Stall ${selected.code} · ${selected.stallType}`} value={rupees(selected.pricePaise)} />
          <SummaryRow label="Platform fee (3%)" value={rupees(selected.platformFeePaise)} />
          <View style={styles.divider} />
          <SummaryRow label="Total payable" value={rupees(selected.totalPaise)} bold />
          <Button
            testID="confirm-booking"
            title={booking ? 'Reserving…' : 'Pay and book'}
            onPress={confirm}
            disabled={booking}
          />
        </View>
      )}
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, bold && styles.summaryBold]}>{label}</Text>
      <Text style={[styles.summaryValue, bold && styles.summaryBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['5xl'] },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  chipText: { ...font(500), fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize' },
  chipTextOn: { color: colors.textInverse },
  map: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  stall: {
    minWidth: 74, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface, alignItems: 'center', gap: 2,
  },
  stallSelected: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  stallTaken: { backgroundColor: colors.surfaceBorder, opacity: 0.55 },
  stallDimmed: { opacity: 0.3 },
  stallCode: { ...font(500), fontSize: 13, color: colors.textPrimary },
  stallCodeOn: { color: colors.textInverse },
  stallPrice: { ...font(400), fontSize: 11, color: colors.textSecondary },
  legend: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendSwatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: colors.surfaceBorder },
  legendText: { ...font(400), fontSize: 11, color: colors.textSecondary },
  error: { ...font(500), fontSize: 13, color: colors.danger },
  placeholder: { ...font(500), fontSize: 12, color: colors.textWarning },
  summary: {
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.surfaceBorder,
    padding: spacing.lg, gap: spacing.xs,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { ...font(400), fontSize: 13, color: colors.textSecondary },
  summaryValue: { ...font(500), fontSize: 13, color: colors.textPrimary },
  summaryBold: { ...font(700), fontSize: 15, color: colors.textPrimary },
  divider: { height: 1, backgroundColor: colors.surfaceBorder, marginVertical: spacing.xs },
});
