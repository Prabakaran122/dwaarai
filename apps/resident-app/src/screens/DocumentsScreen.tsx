import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { AppBar, Card, Button } from '../components/ui';
import * as api from '../api/client';

// Native picker is optional — the app still runs (and tests pass) without the module.
function getDocumentPicker(): any | null {
  try { return require('expo-document-picker'); } catch { return null; }
}

interface Doc { id: string; title: string; category: string; fileUrl: string; mime: string | null; }
const CAT_LABEL: Record<string, string> = { ownership: 'Ownership', maintenance: 'Maintenance', id_proof: 'ID proof', other: 'Other' };

export default function DocumentsScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDocuments();
      setItems((res.data.data || []).map((d: any) => ({ id: d.id, title: d.title, category: d.category, fileUrl: d.fileUrl, mime: d.mime ?? null })));
    } catch { /* keep */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    const picker = getDocumentPicker();
    if (!picker) { setHint('Document upload needs the full app build.'); return; }
    try {
      const result = await picker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      const form = new FormData();
      form.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' } as any);
      form.append('title', asset.name);
      form.append('category', 'other');
      setUploading(true);
      await api.uploadDocument(form);
      await load();
    } catch { setHint('Upload failed. Please try again.'); } finally { setUploading(false); }
  };

  const remove = async (id: string) => {
    const prev = items;
    setItems(items.filter((d) => d.id !== id));
    try { await api.deleteDocument(id); } catch { setItems(prev); }
  };

  return (
    <View style={styles.container}>
      <AppBar title="Documents" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Button title="Upload document" icon="upload" onPress={upload} loading={uploading} style={styles.uploadBtn} />
        {hint ? <Text style={[type.micro, styles.hint]}>{hint}</Text> : null}
        {loading ? (
          <ActivityIndicator color={colors.teal} style={{ marginTop: spacing.lg }} />
        ) : items.length === 0 ? (
          <Text style={[type.bodySecondary, { marginTop: spacing.lg }]}>No documents in your vault yet</Text>
        ) : (
          items.map((d) => (
            <Card key={d.id} style={styles.docCard}>
              <View style={styles.docRow}>
                <MaterialCommunityIcons name={d.mime === 'application/pdf' ? 'file-pdf-box' : 'file-image'} size={28} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={type.h3} numberOfLines={1}>{d.title}</Text>
                  <Text style={type.micro}>{CAT_LABEL[d.category] || 'Other'}</Text>
                </View>
              </View>
              <View style={styles.docActions}>
                <Text onPress={() => { const u = api.uploadUrl(d.fileUrl); if (u) Linking.openURL(u); }} style={styles.view}>View</Text>
                <Text onPress={() => remove(d.id)} style={styles.remove}>Remove</Text>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  uploadBtn: { alignSelf: 'flex-start' },
  hint: { color: colors.textWarning, marginTop: spacing.sm },
  docCard: { marginTop: spacing.md, gap: spacing.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  docActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg },
  view: { ...font(500), fontSize: 13, color: colors.teal },
  remove: { ...font(500), fontSize: 13, color: colors.error },
});
