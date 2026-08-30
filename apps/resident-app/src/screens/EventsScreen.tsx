import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { AppBar, Card } from '../components/ui';
import DonationCard from '../components/DonationCard';
import StallBookingScreen from './StallBookingScreen';
import { useEventsStore, type EventFilter, type EventItem } from '../store/eventsStore';

/**
 * Events tab (BRD: Events Module v1.0).
 *
 * This replaces the earlier RSVP/create-event screen. RSVP and headcount are
 * explicitly out of scope for v1.0, and event creation belongs to the RWA in
 * the admin portal — the BRD assigns "create event, set stall layout, set stall
 * pricing" to the Admin Portal, not the resident app.
 */

const FILTERS: { key: EventFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'stalls', label: 'Stall Booking' },
  { key: 'donations', label: 'Donations' },
  { key: 'past', label: 'Past' },
];

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    + ' · ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/** FR-EVT-04: name, date, venue, and the tags that say what a resident can do. */
function EventTags({ event }: { event: EventItem }) {
  const tags: string[] = [];
  if (event.hasStalls && !event.isPast) {
    tags.push(event.stallsAvailable > 0 ? `${event.stallsAvailable} stalls available` : 'Stalls full');
  }
  if (event.hasDonations && !event.isPast) tags.push('Donations open');
  if (event.category) tags.push(event.category);
  if (!tags.length) return null;

  return (
    <View style={styles.tags}>
      {tags.map((t) => (
        <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
      ))}
    </View>
  );
}

export default function EventsScreen() {
  const { filter, loading, error, fetch, setFilter, visibleEvents, featured, fundForEvent } = useEventsStore();
  const [refreshing, setRefreshing] = useState(false);
  const [booking, setBooking] = useState<EventItem | null>(null);
  const [confirmed, setConfirmed] = useState<{ stallCode: string; totalPaise: number } | null>(null);

  const load = useCallback(async () => { await fetch(); }, [fetch]);
  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // No navigation stack in this app — detail views replace the tab content in
  // place, the same pattern CommunityScreen uses for the issue thread.
  if (booking) {
    return (
      <StallBookingScreen
        eventId={booking.id}
        eventTitle={booking.title}
        onBack={() => setBooking(null)}
        onBooked={(b) => { setBooking(null); setConfirmed(b); load(); }}
      />
    );
  }

  const hero = featured();
  const events = visibleEvents();
  // The hero is already shown above; don't repeat it in the list below.
  const listed = hero ? events.filter((e) => e.id !== hero.id) : events;

  return (
    <View style={styles.container}>
      <AppBar title="Events" />

      <View style={styles.chips}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              testID={`event-filter-${f.key}`}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, filter === f.key && styles.chipOn]}
            >
              <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        {/* FR-STL-07: the confirmation the resident sees after paying. */}
        {confirmed && (
          <Card testID="booking-confirmation">
            <View style={styles.confirmRow}>
              <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
              <Text style={type.h3}>Stall {confirmed.stallCode} booked</Text>
            </View>
            <Text style={type.bodySecondary}>
              ₹{(confirmed.totalPaise / 100).toLocaleString('en-IN')} paid. A confirmation has been sent to you.
            </Text>
            <Pressable testID="dismiss-confirmation" onPress={() => setConfirmed(null)}>
              <Text style={styles.dismiss}>Dismiss</Text>
            </Pressable>
          </Card>
        )}

        {/* FR-EVT-03: featured event as a hero card at the top. */}
        {hero && filter !== 'past' && (
          <Pressable
            testID="featured-event"
            onPress={() => hero.hasStalls && setBooking(hero)}
            style={styles.hero}
          >
            <Text style={styles.heroLabel}>FEATURED</Text>
            <Text style={styles.heroTitle}>{hero.title}</Text>
            <Text style={styles.heroMeta}>
              {when(hero.startsAt)}{hero.location ? ` · ${hero.location}` : ''}
            </Text>
            <EventTags event={hero} />
            {hero.hasStalls && hero.stallsAvailable > 0 && (
              <View style={styles.heroCta}><Text style={styles.heroCtaText}>Book a stall</Text></View>
            )}
          </Pressable>
        )}

        {listed.length === 0 && !loading ? (
          <Card>
            <Text style={type.bodySecondary}>
              {error ? 'Could not load events. Pull to refresh.' : 'No events to show.'}
            </Text>
          </Card>
        ) : (
          listed.map((e) => {
            const fund = e.hasDonations ? fundForEvent(e.id) : null;
            return (
              <View key={e.id} style={styles.item}>
                <Card testID={`event-${e.id}`}>
                  <Text style={type.h3}>{e.title}</Text>
                  <Text style={type.bodySecondary}>
                    {when(e.startsAt)}{e.location ? ` · ${e.location}` : ''}
                  </Text>
                  {e.description ? <Text style={type.bodySecondary}>{e.description}</Text> : null}
                  <EventTags event={e} />

                  {/* FR-EVT-06: past events stay visible but are never bookable. */}
                  {e.hasStalls && !e.isPast && (
                    <Pressable testID={`book-stall-${e.id}`} onPress={() => setBooking(e)} style={styles.bookBtn}>
                      <Text style={styles.bookBtnText}>
                        {e.stallsAvailable > 0 ? 'Book a stall' : 'View stall map'}
                      </Text>
                    </Pressable>
                  )}
                </Card>

                {fund && !e.isPast && (
                  <View style={styles.fund}>
                    <DonationCard fund={fund} onDonated={load} />
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  chips: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
  chipRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  chipOn: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  chipText: { ...font(500), fontSize: 12, color: colors.textSecondary },
  chipTextOn: { color: colors.textInverse },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  item: { marginTop: spacing.sm },
  fund: { marginTop: spacing.sm },
  hero: {
    backgroundColor: colors.oceanDark, borderRadius: radius.md,
    padding: spacing.lg, gap: spacing.xs, marginBottom: spacing.sm,
  },
  heroLabel: { ...font(700), fontSize: 10, letterSpacing: 1.5, color: colors.actionPrimary },
  heroTitle: { ...font(700), fontSize: 20, color: colors.textInverse },
  heroMeta: { ...font(400), fontSize: 13, color: colors.textInverse, opacity: 0.75 },
  heroCta: {
    marginTop: spacing.sm, alignSelf: 'flex-start',
    backgroundColor: colors.actionPrimary, borderRadius: radius.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  heroCtaText: { ...font(700), fontSize: 13, color: colors.textInverse },
  tags: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.xs },
  tag: {
    backgroundColor: colors.surfaceHover, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  tagText: { ...font(500), fontSize: 11, color: colors.textSecondary, textTransform: 'capitalize' },
  bookBtn: {
    marginTop: spacing.sm, alignSelf: 'flex-start',
    backgroundColor: colors.teal, borderRadius: radius.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  bookBtnText: { ...font(700), fontSize: 13, color: colors.textInverse },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dismiss: { ...font(500), fontSize: 13, color: colors.teal, marginTop: spacing.sm },
});
