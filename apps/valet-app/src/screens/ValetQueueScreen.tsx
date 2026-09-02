import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { useValetStore, NEEDS_ACTION } from '../store/valetStore';
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
  requested: colors.actionPrimary,
  arrived: colors.teal,
  en_route: colors.info,
  parked: colors.textTertiary,
  parked_again: colors.textTertiary,
  final_closed: colors.textTertiary,
  expired: colors.danger,
};

function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export default function ValetQueueScreen({
  onOpenTicket, onNewTicket,
}: {
  onOpenTicket?: (token: string) => void;
  onNewTicket?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { loading, search, fetch, setSearch, visibleTickets, accept, arrived, waitingCount } = useValetStore();
  const [etaFor, setEtaFor] = useState<string | null>(null);
  const tickets = visibleTickets();

  useEffect(() => {
    fetch();
    const timer = setInterval(fetch, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const waiting = waitingCount();

  const renderActions = (item: ValetTicket) => {
    if (item.status === 'requested') {
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
          <Pressable testID="new-valet-ticket" style={styles.newBtn} onPress={onNewTicket}>
            <MaterialCommunityIcons name="plus" size={20} color={colors.bgPrimary} />
            <Text style={styles.newBtnText}>{t('valetNewTicket')}</Text>
          </Pressable>
        </View>
      </View>

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

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetch} tintColor={colors.teal} />}
      >
        {tickets.length === 0 && !loading && (
          <View style={styles.empty} testID="valet-empty">
            <MaterialCommunityIcons name="car-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.emptyText}>
              {search ? t('valetNoMatch') : t('valetEmpty')}
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
                  {item.vehicleMake} · {item.cardCode ? `Card ${item.cardCode}` : item.displayId} · {minutesSince(item.createdAt)}m
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
