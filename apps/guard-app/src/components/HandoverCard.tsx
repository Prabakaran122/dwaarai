import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useHandoverStore } from '../store/handoverStore';
import { useT } from '../store/langStore';

// Shown to the incoming guard at shift start: previous note + carried-over open items.
export default function HandoverCard() {
  const { latest, openItems, fetchLatest } = useHandoverStore();
  const [dismissed, setDismissed] = useState(false);
  const t = useT();

  useEffect(() => { fetchLatest(); }, []);

  const hasItems = openItems.sosActive > 0 || openItems.deliveriesWaiting > 0;
  if (dismissed || (!latest && !hasItems)) return null;

  return (
    <View style={styles.card}>
      <MaterialCommunityIcons name="clipboard-text-clock" size={20} color={colors.info} />
      <View style={styles.body}>
        <Text style={styles.title}>{t('handoverTitle')}</Text>
        {latest ? (
          <Text style={styles.note}>
            "{latest.note}"{latest.guardName ? ` — ${latest.guardName}` : ''}
          </Text>
        ) : null}
        {hasItems ? (
          <Text style={styles.items}>
            {t('openItems')}: {openItems.sosActive} {t('sosActiveCount')} · {openItems.deliveriesWaiting} {t('deliveriesWaitingCount')}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MaterialCommunityIcons name="close" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    backgroundColor: colors.infoBg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  body: { flex: 1 },
  title: { fontSize: 11, fontWeight: '700', color: colors.info, letterSpacing: 1 },
  note: { fontSize: 14, color: colors.textPrimary, marginTop: 2 },
  items: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
});
