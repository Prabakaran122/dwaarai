import React, { useState } from 'react';
import { View, Text, Modal, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { Input, Button } from '../components/ui';
import * as api from '../api/client';
import AnnouncementCard from '../components/AnnouncementCard';
import { pickIssuePhotos, MAX_ISSUE_PHOTOS } from '../lib/photos';

type Kind = 'issue' | 'poll' | 'discussion' | 'announcement';

const KINDS: { key: Kind; label: string; committeeOnly: boolean }[] = [
  { key: 'issue', label: 'Report issue', committeeOnly: false },
  { key: 'poll', label: 'Create poll', committeeOnly: true },
  { key: 'discussion', label: 'Start discussion', committeeOnly: false },
  { key: 'announcement', label: 'Announce', committeeOnly: true },
];

const ISSUE_CATS = ['maintenance', 'security', 'amenities', 'general'] as const;
// Three tiers per F-21. 'normal' is the stored value for the BRD's "General"
// -- the server accepts both, and sending the stored value keeps this screen
// working against an older API too.
const PRIORITIES = [
  { key: 'normal', label: 'General', hint: 'Feed and a quiet notification' },
  { key: 'important', label: 'Important', hint: 'Notifies everyone with sound' },
  { key: 'urgent', label: 'Urgent', hint: 'Notification and SMS. Use sparingly.' },
] as const;

export type Priority = (typeof PRIORITIES)[number]['key'];

export default function ComposeSheet({
  visible,
  isCommittee,
  onClose,
  onPosted,
  onCreatePoll,
}: {
  visible: boolean;
  isCommittee: boolean;
  onClose: () => void;
  onPosted: () => void;
  onCreatePoll?: () => void;
}) {
  const VISIBLE_KINDS = KINDS.filter((k) => isCommittee || !k.committeeOnly);

  const [kind, setKind] = useState<Kind>('issue');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState<Priority>('normal');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reset = () => {
    setTitle(''); setBody(''); setCategory('general'); setPriority('normal'); setKind('issue'); setPhotos([]);
  };
  const close = () => { reset(); onClose(); };

  // "Create poll" doesn't have its own in-sheet form — PollCreateScreen is a
  // full-screen component with its own AppBar, and nesting a flex:1 screen
  // inside this sheet's ScrollView collapses its height and stacks two
  // dismiss affordances. Instead, close the sheet and ask the parent
  // (CommunityScreen) to open it as its own screen, matching how
  // IssueDetailScreen/NoticeBoardScreen are opened.
  const openPollComposer = () => { close(); onCreatePoll?.(); };

  const selectKind = (key: Kind) => {
    if (key === 'poll') { openPollComposer(); return; }
    setKind(key);
  };

  const addPhotos = async () => {
    const picked = await pickIssuePhotos(photos.length);
    if (picked.length) setPhotos((prev) => [...prev, ...picked]);
  };

  const submit = async () => {
    setMsg(null);
    if (!title.trim() || !body.trim()) { setMsg('Add a title and details.'); return; }
    setSaving(true);
    try {
      if (kind === 'issue') {
        const created = await api.createIssue({ title: title.trim(), body: body.trim(), category });
        if (photos.length) {
          try {
            await api.uploadIssuePhotos(created.data.data.id, photos);
          } catch {
            // The issue is already filed — a failed photo upload must not lose it.
          }
        }
      } else if (kind === 'discussion') {
        await api.createDiscussion({ title: title.trim(), body: body.trim() });
      } else if (kind === 'announcement') {
        await api.createAnnouncement({ title: title.trim(), body: body.trim(), priority });
      }
      reset(); onPosted();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.tabs}>
            {VISIBLE_KINDS.map((k) => (
              <Text key={k.key} onPress={() => selectKind(k.key)} style={[styles.tab, kind === k.key && styles.tabActive]}>
                {k.label}
              </Text>
            ))}
          </View>
          <ScrollView contentContainerStyle={styles.form}>
            <Input label="Title" placeholder="Title" value={title} onChangeText={setTitle} />
            <Input testID="compose-body" label="Details" placeholder="Write something…" value={body} onChangeText={setBody} multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
            {kind === 'issue' ? (
              <>
                <View style={styles.cats}>
                  {ISSUE_CATS.map((c) => <Text key={c} onPress={() => setCategory(c)} style={[styles.cat, category === c && styles.catActive]}>{c}</Text>)}
                </View>
                <Text onPress={addPhotos} style={styles.addPhotos}>
                  Add photos ({photos.length}/{MAX_ISSUE_PHOTOS} photos)
                </Text>
              </>
            ) : null}
            {kind === 'announcement' ? (
              <>
                <View style={styles.cats}>
                  {PRIORITIES.map((p) => (
                    <Text key={p.key} onPress={() => setPriority(p.key)} style={[styles.cat, priority === p.key && styles.catActive]}>
                      {p.label}
                    </Text>
                  ))}
                </View>
                <Text style={styles.hint}>{PRIORITIES.find((p) => p.key === priority)?.hint}</Text>

                {/* Live preview (F-23). Renders the same AnnouncementCard the
                    feed uses, so the preview cannot drift from what residents
                    actually see. */}
                <Text style={styles.previewLabel}>Preview</Text>
                <View testID="announcement-preview" style={styles.preview}>
                  <AnnouncementCard
                    announcement={{
                      id: 'preview',
                      title: title.trim() || 'Your announcement title',
                      body: body.trim() || 'Your message will appear here.',
                      authorName: 'You',
                      createdAt: new Date().toISOString(),
                    }}
                  />
                </View>
              </>
            ) : null}
            {msg ? <Text style={styles.msg}>{msg}</Text> : null}
            <Button title="Post" onPress={submit} loading={saving} style={styles.post} />
            <Text onPress={close} style={styles.cancel}>Cancel</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(13,37,53,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.mist, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%', paddingTop: spacing.md },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  tab: { ...font(500), fontSize: 13, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden' },
  tabActive: { backgroundColor: colors.brandPrimary, color: colors.textInverse },
  form: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['3xl'] },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  cat: { ...font(500), fontSize: 12, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden', textTransform: 'capitalize' },
  catActive: { backgroundColor: colors.teal, color: colors.textInverse },
  addPhotos: { ...font(500), fontSize: 13, color: colors.brandPrimary, marginTop: spacing.xs },
  msg: { ...font(400), fontSize: 12, color: colors.textError, marginTop: spacing.xs },
  hint: { ...type.micro, marginTop: spacing.xs },
  previewLabel: { ...type.caption, marginTop: spacing.md },
  preview: { marginTop: spacing.xs },
  post: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  cancel: { ...font(500), fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
});
