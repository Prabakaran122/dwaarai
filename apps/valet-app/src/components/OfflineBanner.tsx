import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { useT } from '../store/langStore';
import { reachability } from '../lib/connectivity';

/**
 * What an attendant sees when the backend stops answering.
 *
 * The queue keeps rendering -- the cars on that list are still on the lot, and
 * blanking it mid-shift helps nobody. But a list that silently stops updating
 * is worse than one that admits it: the attendant needs to know whether the
 * car they are looking for might have been collected five minutes ago by
 * somebody else's phone.
 *
 * So this answers the only question that matters, which is not "are you
 * offline" but "how old is this". Four minutes is usable. Forty is not, and
 * only the person standing there can judge which.
 */
function ageLabel(lastOkAt: number | null, t: (k: string) => string): string {
  if (lastOkAt === null) return t('valetOfflineNeverConnected');

  const seconds = Math.max(0, Math.round((Date.now() - lastOkAt) / 1000));
  // Under a minute reads as seconds. "Updated 0 min ago" looks like a bug and
  // undersells how fresh the list actually is.
  if (seconds < 60) return t('valetOfflineAgeSeconds').replace('{n}', String(seconds));

  const minutes = Math.round(seconds / 60);
  return t('valetOfflineAgeMinutes').replace('{n}', String(minutes));
}

export default function OfflineBanner() {
  const t = useT();
  const online = reachability((s) => s.online);
  const lastOkAt = reachability((s) => s.lastOkAt);

  // Nothing at all while things work. A permanent "connection: good" chip is
  // furniture an attendant stops seeing, which makes its absence useless.
  if (online) return null;

  return (
    <View style={styles.bar} testID="offline-banner">
      <MaterialCommunityIcons name="cloud-off-outline" size={18} color={colors.bgPrimary} />
      <View style={styles.text}>
        <Text style={styles.title}>{t('valetOfflineTitle')}</Text>
        <Text style={styles.age} testID="offline-banner-age">
          {ageLabel(lastOkAt, t)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.md, marginBottom: spacing.sm,
  },
  text: { flex: 1 },
  title: { color: colors.bgPrimary, fontWeight: '700', fontSize: 14 },
  age: { color: colors.bgPrimary, fontSize: 12, opacity: 0.85 },
});
