import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import AnimatedEntry from './AnimatedEntry';
import FeedItem from './FeedItem';
import { useQueueStore, selectFeedEntries } from '../store/queueStore';

export default function LiveFeed() {
  const entries = useQueueStore((s) => s.entries);
  const feed = selectFeedEntries(entries);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LIVE FEED</Text>
      <FlatList
        data={feed}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <AnimatedEntry direction="fade" delay={index < 5 ? index * 60 : 0} duration={300}>
            <FeedItem entry={item} />
          </AnimatedEntry>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="antenna" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>Waiting for events...</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md },
  title: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  list: { paddingBottom: spacing.lg },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 13 },
});
