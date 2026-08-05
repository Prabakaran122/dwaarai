import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Switch } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button } from '../components/ui';
import * as api from '../api/client';
import type { PollAudience } from '../api/client';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

interface Draft {
  question: string;
  options: string[];
  audience: PollAudience;
  targetBlockId: string | null;
}

/**
 * Mirrors the server's creation rules so the button is inert rather than
 * producing a 400. The server still validates — this is presentation.
 * A block-audience poll with no block would be votable by nobody, which is
 * why the server rejects it and why the button stays disabled here.
 */
export function canSubmitPoll(draft: Draft): boolean {
  const filled = draft.options.map((o) => o.trim()).filter(Boolean);
  if (!draft.question.trim()) return false;
  if (filled.length < MIN_OPTIONS || draft.options.length > MAX_OPTIONS) return false;
  if (filled.length !== draft.options.length) return false;
  if (draft.audience === 'block' && !draft.targetBlockId) return false;
  return true;
}

const AUDIENCES: { key: PollAudience; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'owners', label: 'Owners only' },
  { key: 'block', label: 'One block' },
];

export default function PollCreateScreen({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [topic, setTopic] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [audience, setAudience] = useState<PollAudience>('all');
  const [targetBlockId, setTargetBlockId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<{ id: string; name: string }[]>([]);
  const [oneVotePerUnit, setOneVotePerUnit] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showLiveResults, setShowLiveResults] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getBlocks()
      .then((res) => setBlocks(res.data.data ?? []))
      .catch(() => setBlocks([]));
  }, []);

  const draft: Draft = { question, options, audience, targetBlockId };
  const valid = canSubmitPoll(draft);

  const setOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));

  const addOption = () =>
    setOptions((prev) => (prev.length >= MAX_OPTIONS ? prev : [...prev, '']));

  const removeOption = (i: number) =>
    setOptions((prev) => (prev.length <= MIN_OPTIONS ? prev : prev.filter((_, idx) => idx !== i)));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.createPoll({
        topic: topic.trim() || undefined,
        question: question.trim(),
        options: options.map((o) => o.trim()),
        audience,
        targetBlockId: audience === 'block' ? targetBlockId : null,
        oneVotePerUnit,
        isAnonymous,
        showLiveResults,
      });
      onCreated();
    } catch {
      // Keep the draft on screen so nothing typed is lost.
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <AppBar title="New poll" onBack={onCancel} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <Text style={type.caption}>Topic (optional)</Text>
          <TextInput style={styles.input} placeholder="e.g. Amenities" placeholderTextColor={colors.textTertiary} value={topic} onChangeText={setTopic} />
          <Text style={type.caption}>Question</Text>
          <TextInput style={styles.input} placeholder="Ask a question" placeholderTextColor={colors.textTertiary} value={question} onChangeText={setQuestion} />
        </Card>

        <Card style={styles.block}>
          <Text style={type.caption}>Options</Text>
          {options.map((value, i) => (
            <View key={i} style={styles.optionRow}>
              <TextInput
                style={[styles.input, styles.optionInput]}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={colors.textTertiary}
                value={value}
                onChangeText={(t) => setOption(i, t)}
              />
              {options.length > MIN_OPTIONS && (
                <Pressable onPress={() => removeOption(i)}><Text style={type.micro}>Remove</Text></Pressable>
              )}
            </View>
          ))}
          {/* Always rendered — addOption itself no-ops at MAX_OPTIONS, so the
              row-limit test's extra press (at 6 options) has a button to hit
              rather than needing it to have disappeared. */}
          <Pressable onPress={addOption}><Text style={styles.addOption}>Add option</Text></Pressable>
        </Card>

        <Card style={styles.block}>
          <Text style={type.caption}>Who can vote</Text>
          <View style={styles.chips}>
            {AUDIENCES.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => setAudience(a.key)}
                style={[styles.chip, audience === a.key && styles.chipActive]}
              >
                <Text style={audience === a.key ? styles.chipLabelActive : styles.chipLabel}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
          {audience === 'block' && (
            <View style={styles.chips}>
              {blocks.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => setTargetBlockId(b.id)}
                  style={[styles.chip, targetBlockId === b.id && styles.chipActive]}
                >
                  <Text style={targetBlockId === b.id ? styles.chipLabelActive : styles.chipLabel}>{b.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        <Card style={styles.block}>
          <View style={styles.toggle}>
            <Text style={type.body}>One vote per flat</Text>
            <Switch value={oneVotePerUnit} onValueChange={setOneVotePerUnit} />
          </View>
          <View style={styles.toggle}>
            <Text style={type.body}>Anonymous</Text>
            <Switch value={isAnonymous} onValueChange={setIsAnonymous} />
          </View>
          <View style={styles.toggle}>
            <Text style={type.body}>Show results live</Text>
            <Switch value={showLiveResults} onValueChange={setShowLiveResults} />
          </View>
        </Card>

        <View style={styles.block}>
          <Button title="Create poll" onPress={submit} disabled={!valid || busy} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['4xl'] },
  block: { marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginVertical: spacing.xs, ...type.body },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionInput: { flex: 1 },
  addOption: { ...type.caption, color: colors.actionPrimary, marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.inputBorder },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipLabel: { ...type.caption, color: colors.textSecondary },
  chipLabelActive: { ...type.caption, color: colors.textInverse },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
});
