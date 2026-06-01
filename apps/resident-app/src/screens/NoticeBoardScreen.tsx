import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, Modal, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
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

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{notice.category === 'official' ? 'Notice' : 'Discussion'}</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={replies}
          keyExtractor={(r) => r.id}
          refreshing={loading}
          onRefresh={load}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <GlowCard style={StyleSheet.flatten([styles.postCard, notice.category === 'official' && styles.officialCard])}>
              {notice.category === 'official' ? (
                <View style={styles.officialTag}>
                  <MaterialCommunityIcons name="bullhorn" size={12} color={colors.warning} />
                  <Text style={styles.officialTagText}>Official notice</Text>
                </View>
              ) : null}
              <Text style={styles.postTitle}>{notice.title}</Text>
              <Text style={styles.postBody}>{notice.body}</Text>
              <Text style={styles.byline}>
                {notice.authorName}{notice.authorUnit ? ` · ${notice.authorUnit}` : ''} · {timeAgo(notice.createdAt)}
              </Text>
            </GlowCard>
          }
          renderItem={({ item }) => (
            <View style={styles.replyRow}>
              <View style={styles.replyDot} />
              <View style={styles.replyBubble}>
                <Text style={styles.replyByline}>
                  {item.authorName}{item.authorUnit ? ` · ${item.authorUnit}` : ''}
                  {item.postedByRole === 'admin' ? '  ·  RWA' : ''}
                </Text>
                <Text style={styles.replyBody}>{item.body}</Text>
                <Text style={styles.replyTime}>{timeAgo(item.createdAt)}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.emptyReplies}>No replies yet. Start the conversation.</Text>
            ) : null
          }
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            placeholder="Write a reply…"
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity onPress={send} disabled={sending || !text.trim()} activeOpacity={0.8}>
            <LinearGradient
              colors={colors.gradientPrimary as [string, string]}
              style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]}
            >
              <MaterialCommunityIcons name="send" size={20} color={colors.white} />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

// ── Board list ────────────────────────────────────────────────────────────────
export default function NoticeBoardScreen() {
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
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Community</Text>
      </View>

      <FlatList
        data={notices}
        keyExtractor={(n) => n.id}
        refreshing={loading}
        onRefresh={fetch}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const isOwn = item.authorResidentId && item.authorResidentId === userId;
          return (
            <AnimatedEntry direction="up" delay={index * 60}>
              <TouchableOpacity activeOpacity={0.8} onPress={() => setSelected(item)} onLongPress={() => { if (isOwn) confirmRemove(item); }}>
                <GlowCard style={StyleSheet.flatten([styles.listCard, item.category === 'official' && styles.officialCard])}>
                  <View style={styles.cardTop}>
                    {item.category === 'official' ? (
                      <View style={styles.officialTag}>
                        <MaterialCommunityIcons name="bullhorn" size={12} color={colors.warning} />
                        <Text style={styles.officialTagText}>Official{item.isPinned ? ' · pinned' : ''}</Text>
                      </View>
                    ) : (
                      <View style={styles.discTag}>
                        <MaterialCommunityIcons name="forum-outline" size={12} color={colors.info} />
                        <Text style={styles.discTagText}>Discussion</Text>
                      </View>
                    )}
                    <Text style={styles.cardTime}>{timeAgo(item.lastActivityAt)}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardPreview} numberOfLines={2}>{item.body}</Text>
                  <View style={styles.cardFoot}>
                    <Text style={styles.cardByline}>
                      {item.authorName}{item.authorUnit ? ` · ${item.authorUnit}` : ''}
                    </Text>
                    <View style={styles.replyCount}>
                      <MaterialCommunityIcons name="comment-outline" size={13} color={colors.textMuted} />
                      <Text style={styles.replyCountText}>{item.replyCount}</Text>
                    </View>
                  </View>
                </GlowCard>
              </TouchableOpacity>
            </AnimatedEntry>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="bulletin-board" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>Nothing here yet</Text>
            <Text style={styles.emptySubtext}>Start a discussion with your community</Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.fabWrap} onPress={() => setShowForm(true)} activeOpacity={0.8}>
        <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.fab}>
          <MaterialCommunityIcons name="pencil" size={24} color={colors.white} />
        </LinearGradient>
      </TouchableOpacity>

      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Discussion</Text>
            <TextInput
              style={styles.input}
              placeholder="Title"
              placeholderTextColor={colors.textMuted}
              value={title}
              onChangeText={setTitle}
              maxLength={200}
            />
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="What would you like to raise?"
              placeholderTextColor={colors.textMuted}
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={5000}
            />
            <Text style={styles.formNote}>Posted with your name and unit. Official notices are posted by the RWA.</Text>
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={() => { setShowForm(false); }} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Post" variant="success" icon="send" onPress={submit} />
              </View>
            </View>
          </GlowCard>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing['3xl'], paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { width: 28, alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  list: { padding: spacing.lg, paddingBottom: 100 },
  listCard: { marginBottom: spacing.md },
  officialCard: { borderColor: colors.warningBorder, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  officialTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.warningBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  officialTagText: { fontSize: 10, fontWeight: '700', color: colors.warning },
  discTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.infoBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  discTagText: { fontSize: 10, fontWeight: '700', color: colors.info },
  cardTime: { fontSize: 11, color: colors.textMuted },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  cardPreview: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.md },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardByline: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  replyCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  replyCountText: { fontSize: 12, color: colors.textMuted },
  emptyState: { alignItems: 'center', gap: spacing.sm, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: colors.textMuted, fontSize: 13 },
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  // thread
  postCard: { marginBottom: spacing.lg },
  postTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.sm },
  postBody: { fontSize: 15, color: colors.textPrimary, lineHeight: 22, marginBottom: spacing.md },
  byline: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  replyRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  replyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surfaceBorder, marginTop: 8, marginLeft: 4 },
  replyBubble: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.surfaceBorder, padding: spacing.md },
  replyByline: { fontSize: 12, color: colors.textSecondary, fontWeight: '700', marginBottom: 4 },
  replyBody: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  replyTime: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  emptyReplies: { textAlign: 'center', color: colors.textMuted, fontSize: 13, marginTop: spacing.xl },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
  composerInput: { flex: 1, maxHeight: 120, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.surfaceBorder, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15, color: colors.textPrimary },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '88%', maxWidth: 380 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.lg },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder, padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  formNote: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 17 },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
});
