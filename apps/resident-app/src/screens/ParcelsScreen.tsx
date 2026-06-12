import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, StatusBadge, Button } from '../components/ui';
import * as api from '../api/client';
import { uploadUrl } from '../api/client';

interface Parcel {
  id: string;
  company: string;
  note: string | null;
  status: string;
  loggedByName: string | null;
  createdAt: string;
  imageUrl: string | null;
}

function mapParcel(raw: any): Parcel {
  return {
    id: raw.id,
    company: raw.company,
    note: raw.note ?? null,
    status: raw.status,
    loggedByName: raw.logged_by_name ?? null,
    createdAt: raw.created_at,
    imageUrl: raw.image_url ?? null,
  };
}

// Older parcels read "hotter": >=3 days = error accent, >=1 day = warning, else neutral.
function ageAccent(createdAt: string): string | undefined {
  const days = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  if (days >= 3) return colors.error;
  if (days >= 1) return colors.warning;
  return undefined;
}

export default function ParcelsScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDeliveries();
      setItems((res.data.data || []).map(mapParcel));
    } catch {
      /* leave list as-is; reopening retries */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const collect = async (id: string) => {
    const prev = items;
    setItems(items.filter((p) => p.id !== id)); // optimistic
    try {
      await api.collectDelivery(id);
    } catch {
      setItems(prev); // restore on failure
    }
  };

  return (
    <View style={styles.container}>
      <AppBar title="Parcels" onBack={onBack} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.teal} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}><Text style={type.bodySecondary}>No parcels at the gate</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {items.map((p) => (
            <Card key={p.id} accent={ageAccent(p.createdAt)} style={styles.card}>
              {p.imageUrl ? <Image source={{ uri: uploadUrl(p.imageUrl) || undefined }} style={styles.photo} resizeMode="cover" /> : null}
              <View style={styles.rowTop}>
                <Text style={type.h3}>{p.company}</Text>
                <StatusBadge preset={p.status === 'waiting' ? 'pending' : 'granted'} size="sm" />
              </View>
              {p.note ? <Text style={type.bodySecondary}>{p.note}</Text> : null}
              {p.loggedByName ? <Text style={type.micro}>Received by {p.loggedByName}</Text> : null}
              {p.status === 'waiting' && (
                <Button title="Mark collected" onPress={() => collect(p.id)} style={styles.collectBtn} />
              )}
            </Card>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, gap: spacing.sm },
  card: { gap: spacing.xs },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collectBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  photo: { width: '100%', height: 140, borderRadius: radius.sm, marginBottom: spacing.xs },
});
