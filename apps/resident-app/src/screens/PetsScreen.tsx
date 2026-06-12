import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { AppBar, Card, Input, Button } from '../components/ui';
import PetRow from '../components/PetRow';
import * as api from '../api/client';

const SPECIES = ['dog', 'cat', 'bird', 'rabbit', 'other'];
interface Pet { id: string; name: string; species: string; breed: string | null; }

export default function PetsScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('dog');
  const [breed, setBreed] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPets();
      setItems((res.data.data || []).map((p: any) => ({ id: p.id, name: p.name, species: p.species, breed: p.breed ?? null })));
    } catch { /* keep list */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createPet({ name: name.trim(), species, breed: breed.trim() || undefined });
      setName(''); setBreed(''); setSpecies('dog'); await load();
    } catch { /* ignore */ } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    const prev = items;
    setItems(items.filter((p) => p.id !== id));
    try { await api.deletePet(id); } catch { setItems(prev); }
  };

  return (
    <View style={styles.container}>
      <AppBar title="Pets" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <Text style={type.h3}>Add a pet</Text>
          <View style={{ height: spacing.sm }} />
          <Input label="Name" placeholder="e.g. Bruno" value={name} onChangeText={setName} />
          <View style={styles.speciesRow}>
            {SPECIES.map((s) => (
              <Text key={s} onPress={() => setSpecies(s)} style={[styles.chip, species === s && styles.chipActive]}>{s}</Text>
            ))}
          </View>
          <Input label="Breed (optional)" placeholder="e.g. Labrador" value={breed} onChangeText={setBreed} />
          <Button title="Add pet" onPress={add} loading={saving} style={styles.addBtn} />
        </Card>
        {loading ? (
          <ActivityIndicator color={colors.teal} style={{ marginTop: spacing.lg }} />
        ) : items.length === 0 ? (
          <Text style={[type.bodySecondary, { marginTop: spacing.lg }]}>No pets added yet</Text>
        ) : (
          <Card style={{ marginTop: spacing.md }}>
            {items.map((p) => (
              <View key={p.id} style={styles.petLine}>
                <View style={{ flex: 1 }}><PetRow pet={p} /></View>
                <Text onPress={() => remove(p.id)} style={styles.remove}>Remove</Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  speciesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginVertical: spacing.sm },
  chip: { ...font(500), fontSize: 12, color: colors.textSecondary, backgroundColor: colors.mist, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden', textTransform: 'capitalize' },
  chipActive: { backgroundColor: colors.teal, color: colors.textInverse },
  addBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  petLine: { flexDirection: 'row', alignItems: 'center' },
  remove: { ...font(500), fontSize: 12, color: colors.error, paddingHorizontal: spacing.sm },
});
