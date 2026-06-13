import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { Card } from './ui';
import type { Poll } from '../store/communityStore';

export default function PollCard({
  poll,
  onVote,
  onClose,
}: {
  poll: Poll;
  onVote: (pollId: string, optionId: string) => void;
  onClose?: (pollId: string) => void;
}) {
  const voted = !!poll.myOptionId || poll.status !== 'open';
  const total = poll.totalVotes || poll.options.reduce((s, o) => s + o.votes, 0);

  const statusLine = poll.status === 'closed'
    ? 'Closed'
    : poll.closesAt
      ? `Closes ${new Date(poll.closesAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
      : null;

  return (
    <Card style={styles.card}>
      <Text style={type.h3}>{poll.question}</Text>
      <Text style={type.micro}>{poll.authorName} · {total} vote{total === 1 ? '' : 's'}</Text>
      {statusLine ? <Text style={styles.statusLine}>{statusLine}</Text> : null}
      {poll.targetBlockId ? <Text style={styles.blockCaption}>Block-only</Text> : null}
      <View style={styles.options}>
        {poll.options.map((o) => {
          const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
          const mine = poll.myOptionId === o.id;
          if (voted) {
            return (
              <View key={o.id} style={styles.resultRow}>
                <View style={[styles.bar, { width: `${pct}%` } as any, mine && styles.barMine]} />
                <View style={styles.resultLabel}>
                  <Text style={[type.body, mine && styles.mineText]}>{o.label}</Text>
                  <Text style={[type.caption, mine && styles.mineText]}>{pct}%</Text>
                </View>
              </View>
            );
          }
          return (
            <Pressable key={o.id} style={styles.voteOption} onPress={() => onVote(poll.id, o.id)}>
              <Text style={styles.voteLabel}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {poll.canManage && poll.status === 'open' && onClose ? (
        <Pressable onPress={() => onClose(poll.id)}>
          <Text style={styles.closeAction}>Close poll</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  options: { gap: spacing.sm, marginTop: spacing.sm },
  voteOption: { borderWidth: 1, borderColor: colors.teal, borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  voteLabel: { ...font(500), fontSize: 14, color: colors.teal },
  resultRow: { backgroundColor: colors.mist, borderRadius: radius.sm, overflow: 'hidden', justifyContent: 'center', minHeight: 36 },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.mist },
  barMine: { backgroundColor: colors.tintSuccess },
  resultLabel: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  mineText: { color: colors.textSuccess },
  statusLine: { ...font(400), fontSize: 12, color: colors.textSecondary },
  blockCaption: { ...font(400), fontSize: 11, color: colors.textTertiary },
  closeAction: { ...font(500), fontSize: 13, color: colors.textError, marginTop: spacing.xs },
});
