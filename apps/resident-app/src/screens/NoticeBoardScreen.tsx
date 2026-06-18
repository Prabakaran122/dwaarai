import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, Modal, Pressable, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button, Input } from '../components/ui';
import { useNoticeStore, Notice, NoticeReply } from '../store/noticeStore';
import { useAuthStore } from '../store/authStore';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function OfficialTag({ pinned }: { pinned?: boolean }) {
  return (
    <View style={[styles.tag, styles.tagOfficial]}>
      <MaterialCommunityIcons name="bullhorn" size={12} color={colors.textWarning} />
      <Text style={[styles.tagText, { color: colors.textWarning }]}>Official{pinned ? ' · pinned' : ''}</Text>
    </View>
  );
}

function DiscussionTag() {
  return (
    <View style={[styles.tag, styles.tagDiscussion]}>
      <MaterialCommunityIcons name="forum-outline" size={12} color={colors.textInfo} />
      <Text style={[styles.tagText, { color: colors.textInfo }]}>Discussion</Text>
    </View>
  );
}

// ── Thread detail ────────────────────────────────────────────────────────────
function ThreadView({ notice, onBack }: { notice: Notice; onBack: () => void }) {
  const getThread = useNoticeStore((s) => s.getThread);
  const reply = useNoticeStore((s) => s.reply);
  const [replies, setReplies] = useState<NoticeReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await getThread(notice.id);
      setReplies(t.replies);
    } catch {
      // leave empty on failure
    } finally {
      setLoading(false);
    }
  }, [notice.id]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const r = await reply(notice.id, text.trim());
      setReplies((prev) => [...prev, r]);
      setText('');
    } catch (err: any) {
      Alert.alert('Could not reply', err?.response?.data?.error?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const isOfficial = notice.category === 'official';

  return (
    <View style={styles.container}>
      <AppBar title={isOfficial ? 'Notice' : 'Discussion'} onBack={onBack} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={replies}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.teal} />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Card accent={isOfficial ? colors.warning : undefined} style={styles.postCard}>
              {isOfficial ? <OfficialTag pinned={notice.isPinned} /> : null}
              <Text style={[type.h1, styles.postTitle]}>{notice.title}</Text>
              <Text style={[type.body, styles.postBody]}>{notice.body}</Text>
              <Text style={type.micro}>
                {notice.authorName}{notice.authorUnit ? ` · ${notice.authorUnit}` : ''} · {timeAgo(notice.createdAt)}
              </Text>
            </Card>
          }
          renderItem={({ item }) => (
            <View style={styles.replyRow}>
              <View style={styles.replyDot} />
              <View style={styles.replyBubble}>
                <Text style={[type.caption, styles.replyByline]}>
                  {item.authorName}{item.authorUnit ? ` · ${item.authorUnit}` : ''}
                  {item.postedByRole === 'admin' ? '  ·  RWA' : ''}
                </Text>
                <Text style={type.body}>{item.body}</Text>
                <Text style={[type.micro, styles.replyTime]}>{timeAgo(item.createdAt)}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            !loading ? (
              <Text style={[type.bodySecondary, styles.emptyReplies]}>No replies yet. Start the conversation.</Text>
            ) : null
          }
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            placeholder="Write a reply…"
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Pressable
            onPress={send}
            disabled={sending || !text.trim()}
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          >
            <MaterialCommunityIcons name="send" size={20} color={colors.textInverse} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Board list ────────────────────────────────────────────────────────────────
interface Props {
  onClose?: () => void;
}

export default function NoticeBoardScreen({ onClose }: Props) {
  const { notices, loading, fetch, create, remove } = useNoticeStore();
  const userId = useAuthStore((s) => s.user?.id);
  const [selected, setSelected] = useState<Notice | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => { fetch(); }, []);

  const submit = async () => {
    if (!title.trim() || !body.trim()) { Alert.alert('Error', 'Add a title and a message.'); return; }
    try {
      await create({ title: title.trim(), body: body.trim() });
      setTitle(''); setBody(''); setShowForm(false);
    } catch (err: any) {
      Alert.alert('Could not post', err?.response?.data?.error?.message || 'Please try again.');
    }
  };

  const confirmRemove = (n: Notice) => {
    Alert.alert('Remove discussion', `Remove "${n.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(n.id).catch(() => {}) },
    ]);
  };

  if (selected) {
    return <ThreadView notice={selected} onBack={() => { setSelected(null); fetch(); }} />;
  }

  return (
    <View style={styles.container}>
      <AppBar title="Notice board" onBack={onClose} />

      <FlatList
        data={notices}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetch} tintColor={colors.teal} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const isOwn = item.authorResidentId && item.authorResidentId === userId;
          const isOfficial = item.category === 'official';
          return (
            <Card
              accent={isOfficial ? colors.warning : undefined}
              style={styles.listCard}
              onPress={() => setSelected(item)}
            >
              <Pressable onLongPress={() => { if (isOwn) confirmRemove(item); }}>
                <View style={styles.cardTop}>
                  {isOfficial ? <OfficialTag pinned={item.isPinned} /> : <DiscussionTag />}
                  <Text style={type.micro}>{timeAgo(item.lastActivityAt)}</Text>
                </View>
                <Text style={[type.h3, styles.cardTitle]}>{item.title}</Text>
                <Text style={[type.bodySecondary, styles.cardPreview]} numberOfLines={2}>{item.body}</Text>
                <View style={styles.cardFoot}>
                  <Text style={type.caption}>
                    {item.authorName}{item.authorUnit ? ` · ${item.authorUnit}` : ''}
                  </Text>
                  <View style={styles.replyCount}>
                    <MaterialCommunityIcons name="comment-outline" size={13} color={colors.textTertiary} />
                    <Text style={type.micro}>{item.replyCount}</Text>
                  </View>
                </View>
              </Pressable>
            </Card>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="bulletin-board" size={48} color={colors.textTertiary} />
            <Text style={[type.h3, styles.emptyText]}>Nothing here yet</Text>
            <Text style={type.bodySecondary}>Start a discussion with your community</Text>
          </View>
        }
      />

      <Pressable style={styles.fab} onPress={() => setShowForm(true)}>
        <MaterialCommunityIcons name="pencil" size={24} color={colors.textInverse} />
      </Pressable>

      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={[type.h1, styles.modalTitle]}>New discussion</Text>
            <View style={styles.field}>
              <Input
                placeholder="Title"
                value={title}
                onChangeText={setTitle}
                maxLength={200}
              />
            </View>
            <TextInput
              style={styles.textarea}
              placeholder="What would you like to raise?"
              placeholderTextColor={colors.textTertiary}
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={5000}
            />
            <Text style={[type.micro, styles.formNote]}>Posted with your name and unit. Official notices are posted by the RWA.</Text>
            <View style={styles.modalButtons}>
              <Button title="Cancel" variant="ghost" onPress={() => setShowForm(false)} style={styles.modalBtn} />
              <Button title="Post" variant="primary" icon="send" onPress={submit} style={styles.modalBtn} />
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  list: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  listCard: { marginBottom: spacing.md },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  tagOfficial: { backgroundColor: colors.tintWarning },
  tagDiscussion: { backgroundColor: colors.tintInfo },
  tagText: { ...type.micro, fontSize: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardTitle: { marginBottom: spacing.xs },
  cardPreview: { marginBottom: spacing.md },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  replyCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  emptyState: { alignItems: 'center', gap: spacing.sm, marginTop: spacing['5xl'] },
  emptyText: { marginTop: spacing.sm },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  // thread
  postCard: { marginBottom: spacing.lg },
  postTitle: { marginBottom: spacing.sm },
  postBody: { marginBottom: spacing.md, lineHeight: 22 },
  replyRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  replyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surfaceBorder, marginTop: 8, marginLeft: 4 },
  replyBubble: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.surfaceBorder, padding: spacing.md },
  replyByline: { marginBottom: 4 },
  replyTime: { marginTop: 6 },
  emptyReplies: { textAlign: 'center', marginTop: spacing.xl },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.surfaceBorder, backgroundColor: colors.surface },
  composerInput: { flex: 1, maxHeight: 120, backgroundColor: colors.mist, borderRadius: radius.md, borderWidth: 1, borderColor: colors.inputBorder, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...type.body },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  // modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(13,37,53,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 380 },
  modalTitle: { marginBottom: spacing.lg },
  field: { marginBottom: spacing.md },
  textarea: { minHeight: 110, textAlignVertical: 'top', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.inputBorder, padding: spacing.md, ...type.body, marginBottom: spacing.md },
  formNote: { marginBottom: spacing.lg, lineHeight: 17 },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
  modalBtn: { flex: 1, minWidth: 0 },
});
