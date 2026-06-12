import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { AppBar, Card, Button, SectionHeader } from '../components/ui';
import * as api from '../api/client';

interface Facility { id: string; name: string; sport: string; slotMinutes: number; }
interface Slot { start: string; end: string; status: 'open' | 'booked' | 'mine' | 'past'; }
interface Booking { id: string; facilityName: string; sport: string; date: string; start: string; end: string; }

function nextDays(n: number): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.now() + i * 86400000);
    out.push({ date: d.toISOString().slice(0, 10), label: i === 0 ? 'Today' : `${wd[d.getDay()]} ${d.getDate()}` });
  }
  return out;
}
const DAYS = nextDays(7);

export default function FacilityBookingScreen({ onBack }: { onBack: () => void }) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [date, setDate] = useState(DAYS[0].date);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [mine, setMine] = useState<Booking[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    try { const r = await api.getMyBookings(); setMine(r.data.data || []); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    api.getFacilities().then((r) => {
      const fs: Facility[] = r.data.data || [];
      setFacilities(fs);
      if (fs[0]) setFacilityId(fs[0].id);
    }).catch(() => {});
    loadMine();
  }, [loadMine]);

  const loadAvailability = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true); setSelected(null); setMsg(null);
    try { const r = await api.getFacilityAvailability(facilityId, date); setSlots(r.data.data?.slots || []); }
    catch { setSlots([]); } finally { setLoading(false); }
  }, [facilityId, date]);
  useEffect(() => { loadAvailability(); }, [loadAvailability]);

  const book = async () => {
    if (!facilityId || !selected) return;
    setBooking(true); setMsg(null);
    try { await api.bookFacility(facilityId, { date, start: selected }); setSelected(null); await loadAvailability(); await loadMine(); }
    catch (e: any) { setMsg(e?.response?.data?.error?.message || 'Could not book that slot.'); }
    finally { setBooking(false); }
  };

  const cancel = async (id: string) => {
    try { await api.cancelBooking(id); await loadMine(); await loadAvailability(); } catch { /* ignore */ }
  };

  return (
    <View style={styles.container}>
      <AppBar title="Book a court" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.chipRow}>
          {facilities.map((f) => (
            <Text key={f.id} onPress={() => setFacilityId(f.id)} style={[styles.chip, facilityId === f.id && styles.chipActive]}>{f.name}</Text>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
          {DAYS.map((d) => (
            <Text key={d.date} onPress={() => setDate(d.date)} style={[styles.dateChip, date === d.date && styles.dateActive]}>{d.label}</Text>
          ))}
        </ScrollView>

        {loading ? <ActivityIndicator color={colors.teal} style={{ marginTop: spacing.lg }} /> : (
          <View style={styles.slots}>
            {slots.length === 0 ? <Text style={type.bodySecondary}>No slots available</Text> : slots.map((s) => {
              const isSel = selected === s.start;
              const open = s.status === 'open';
              return (
                <Text
                  key={s.start}
                  onPress={open ? () => setSelected(s.start) : undefined}
                  style={[
                    styles.slot,
                    s.status === 'booked' && styles.slotBooked,
                    s.status === 'mine' && styles.slotMine,
                    isSel && styles.slotSelected,
                  ]}
                >{s.start}</Text>
              );
            })}
          </View>
        )}

        {msg ? <Text style={[type.micro, styles.msg]}>{msg}</Text> : null}
        <Button title="Book selected slot" onPress={book} loading={booking} disabled={!selected} style={styles.bookBtn} />

        {mine.length > 0 && (
          <View style={styles.block}>
            <SectionHeader title="My bookings" />
            {mine.map((b) => (
              <Card key={b.id} style={styles.bookingCard}>
                <View style={{ flex: 1 }}>
                  <Text style={type.h3}>{b.facilityName}</Text>
                  <Text style={type.micro}>{b.date} · {b.start}–{b.end}</Text>
                </View>
                <Text onPress={() => cancel(b.id)} style={styles.cancel}>Cancel</Text>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { ...font(500), fontSize: 12, color: colors.textSecondary, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.surfaceBorder, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden' },
  chipActive: { backgroundColor: colors.brandPrimary, color: colors.textInverse, borderColor: colors.brandPrimary },
  dateRow: { gap: spacing.xs, paddingVertical: spacing.md },
  dateChip: { ...font(500), fontSize: 12, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden' },
  dateActive: { backgroundColor: colors.teal, color: colors.textInverse },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  slot: { ...font(500), fontSize: 13, color: colors.textPrimary, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, overflow: 'hidden', minWidth: 64, textAlign: 'center' },
  slotBooked: { backgroundColor: colors.mist, color: colors.textTertiary, borderColor: colors.mist },
  slotMine: { backgroundColor: colors.tintSuccess, color: colors.textSuccess, borderColor: colors.success },
  slotSelected: { backgroundColor: colors.actionPrimary, color: colors.textInverse, borderColor: colors.actionPrimary },
  msg: { color: colors.textError, marginTop: spacing.sm },
  bookBtn: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  block: { marginTop: spacing.xl },
  bookingCard: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  cancel: { ...font(500), fontSize: 13, color: colors.error, paddingHorizontal: spacing.sm },
});
