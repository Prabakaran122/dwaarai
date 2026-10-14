import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import OfflineBanner from '../components/OfflineBanner';
import { subscribeToReconnect } from '../lib/onReconnect';
import { flushConditionQueue } from '../lib/conditionQueue';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { useAuthStore } from "../store/authStore";
import { useValetStore, NEEDS_ACTION, forParking, forDelivery, forWithGuest } from '../store/valetStore';
import * as api from '../api/valet';
import type { ValetTicket, ValetStatus } from '../api/valet';
import { useT } from '../store/langStore';

/**
 * The valet stand's working queue.
 *
 * Cars needing a valet float to the top (the ordering lives in valetStore, it
 * is a product rule rather than a display detail). Everything a valet does
 * during a live handover is one tap from here.
 */

const ETA_CHOICES = [2, 5, 10, 15];
const POLL_MS = 5000;

const STATUS_COLOR: Record<ValetStatus, string> = {
  // Amber is "act on me" — a job waiting to be parked and a guest waiting for
  // their car are both that, from opposite ends of the stay.
  requested: colors.actionPrimary,
  retrieval_requested: colors.actionPrimary,
  accepted: colors.info,
  parking_in_progress: colors.info,
  arrived: colors.teal,
  en_route: colors.info,
  parked: colors.textTertiary,
  parked_again: colors.textTertiary,
  with_guest: colors.info,
  final_closed: colors.textTertiary,
  expired: colors.danger,
};

