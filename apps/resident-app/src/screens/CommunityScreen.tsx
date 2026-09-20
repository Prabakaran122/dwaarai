import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card } from '../components/ui';
import AnnouncementCard from '../components/AnnouncementCard';
import IssueCard from '../components/IssueCard';
import PollCard from '../components/PollCard';
import DiscussionCard from '../components/DiscussionCard';
import FilterTabs from '../components/FilterTabs';
import ComposeSheet from './ComposeSheet';
import IssueDetailScreen from './IssueDetailScreen';
import NoticeBoardScreen from './NoticeBoardScreen';
import PollCreateScreen from './PollCreateScreen';
import { useCommunityStore } from '../store/communityStore';
import type { FeedPost } from '../store/communityStore';

export default function CommunityScreen({ initialIssueId }: { initialIssueId?: string } = {}) {
  const { me, error, filter, trending, topic, fetch, setFilter, setTopic, visiblePosts, toggleUpvote, castVote } = useCommunityStore();
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [pollCreateOpen, setPollCreateOpen] = useState(false);
  const [openIssueId, setOpenIssueId] = useState<string | null>(initialIssueId ?? null);

  const load = useCallback(async () => { await fetch(); }, [fetch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (initialIssueId) setOpenIssueId(initialIssueId); }, [initialIssueId]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Detail views replace the tab content in place — this app has no navigation
  // stack (see the plan's Global Constraints and NoticeBoardScreen).
  if (openIssueId) {
    return <IssueDetailScreen issueId={openIssueId} onBack={() => { setOpenIssueId(null); load(); }} />;
  }
  if (noticesOpen) return <NoticeBoardScreen onClose={() => setNoticesOpen(false)} />;
  if (pollCreateOpen) {
    return (
      <PollCreateScreen
        onCancel={() => setPollCreateOpen(false)}
        onCreated={() => { setPollCreateOpen(false); load(); }}
      />
    );
  }

  const posts = visiblePosts();

  const renderPost = (post: FeedPost) => {
    switch (post.type) {
      case 'announcement':
        return <AnnouncementCard announcement={post} />;
      case 'issue':
        return <IssueCard issue={post} onUpvote={toggleUpvote} onPress={() => setOpenIssueId(post.id)} />;
      case 'poll':
        return <PollCard poll={post} onVote={castVote} />;
      case 'discussion':
        return <DiscussionCard discussion={post} onPress={() => setNoticesOpen(true)} />;
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <AppBar title="Community" />
      <FilterTabs value={filter} onChange={setFilter} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        <Pressable style={styles.compose} onPress={() => setComposeOpen(true)}>
          <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.textSecondary} />
          <Text style={type.bodySecondary}>Share something with your community…</Text>
        </Pressable>

        {/* F-06: the five most-used title words of the past week, tappable. */}
        {trending.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.trendingRow}
          >
            {trending.map((t) => (
              <Pressable
                key={t.term}
                testID={`trending-${t.term}`}
                onPress={() => setTopic(topic === t.term ? null : t.term)}
                style={[styles.trendChip, topic === t.term && styles.trendChipOn]}
              >
                <Text style={[styles.trendText, topic === t.term && styles.trendTextOn]}>
                  #{t.term}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {topic && (
          <Pressable testID="clear-topic" onPress={() => setTopic(null)} style={styles.clearTopic}>
            <Text style={styles.clearTopicText}>Showing #{topic} · tap to clear</Text>
          </Pressable>
        )}

        {posts.length === 0 ? (
          <Card>
            <Text style={type.bodySecondary}>
              {error ? 'Could not load. Pull to refresh.' : 'Nothing here yet'}
            </Text>
          </Card>
        ) : (
          posts.map((post) => <View key={`${post.type}-${post.id}`} style={styles.item}>{renderPost(post)}</View>)
        )}
      </ScrollView>

      <Pressable
        testID="compose-fab"
        onPress={() => setComposeOpen(true)}
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="Create a post"
      >
        <MaterialCommunityIcons name="plus" size={26} color={colors.textInverse} />
      </Pressable>

      <ComposeSheet
        visible={composeOpen}
        isCommittee={Boolean(me?.isCommittee)}
        onClose={() => setComposeOpen(false)}
        onPosted={() => { setComposeOpen(false); load(); }}
        onCreatePoll={() => { setComposeOpen(false); setPollCreateOpen(true); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  item: { marginTop: spacing.sm },
  trendingRow: { gap: spacing.xs, paddingVertical: spacing.sm },
  trendChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: 999, borderWidth: 1, borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  trendChipOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  trendText: { fontSize: 12, color: colors.textSecondary },
  trendTextOn: { color: colors.textInverse },
  clearTopic: { paddingVertical: spacing.xs },
  clearTopicText: { fontSize: 12, color: colors.teal },
  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.actionPrimary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  compose: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.surfaceBorder, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
