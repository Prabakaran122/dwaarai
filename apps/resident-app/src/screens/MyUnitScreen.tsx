import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, SectionHeader, Card } from '../components/ui';
import UnitHero from '../components/UnitHero';
import MemberRow from '../components/MemberRow';
import VehicleRow from '../components/VehicleRow';
import DuesSnapshotCard from '../components/DuesSnapshotCard';
import { useUnitStore } from '../store/unitStore';
import MembersScreen from './MembersScreen';
import VehiclesScreen from './VehiclesScreen';
import DuesScreen from './DuesScreen';
import PetsScreen from './PetsScreen';
import PetRow from '../components/PetRow';
import DocumentsScreen from './DocumentsScreen';

type Overlay = 'members' | 'vehicles' | 'dues' | 'pets' | 'documents' | null;

interface Props { onNavigate?: (tab: 'home' | 'myunit' | 'community' | 'events' | 'profile') => void; }

export default function MyUnitScreen({ onNavigate }: Props) {
  const { profile, error, fetch } = useUnitStore();
  const [refreshing, setRefreshing] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);

  const load = useCallback(async () => { await fetch(); }, [fetch]);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (overlay === 'members') return <MembersScreen onClose={() => { setOverlay(null); load(); }} />;
  if (overlay === 'vehicles') return <VehiclesScreen onClose={() => { setOverlay(null); load(); }} />;
  if (overlay === 'dues') return <DuesScreen onClose={() => { setOverlay(null); load(); }} />;
  if (overlay === 'pets') return <PetsScreen onBack={() => { setOverlay(null); load(); }} />;
  if (overlay === 'documents') return <DocumentsScreen onBack={() => setOverlay(null)} />;

  const members = profile?.members ?? [];
  const vehicles = profile?.vehicles ?? [];
  const pets = profile?.pets ?? [];
  const dues = profile?.dues ?? { outstanding: 0, pendingCount: 0 };

  return (
    <View style={styles.container}>
      <AppBar title="My Unit" />
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}>
        {profile?.unit ? <UnitHero unit={profile.unit} /> : <Card><Text style={type.bodySecondary}>{error ? 'Could not load your unit. Pull to refresh.' : 'Loading…'}</Text></Card>}

        <View style={styles.block}>
          <SectionHeader title="Members" actionLabel="Manage" onAction={() => setOverlay('members')} />
          <Card>
            {members.length === 0 ? <Text style={type.bodySecondary}>No members yet</Text> : members.map((m) => <MemberRow key={m.id} member={m} />)}
          </Card>
        </View>

        <View style={styles.block}>
          <SectionHeader title="Vehicles" actionLabel="Manage" onAction={() => setOverlay('vehicles')} />
          <Card>
            {vehicles.length === 0 ? <Text style={type.bodySecondary}>No vehicles yet</Text> : vehicles.map((v) => <VehicleRow key={v.id} vehicle={v} />)}
          </Card>
        </View>

        <View style={styles.block}>
          <DuesSnapshotCard outstanding={dues.outstanding} earliestDueDate={null} onPress={() => setOverlay('dues')} />
        </View>

        <View style={styles.block}>
          <SectionHeader title="Pets" actionLabel="Manage" onAction={() => setOverlay('pets')} />
          <Card>
            {pets.length === 0 ? <Text style={type.bodySecondary}>No pets added yet</Text> : pets.map((p) => <PetRow key={p.id} pet={p} />)}
          </Card>
        </View>

        <View style={styles.block}>
          <SectionHeader title="Documents" actionLabel="Open" onAction={() => setOverlay('documents')} />
          <Card><Text style={type.bodySecondary}>Ownership deed, maintenance receipts, ID proof — your secure unit vault.</Text></Card>
        </View>

        <View style={styles.block}>
          <SectionHeader title="More" />
          <Card><Text style={type.bodySecondary}>Facility booking is coming in this redesign.</Text></Card>
        </View>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['3xl'], gap: spacing.sm },
  block: { marginTop: spacing.md },
});
