import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button } from '../components/ui';
import { useEventsStore, EventItem, Fund, tagsFor } from '../store/eventsStore';
import type { EventFilter } from '../api/client';
import StallBookingScreen, { inr } from './StallBookingScreen';
import DonateSheet from './DonateSheet';
import BookingConfirmationScreen from './BookingConfirmationScreen';

const FILTERS: { key: EventFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'stalls', label: 'Stall Booking' },
  { key: 'donations', label: 'Donations' },
  { key: 'past', label: 'Past' },
];

export function formatEventDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

type Screen =
  | { screen: 'list' }
  | { screen: 'stalls'; event: EventItem }
  | { screen: 'donate'; fund: Fund }
  | { screen: 'confirmed'; event: EventItem; stallCode: string; amountPaise: number };

export default function EventsScreen() {
  const { events, featured, funds, filter, loading, error, fetch, setFilter, fetchFunds } = useEventsStore();
  const [view, setView] = useState<Screen>({ screen: 'list' });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { fetch(); fetchFunds(); }, [fetch, fetchFunds]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetch(), fetchFunds()]);
    setRefreshing(false);
  }, [fetch, fetchFunds]);

  // The app has no navigation stack; sub-screens are swapped in by local
  // state and props, matching every other tab in this app.
  if (view.screen === 'stalls') {
    return (
      <StallBookingScreen
        eventId={view.event.id}
        eventTitle={view.event.title}
        onBack={() => setView({ screen: 'list' })}
        onBooked={(stallCode, amountPaise) =>
          setView({ screen: 'confirmed', event: view.event, stallCode, amountPaise })}
      />
    );
  }

  if (view.screen === 'donate') {
    return (
      <DonateSheet
        fund={view.fund}
        onClose={() => setView({ screen: 'list' })}
        onDonated={() => { setView({ screen: 'list' }); fetchFunds(); }}
      />
    );
  }

  if (view.screen === 'confirmed') {
    return (
      <BookingConfirmationScreen
        stallCode={view.stallCode}
        eventTitle={view.event.title}
        eventDate={formatEventDate(view.event.startsAt)}
        amountPaise={view.amountPaise}
        onDone={() => { setView({ screen: 'list' }); fetch(); }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <AppBar title="Events" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              accessibilityState={{ selected: filter === f.key }}
              style={[styles.chip, filter === f.key && styles.chipActive]}
            >
              <Text style={filter === f.key ? styles.chipLabelActive : styles.chipLabel}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading && !events.length && !featured ? (
          <ActivityIndicator style={styles.block} color={colors.brandPrimary} />
        ) : null}

        {error && !events.length && (
          <Card style={styles.block}>
            <Text style={type.body}>Could not load events. Pull down to try again.</Text>
          </Card>
        )}

        {featured && (
          <View testID="featured-hero">
          <Card variant="hero" style={styles.hero}>
            <Text style={styles.heroTag}>Featured</Text>
            <Text style={styles.heroTitle}>{featured.title}</Text>
            <Text style={styles.heroMeta}>
              {formatEventDate(featured.startsAt)}{featured.location ? ` · ${featured.location}` : ''}
            </Text>
            <Tags event={featured} />
            {featured.hasStalls && (
              <View style={styles.heroCta}>
                <Button title="Book a stall" onPress={() => setView({ screen: 'stalls', event: featured })} />
              </View>
            )}
          </Card>
          </View>
        )}

        {funds.filter((f) => f.isOpen).map((fund) => (
          <Card key={fund.id} style={styles.block}>
            <Text style={type.caption}>Donation drive</Text>
            <Text style={type.h3}>{fund.name}</Text>
            <Text style={styles.raised}>
              {inr(fund.raisedPaise)} raised of {inr(fund.targetPaise)}
            </Text>
            <View style={styles.cta}>
              <Button title="Donate" onPress={() => setView({ screen: 'donate', fund })} />
            </View>
          </Card>
        ))}

        {events.map((e) => (
          <Card key={e.id} style={styles.block}>
            <Text style={type.h3}>{e.title}</Text>
            <Text style={styles.meta}>
              {formatEventDate(e.startsAt)}{e.location ? ` · ${e.location}` : ''}
            </Text>
            <Tags event={e} />
            {e.hasStalls && (
              <View style={styles.cta}>
                <Button title="Book a stall" onPress={() => setView({ screen: 'stalls', event: e })} />
              </View>
            )}
          </Card>
        ))}

        {!loading && !error && !events.length && !featured && (
          <Card style={styles.block}>
            <MaterialCommunityIcons name="calendar-blank" size={28} color={colors.textTertiary} />
            <Text style={styles.empty}>Nothing here yet. New events will show up as your RWA publishes them.</Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function Tags({ event }: { event: EventItem }) {
  const tags = tagsFor(event);
  if (!tags.length) return null;
  return (
    <View style={styles.tags}>
      {tags.map((t) => (
        <View key={t} style={styles.tag}>
          <Text style={styles.tagLabel}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  block: { marginTop: spacing.md },
  chips: { gap: spacing.xs, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  // Active chip underlined in Amber, per the BRD.
  chipActive: {
    backgroundColor: colors.surface, borderColor: colors.actionPrimary,
    borderBottomWidth: 3, borderBottomColor: colors.actionPrimary,
  },
  chipLabel: { ...type.caption, color: colors.textSecondary },
  chipLabelActive: { ...type.caption, color: colors.textPrimary },
  hero: { marginTop: spacing.md, backgroundColor: colors.brandPrimary },
  heroTag: { ...type.micro, color: colors.actionPrimary },
  heroTitle: { ...type.h1, color: colors.textInverse, marginTop: spacing.xs },
  heroMeta: { ...type.bodySecondary, color: colors.mist, marginTop: spacing.xs },
  heroCta: { marginTop: spacing.md },
  cta: { marginTop: spacing.md },
  meta: { ...type.bodySecondary, marginTop: spacing.xs },
  raised: { ...type.caption, marginTop: spacing.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  tag: {
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radius.pill, backgroundColor: colors.mist,
  },
  tagLabel: { ...type.micro, color: colors.textPrimary },
  empty: { ...type.body, marginTop: spacing.sm },
});
