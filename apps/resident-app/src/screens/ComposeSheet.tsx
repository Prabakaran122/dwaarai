import React, { useState } from 'react';
import { View, Text, Modal, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { Input, Button } from '../components/ui';
import * as api from '../api/client';

type Tab = 'issue' | 'poll' | 'discussion';
const ISSUE_CATS = ['maintenance', 'security', 'amenities', 'general'];

export default function ComposeSheet({ visible, onClose, onPosted }: { visible: boolean; onClose: () => void; onPosted: () => void }) {
  const [tab, setTab] = useState<Tab>('issue');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [saving, setSaving] = useState(false);

  const reset = () => { setTitle(''); setBody(''); setCategory('general'); setQuestion(''); setOptions(['', '']); setTab('issue'); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    setSaving(true);
    try {
      if (tab === 'issue') { if (!title.trim() || !body.trim()) return; await api.createIssue({ title: title.trim(), body: body.trim(), category }); }
      else if (tab === 'discussion') { if (!title.trim() || !body.trim()) return; await api.createNotice({ title: title.trim(), body: body.trim() }); }
      else { const opts = options.map((o) => o.trim()).filter(Boolean); if (!question.trim() || opts.length < 2) return; await api.createPoll({ question: question.trim(), options: opts }); }
      reset(); onPosted();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.tabs}>
            {(['issue', 'poll', 'discussion'] as Tab[]).map((t) => (
              <Text key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>{t === 'issue' ? 'Issue' : t === 'poll' ? 'Poll' : 'Discussion'}</Text>
            ))}
          </View>
          <ScrollView contentContainerStyle={styles.form}>
            {tab === 'poll' ? (
              <>
                <Input label="Question" placeholder="What should we decide?" value={question} onChangeText={setQuestion} />
                {options.map((o, idx) => (
                  <Input key={idx} label={`Option ${idx + 1}`} placeholder="Option" value={o} onChangeText={(v) => setOptions((prev) => prev.map((x, i) => (i === idx ? v : x)))} />
                ))}
                {options.length < 6 ? <Text onPress={() => setOptions((p) => [...p, ''])} style={styles.addOpt}>+ Add option</Text> : null}
              </>
            ) : (
              <>
                <Input label="Title" placeholder="Short title" value={title} onChangeText={setTitle} />
                <Input label="Details" placeholder="Describe it" value={body} onChangeText={setBody} />
                {tab === 'issue' ? (
                  <View style={styles.cats}>
                    {ISSUE_CATS.map((c) => <Text key={c} onPress={() => setCategory(c)} style={[styles.cat, category === c && styles.catActive]}>{c}</Text>)}
                  </View>
                ) : null}
              </>
            )}
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
  tabs: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  tab: { ...font(500), fontSize: 13, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden' },
  tabActive: { backgroundColor: colors.brandPrimary, color: colors.textInverse },
  form: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['3xl'] },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  cat: { ...font(500), fontSize: 12, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden', textTransform: 'capitalize' },
  catActive: { backgroundColor: colors.teal, color: colors.textInverse },
  addOpt: { ...font(500), fontSize: 13, color: colors.teal },
  post: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  cancel: { ...font(500), fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
});