function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export default function ValetQueueScreen({
  onOpenTicket, onNewTicket, onCheckIn,
}: {
  onOpenTicket?: (token: string) => void;
  onNewTicket?: () => void;
  onCheckIn?: (token: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { loading, search, fetch, setSearch, visibleTickets, accept, arrived, acceptIntake, waitingCount } = useValetStore();
  const [etaFor, setEtaFor] = useState<string | null>(null);
  const all = visibleTickets();

  // Two halves of a shift, not one list. Walking out to park a car and
  // walking back to fetch one are different jobs, and mixing them makes a
  // queue nobody can read at a busy porch.
  const hydrate = useValetStore((s) => s.hydrate);
  const logout = useAuthStore((s) => s.logout);
  // Confirmed, not immediate. Signing out mid-shift costs a re-login and
  // another face verification, possibly with a car already in hand.
  const [endingShift, setEndingShift] = useState(false);
  const [tab, setTab] = useState<'parking' | 'delivery' | 'withGuest'>('delivery');
  const parking = forParking(all);
  const delivery = forDelivery(all);
  const withGuest = forWithGuest(all);
  const tickets = tab === 'parking' ? parking : tab === 'withGuest' ? withGuest : delivery;

  useEffect(() => {
    // Disk first, then the network. A cold start in a basement otherwise
    // shows an empty lot until a poll that may never succeed; hydrate() bows
    // out the moment live data has landed, so this cannot walk the queue
    // backwards.
    void hydrate();
    fetch();
    const timer = setInterval(fetch, POLL_MS);

    // The instant the server answers again: pull the queue rather than waiting
    // up to a full tick, and push whatever condition media was captured while
    // there was nowhere to send it.
    const stop = subscribeToReconnect(() => {
      fetch();
      void flushConditionQueue();
    });

    return () => { clearInterval(timer); stop(); };
  }, []);

  const waiting = waitingCount();

  const renderActions = (item: ValetTicket) => {
    // A job the desk logged, still waiting for somebody to walk to it.
    if (item.status === 'requested') {
      return (
        <Pressable
          testID={`valet-accept-intake-${item.id}`}
          style={styles.primaryBtn}
          onPress={() => acceptIntake(item.sessionToken)}
        >
          <Text style={styles.primaryBtnText}>{t('valetTakeJob')}</Text>
        </Pressable>
      );
    }

    // Out with a multi-day guest. Nothing to do until they bring it back, and
    // then it is checked in again rather than simply marked parked.
    if (item.status === 'with_guest') {
      return (
        <Pressable
          testID={`checkin-${item.id}`}
          style={styles.primaryBtn}
          onPress={() => onCheckIn?.(item.sessionToken)}
        >
          <Text style={styles.primaryBtnText}>{t('valetCarBack')}</Text>
        </Pressable>
      );
    }

    if (item.status === 'retrieval_requested') {
      if (etaFor !== item.sessionToken) {
        return (
          <Pressable
            testID={`accept-${item.id}`}
            style={styles.primaryBtn}
            onPress={() => setEtaFor(item.sessionToken)}
          >
            <Text style={styles.primaryBtnText}>{t('valetAccept')}</Text>
          </Pressable>
        );
      }
      return (
        <View style={styles.etaRow}>
          {ETA_CHOICES.map((m) => (
            <Pressable
              key={m}
              testID={`eta-${item.id}-${m}`}
              style={styles.etaBtn}
              onPress={() => { setEtaFor(null); accept(item.sessionToken, m); }}
            >
              <Text style={styles.etaBtnText}>{m}m</Text>
            </Pressable>
          ))}
          {/* Skipping the estimate is a real choice: the guest simply gets
              no countdown, which is better than a number the valet invented. */}
          <Pressable
            testID={`eta-${item.id}-skip`}
            style={styles.etaSkip}
            onPress={() => { setEtaFor(null); accept(item.sessionToken, null); }}
          >
            <Text style={styles.etaSkipText}>{t('valetNotSure')}</Text>
          </Pressable>
        </View>
      );
    }

    if (item.status === 'en_route') {
      return (
        <Pressable
          testID={`arrived-${item.id}`}
          style={styles.primaryBtn}
          onPress={() => arrived(item.sessionToken)}
        >
          <Text style={styles.primaryBtnText}>{t('valetArrived')}</Text>
        </Pressable>
      );
    }

    if (item.status === 'arrived') {
      return (
        <Pressable
          testID={`handover-${item.id}`}
          style={styles.tealBtn}
          onPress={() => onOpenTicket?.(item.sessionToken)}
        >
          <Text style={styles.primaryBtnText}>{t('valetScanQr')}</Text>
        </Pressable>
      );
    }

    return null;
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={type.h2}>{t('valetTitle')}</Text>
            <Text style={styles.headerMeta} testID="valet-waiting-count">
              {waiting > 0 ? t('valetWaiting').replace('{n}', String(waiting)) : t('valetNobodyWaiting')}
            </Text>
          </View>
          {/* The stand phone passes between attendants at every shift change,
              and the cached queue and media outbox carry this shift's plates
              and guest names. Until now there was no way to hand it over:
              logout existed in the store and nothing called it. */}
          <Pressable
            testID="valet-end-shift"
            style={styles.endShiftBtn}
            onPress={() => setEndingShift(true)}
            hitSlop={10}
          >
            <MaterialCommunityIcons name="logout-variant" size={22} color={colors.textSecondary} />
          </Pressable>
          <Pressable testID="new-valet-ticket" style={styles.newBtn} onPress={onNewTicket}>
            <MaterialCommunityIcons name="plus" size={20} color={colors.bgPrimary} />
            <Text style={styles.newBtnText}>{t('valetNewTicket')}</Text>
          </Pressable>
        </View>
      </View>

      {endingShift && (
        <View style={styles.endShiftCard} testID="valet-end-shift-sheet">
          <Text style={styles.endShiftTitle}>{t('valetEndShiftTitle')}</Text>
          <Text style={styles.endShiftBody}>{t('valetEndShiftBody')}</Text>
          <Pressable
            testID="valet-end-shift-confirm"
            style={styles.endShiftGo}
            onPress={async () => {
              setEndingShift(false);
              // Tell the server first, while the token is still valid. A
              // failure here must not trap an attendant in the app: the sweep
              // closes a shift nobody ended, and being unable to leave at the
              // end of a shift is the worse outcome.
              try { await api.endShift(); } catch { /* sweep will close it */ }
              void logout();
            }}
          >
            <Text style={styles.endShiftGoText}>{t('valetEndShiftConfirm')}</Text>
          </Pressable>
          <Pressable
            testID="valet-end-shift-cancel"
            style={styles.endShiftCancel}
            onPress={() => setEndingShift(false)}
          >
            <Text style={styles.endShiftCancelText}>{t('valetCancel')}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.textTertiary} />
        <TextInput
          testID="plate-search"
          value={search}
          onChangeText={setSearch}
          placeholder={t('valetSearchPlate')}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="characters"
          style={styles.searchInput}
        />
        {search.length > 0 && (
          <Pressable testID="clear-search" onPress={() => setSearch('')} hitSlop={10}>
            <MaterialCommunityIcons name="close-circle" size={18} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>

      {/* Above the tabs, below the search: the first thing read when the list
          looks wrong, and it renders nothing at all while things work. */}
      <OfflineBanner />

      <View style={styles.tabRow}>
        {([
          // In the order a car moves through them: dropped at the porch,
          // parked, driven away by the guest.
          ['parking', t('valetTabParking'), parking.length],
          ['delivery', t('valetTabDelivery'), delivery.length],
          ['withGuest', t('valetTabWithGuest'), withGuest.length],
        ] as const).map(([key, label, count]) => (
          <Pressable
            key={key}
            testID={`valet-tab-${key}`}
            onPress={() => setTab(key)}
            style={[styles.tab, tab === key && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {label}{count > 0 ? ` (${count})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* One line saying what the open tab holds: the labels alone were
          read three different ways at the porch. */}
      <Text style={styles.tabHint} testID="valet-tab-hint">
        {t(tab === 'parking' ? 'valetTabParkingHint' : tab === 'withGuest' ? 'valetTabWithGuestHint' : 'valetTabDeliveryHint')}
      </Text>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetch} tintColor={colors.teal} />}
      >
        {tickets.length === 0 && !loading && (
          <View style={styles.empty} testID="valet-empty">
            <MaterialCommunityIcons name="car-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.emptyText}>
              {search ? t('valetNoMatch') : t(tab === 'parking' ? 'valetEmptyParking' : tab === 'withGuest' ? 'valetEmptyWithGuest' : 'valetEmptyDelivery')}
            </Text>
          </View>
        )}

        {tickets.map((item) => {
          const urgent = NEEDS_ACTION.includes(item.status);
          return (
            <View
              key={item.id}
              testID={`valet-ticket-${item.id}`}
              style={[styles.card, urgent && styles.cardUrgent]}
            >
              <Pressable onPress={() => onOpenTicket?.(item.sessionToken)}>
                <View style={styles.cardTop}>
                  <Text style={styles.plate}>{item.plate}</Text>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[item.status] }]} />
                  <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>
                    {t(`valetStatus_${item.status}`)}
                  </Text>
                </View>
                <Text style={styles.meta}>
                  {/* The guest is holding one of these, so lead with whichever
                      it is. A guest who phones saying they have lost their
                      code needs the guard to find it here. */}
                  {item.vehicleMake} · {item.cardCode
                    ? `Card ${item.cardCode}`
                    : item.claimCode || item.displayId} · {minutesSince(item.createdAt)}m
                  {item.currentGuardName ? ` · ${item.currentGuardName}` : ''}
                </Text>
                {item.disputed && (
                  <Text style={styles.disputed} testID={`disputed-${item.id}`}>
                    {t('valetDisputed')}
                  </Text>
                )}
              </Pressable>

              <View style={styles.actions}>{renderActions(item)}</View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.actionPrimary,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  newBtnText: { color: colors.bgPrimary, fontWeight: '700', fontSize: 13 },
  tabRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  endShiftBtn: {
    padding: spacing.md, marginRight: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  endShiftCard: {
    margin: spacing.lg, padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  endShiftTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  endShiftBody: { color: colors.textSecondary, fontSize: 13, marginTop: 6 },
  endShiftGo: {
    marginTop: spacing.lg, paddingVertical: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.danger, alignItems: 'center',
  },
  endShiftGoText: { color: colors.bgPrimary, fontWeight: '700', fontSize: 15 },
  endShiftCancel: { marginTop: spacing.sm, paddingVertical: spacing.md, alignItems: 'center' },
  endShiftCancelText: { color: colors.textSecondary, fontWeight: '600', fontSize: 14 },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.surfaceHover, borderColor: colors.teal },
  tabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: colors.textPrimary },
  tabHint: { color: colors.textTertiary, fontSize: 12, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  content: { padding: spacing.lg, gap: spacing.md },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md, color: colors.textPrimary, fontSize: 15 },
  empty: { alignItems: 'center', paddingVertical: spacing['5xl'], gap: spacing.md },
  emptyText: { color: colors.textTertiary, fontSize: 14 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardUrgent: { borderColor: colors.actionPrimary },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  plate: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginLeft: spacing.sm },
  statusText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs },
  disputed: { color: colors.danger, fontSize: 11, fontWeight: '700', marginTop: spacing.xs },
  actions: { marginTop: spacing.md },
  primaryBtn: {
    backgroundColor: colors.actionPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  tealBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.bgPrimary, fontWeight: '700', fontSize: 15 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  etaBtn: {
    backgroundColor: colors.actionPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  etaBtnText: { color: colors.bgPrimary, fontWeight: '700', fontSize: 14 },
  etaSkip: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  etaSkipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
});
