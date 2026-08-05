import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import type { FeedFilter } from '../store/communityStore';

const TABS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'issue', label: 'Issues' },
  { key: 'poll', label: 'Polls' },
  { key: 'discussion', label: 'Discussions' },
  { key: 'announcement', label: 'Notices' },
];

export default function FilterTabs({ value, onChange }: { value: FeedFilter; onChange: (f: FeedFilter) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={styles.tab}>
            <Text style={[type.caption, active ? styles.labelActive : styles.label]}>{tab.label}</Text>
            {active && <View testID={`filter-underline-${tab.key}`} style={styles.underline} />}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  tab: { paddingVertical: spacing.sm, alignItems: 'center' },
  label: { color: colors.textTertiary },
  labelActive: { color: colors.brandPrimary },
  underline: { marginTop: spacing.xs, height: 2, width: '100%', minWidth: 24, backgroundColor: colors.actionPrimary, borderRadius: 2 },
});
