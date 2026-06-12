import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';
import { relativeTime } from './GateActivityRow';
import type { HomeSummary, ActivityEvent } from '../store/homeStore';

interface Props {
  glance: HomeSummary['gateGlance'];
  latest: ActivityEvent | null;
  onParcels?: () => void;
}

function Tile({
  icon, value, label, onPress, testID,
}: { icon: any; value: string; label: string; onPress?: () => void; testID?: string }) {
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap style={styles.tile} onPress={onPress} testID={testID}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.teal} />
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </Wrap>
  );
}

export default function GateGlanceCard({ glance, latest, onParcels }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.pulse} />
        <Text style={styles.title}>Gate at a Glance</Text>
      </View>
      <View style={styles.tiles}>
        <Tile icon="account-clock" value={String(glance.visitors.expected)} label="Visitors" />
        <Tile icon="package-variant" value={String(glance.parcels.pending)} label="Parcels" onPress={onParcels} testID="glance-parcels" />
        <Tile icon="broom" value={`${glance.helpers.arrived}/${glance.helpers.expected}`} label="Helpers" />
      </View>
      {latest && (
        <Text style={styles.latest} numberOfLines={1}>
          {latest.plate || latest.residentName || 'Gate event'} {latest.direction === 'exit' ? 'exited' : 'entered'} · {relativeTime(latest.ts)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal },
  title: { ...font(500), fontSize: 14, color: colors.textInverse },
  tiles: { flexDirection: 'row' },
  tile: { flex: 1, alignItems: 'center', gap: 2 },
  value: { ...font(700), fontSize: 24, color: colors.textInverse },
  label: { ...font(400), fontSize: 11, color: colors.mist },
  latest: { ...font(400), fontSize: 12, color: colors.mist, marginTop: spacing.md, textAlign: 'center' },
});
