import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, SectionHeader, Card } from '../components/ui';
import AnnouncementCard from '../components/AnnouncementCard';
import IssueCard from '../components/IssueCard';
import PollCard from '../components/PollCard';
import ComposeSheet from './ComposeSheet';
import { useCommunityStore } from '../store/communityStore';
import * as api from '../api/client';

export default function CommunityScreen() {
  const { feed, error, fetch, applyUpvote } = useCommunityStore();
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const load = useCallback(async () => { await fetch(); }, [fetch]);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const onUpvote = async (id: string) => {
    const issue = feed?.issues.find((i) => i.id === id);
    const next = !issue?.myUpvoted;
    applyUpvote(id, next);
    try { await api.upvoteIssue(id); } catch { applyUpvote(id, !next); }
  };
  const onVote = async (pollId: string, optionId: string) => {
    try { await api.votePoll(pollId, optionId); await load(); } catch { /* ignore */ }
  };
  const onClosePoll = async (id: string) => {
    try { await api.closePoll(id); await load(); } catch { /* ignore */ }
  };

  const announcements = feed?.announcements ?? [];
  const issues = feed?.issues ?? [];
  const polls = feed?.polls ?? [];

  return (
    <View style={styles.container}>
      <AppBar title="Community" />
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}>
        {announcements.map((a) => <View key={a.id} style={styles.item}><AnnouncementCard announcement={a} /></View>)}

        <View style={styles.block}>
          <SectionHeader title="Issues" />
          {issues.length === 0 ? (
            <Card><Text style={type.bodySecondary}>{error ? 'Could not load. Pull to refresh.' : 'No issues raised yet'}</Text></Card>
          ) : issues.map((i) => <View key={i.id} style={styles.item}><IssueCard issue={i} onUpvote={onUpvote} /></View>)}
        </View>

        <View style={styles.block}>
          <SectionHeader title="Polls" />
          {polls.length === 0 ? (
            <Card><Text style={type.bodySecondary}>No active polls</Text></Card>
          ) : polls.map((p) => <View key={p.id} style={styles.item}><PollCard poll={p} onVote={onVote} onClose={onClosePoll} /></View>)}
        </View>
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => setComposeOpen(true)}>
        <MaterialCommunityIcons name="pencil" size={24} color={colors.textInverse} />
      </Pressable>

      <ComposeSheet visible={composeOpen} onClose={() => setComposeOpen(false)} onPosted={() => { setComposeOpen(false); load(); }} />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  block: { marginTop: spacing.md },
  item: { marginTop: spacing.sm },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
});
