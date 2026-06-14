import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, Modal } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { AppBar, Card, Input, Button } from '../components/ui';
import EventCard, { EventItem } from '../components/EventCard';
import * as api from '../api/client';

const CATS = ['general', 'sports', 'festival', 'meeting', 'kids'];

export default function EventsScreen() {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [items, setItems] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  // create form
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [loc, setLoc] = useState('');
  const [cat, setCat] = useState('general');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.getEvents(scope); setItems(r.data.data || []); } catch { /* keep */ } finally { setLoading(false); }
  }, [scope]);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const onRsvp = async (id: string, status: 'going' | 'maybe' | 'no') => {
    setItems((prev) => prev.map((e) => e.id === id ? { ...e, myRsvp: status } : e));
    try { await api.rsvpEvent(id, status); await load(); } catch { /* ignore */ }
  };

  const submit = async () => {
    setMsg(null);
    if (!title.trim() || !date.trim() || !time.trim()) { setMsg('Title, date and time are required.'); return; }
    const startsAt = `${date.trim()}T${time.trim()}:00+05:30`;
    if (isNaN(new Date(startsAt).getTime())) { setMsg('Use date YYYY-MM-DD and time HH:MM.'); return; }
    setSaving(true);
    try {
      await api.createEvent({ title: title.trim(), description: desc.trim() || undefined, location: loc.trim() || undefined, category: cat, startsAt });
      setTitle(''); setDesc(''); setLoc(''); setCat('general'); setDate(''); setTime(''); setComposeOpen(false);
      setScope('upcoming'); await load();
    } catch { setMsg('Could not create the event.'); } finally { setSaving(false); }
  };

  return (
    <View style={styles.container}>
      <AppBar title="Events" />
      <View style={styles.scopeRow}>
        {(['upcoming', 'past'] as const).map((s) => (
          <Text key={s} onPress={() => setScope(s)} style={[styles.scope, scope === s && styles.scopeOn]}>{s === 'upcoming' ? 'Upcoming' : 'Past'}</Text>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}>
        {loading ? null : items.length === 0 ? (
          <Card><Text style={type.bodySecondary}>{scope === 'upcoming' ? 'No upcoming events' : 'No past events'}</Text></Card>
        ) : items.map((e) => <View key={e.id} style={styles.item}><EventCard event={e} onRsvp={onRsvp} /></View>)}
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => setComposeOpen(true)}>
        <MaterialCommunityIcons name="calendar-plus" size={24} color={colors.textInverse} />
      </Pressable>

      <Modal visible={composeOpen} animationType="slide" transparent onRequestClose={() => setComposeOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.form}>
              <Text style={type.h2}>New event</Text>
              <Input label="Title" placeholder="e.g. Holi Bash" value={title} onChangeText={setTitle} />
              <Input label="Date (YYYY-MM-DD)" placeholder="2026-06-20" value={date} onChangeText={setDate} />
              <Input label="Time (HH:MM)" placeholder="17:00" value={time} onChangeText={setTime} />
              <Input label="Location (optional)" placeholder="Clubhouse" value={loc} onChangeText={setLoc} />
              <Input testID="event-desc" label="Details (optional)" placeholder="What's happening" value={desc} onChangeText={setDesc} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
              <View style={styles.cats}>
                {CATS.map((c) => <Text key={c} onPress={() => setCat(c)} style={[styles.cat, cat === c && styles.catOn]}>{c}</Text>)}
              </View>
              {msg ? <Text style={styles.msg}>{msg}</Text> : null}
              <Button title="Create event" onPress={submit} loading={saving} style={styles.create} />
              <Text onPress={() => setComposeOpen(false)} style={styles.cancel}>Cancel</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scopeRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  scope: { ...font(500), fontSize: 13, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden' },
  scopeOn: { backgroundColor: colors.brandPrimary, color: colors.textInverse },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  item: { marginTop: spacing.sm },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(13,37,53,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.mist, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '90%' },
  form: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['3xl'] },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  cat: { ...font(500), fontSize: 12, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden', textTransform: 'capitalize' },
  catOn: { backgroundColor: colors.teal, color: colors.textInverse },
  msg: { ...font(400), fontSize: 12, color: colors.textError },
  create: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  cancel: { ...font(500), fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
});
