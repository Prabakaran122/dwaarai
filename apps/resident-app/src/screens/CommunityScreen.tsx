import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
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
import * as api from '../api/client';
import { useCommunityStore } from '../store/communityStore';
import type { FeedPost } from '../store/communityStore';

export function matchesTerm(post: { title?: string; question?: string; body?: string }, term: string): boolean {
  const haystack = `${post.title ?? ''} ${post.question ?? ''} ${post.body ?? ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export default function CommunityScreen({ initialIssueId }: { initialIssueId?: string } = {}) {
  const { me, error, filter, fetch, setFilter, visiblePosts, toggleUpvote, castVote } = useCommunityStore();
  const [trending, setTrending] = useState<{ term: string; count: number }[]>([]);
  const [term, setTerm] = useState<string | null>(null);

  useEffect(() => {
    api.getTrending()
      .then((r) => setTrending(r.data?.data ?? []))
      .catch(() => setTrending([]));
  }, []);
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

  // A trending chip narrows the feed to posts mentioning that term; the tabs
  // above already handle post type, so the two compose rather than compete.
  const posts = term
    ? visiblePosts().filter((p) => matchesTerm(p, term))
    : visiblePosts();

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
        {/* Trending chips (F-06). Tapping searches the feed for that term
            rather than switching post-type filters, which the tabs above
            already do. */}
        {trending.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trending}>
            {trending.map((t) => (
              <Pressable
                key={t.term}
                testID={`trending-${t.term}`}
                onPress={() => setTerm(term === t.term ? null : t.term)}
                style={[styles.trendChip, term === t.term && styles.trendChipActive]}
              >
                <Text style={term === t.term ? styles.trendLabelActive : styles.trendLabel}>#{t.term}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Pressable style={styles.compose} onPress={() => setComposeOpen(true)}>
          <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.textSecondary} />
          <Text style={type.bodySecondary}>Share something with your community…</Text>
        </Pressable>

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
  trending: { gap: spacing.xs, paddingBottom: spacing.sm },
  trendChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.pill, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  trendChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  trendLabel: { ...type.caption, color: colors.textSecondary },
  trendLabelActive: { ...type.caption, color: colors.textInverse },
  compose: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.surfaceBorder, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
