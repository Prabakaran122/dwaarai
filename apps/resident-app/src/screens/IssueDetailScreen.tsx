import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card } from '../components/ui';
import StatusTimeline from '../components/StatusTimeline';
import type { TimelineEntry } from '../components/StatusTimeline';
import RwaActionBar from '../components/RwaActionBar';
import * as api from '../api/client';
import { uploadUrl } from '../api/client';

interface Reply {
  id: string;
  author_name: string;
  author_unit: string | null;
  author_role: string | null;
  body: string;
  is_official: boolean;
  created_at: string;
}

interface Thread {
  issue: {
    id: string; title: string; body: string; category: string; status: string;
    authorName: string; authorUnit: string | null; reference: string | null;
    assigneeName: string | null; resolvedAt: string | null;
    upvoteCount: number; myUpvoted: boolean; createdAt: string;
  };
  photos: { id: string; path: string; position: number }[];
  timeline: TimelineEntry[];
  replies: Reply[];
  upvoteCount: number;
  myUpvoted: boolean;
  canChangeStatus: boolean;
}

export default function IssueDetailScreen({ issueId, onBack }: { issueId: string; onBack: () => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await api.getIssue(issueId);
      setThread(res.data.data as Thread);
    } catch {
      setFailed(true);
    }
  }, [issueId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await api.replyToIssue(issueId, body);
      const reply = res.data.data as Reply;
      setThread((t) => (t ? { ...t, replies: [...t.replies, reply] } : t));
      setDraft('');
    } catch {
      // Leave the draft in the box so the text is not lost.
    } finally {
      setSending(false);
    }
  };

  if (failed) {
    return (
      <View style={styles.container}>
        <AppBar title="Issue" onBack={onBack} />
        <View style={styles.centre}><Text style={type.bodySecondary}>Could not load this issue. Go back and try again.</Text></View>
      </View>
    );
  }

  if (!thread) {
    return (
      <View style={styles.container}>
        <AppBar title="Issue" onBack={onBack} />
        <View style={styles.centre}><ActivityIndicator color={colors.teal} /></View>
      </View>
    );
  }

  const { issue, photos, timeline, replies, upvoteCount, canChangeStatus } = thread;

  return (
    <View style={styles.container}>
      <AppBar title={issue.reference ?? 'Issue'} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          {/* The reference already appears in the AppBar title above; repeating it
              here would duplicate the text node and break exact-text queries. */}
          <Text style={type.h2}>{issue.title}</Text>
          <Text style={type.body}>{issue.body}</Text>
          <Text style={type.micro}>
            {issue.authorName}{issue.authorUnit ? ` · ${issue.authorUnit}` : ''} · {issue.category}
          </Text>
        </Card>

        {photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {photos.map((p) => (
              <Image key={p.id} source={{ uri: uploadUrl(p.path) ?? undefined }} style={styles.photo} />
            ))}
          </ScrollView>
        )}

        <Card style={styles.block}>
          <Text style={type.h3}>{upvoteCount} residents affected</Text>
        </Card>

        <Card style={styles.block}>
          <Text style={type.h3}>Status</Text>
          <View style={styles.timeline}><StatusTimeline entries={timeline} /></View>
        </Card>

        {canChangeStatus && (
          <RwaActionBar
            status={issue.status}
            onChange={async (next) => { await api.changeIssueStatus(issueId, next); await load(); }}
          />
        )}

        <View style={styles.block}>
          <Text style={type.h3}>Replies</Text>
          {replies.map((r) => (
            <View
              key={r.id}
              style={[styles.reply, r.is_official ? styles.replyOfficial : styles.replyPlain]}
            >
              {r.is_official && <Text style={styles.officialTag}>Official response</Text>}
              <Text style={type.micro}>
                {r.author_name}{r.author_role ? ` · ${r.author_role}` : r.author_unit ? ` · ${r.author_unit}` : ''}
              </Text>
              <Text style={type.body}>{r.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Write a reply…"
          placeholderTextColor={colors.textTertiary}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable onPress={send} style={styles.send}>
          <Text style={styles.sendLabel}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  scroll: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.sm },
  block: { marginTop: spacing.sm },
  timeline: { marginTop: spacing.md },
  photos: { gap: spacing.sm, paddingVertical: spacing.sm },
  photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceBorder },
  reply: { borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, gap: 2 },
  replyPlain: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  replyOfficial: { backgroundColor: colors.tintSuccess, borderWidth: 1, borderColor: colors.success },
  officialTag: { ...type.caption, color: colors.textSuccess },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
  input: { flex: 1, maxHeight: 96, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...type.body },
  send: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.actionPrimary },
  sendLabel: { ...type.caption, color: colors.textInverse },
});
