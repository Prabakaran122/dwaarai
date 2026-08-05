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
import { useCommunityStore } from '../store/communityStore';
import type { FeedPost } from '../store/communityStore';

export default function CommunityScreen({ initialIssueId }: { initialIssueId?: string } = {}) {
  const { me, error, filter, fetch, setFilter, visiblePosts, toggleUpvote, castVote } = useCommunityStore();
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  item: { marginTop: spacing.sm },
  compose: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.surfaceBorder, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
