import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { Card, StatusBadge } from './ui';
import type { BadgePreset } from './ui';
import type { Issue } from '../store/communityStore';

const STATUS: Record<string, { preset: BadgePreset; label: string }> = {
  open: { preset: 'pending', label: 'Open' },
  in_progress: { preset: 'info', label: 'In progress' },
  resolved: { preset: 'granted', label: 'Resolved' },
};

export default function IssueCard({ issue, onUpvote }: { issue: Issue; onUpvote: (id: string) => void }) {
  const st = STATUS[issue.status] || STATUS.open;
  return (
    <Card style={styles.card}>
      <View style={styles.headRow}>
        <Text style={[type.h3, styles.flex]} numberOfLines={2}>{issue.title}</Text>
        <StatusBadge preset={st.preset} label={st.label} size="sm" />
      </View>
      <Text style={type.bodySecondary} numberOfLines={3}>{issue.body}</Text>
      <Text style={type.micro}>{issue.authorName}{issue.authorUnit ? ` · ${issue.authorUnit}` : ''} · {issue.category}</Text>
      <Pressable onPress={() => onUpvote(issue.id)} style={[styles.upvote, issue.myUpvoted && styles.upvoteOn]}>
        <MaterialCommunityIcons name={issue.myUpvoted ? 'account-multiple-check' : 'account-multiple-plus'} size={16} color={issue.myUpvoted ? colors.textInverse : colors.teal} />
        <Text style={[styles.upvoteText, issue.myUpvoted && styles.upvoteTextOn]}>Same issue · {issue.upvoteCount}</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  upvote: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.sm, borderWidth: 1, borderColor: colors.teal, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  upvoteOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  upvoteText: { ...font(500), fontSize: 12, color: colors.teal },
  upvoteTextOn: { color: colors.textInverse },
});
