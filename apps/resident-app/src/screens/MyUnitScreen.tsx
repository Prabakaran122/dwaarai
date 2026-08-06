import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, SectionHeader, Card } from '../components/ui';
import UnitHero from '../components/UnitHero';
import MemberRow from '../components/MemberRow';
import VehicleRow from '../components/VehicleRow';
import DuesSnapshotCard from '../components/DuesSnapshotCard';
import { useUnitStore, UnitMember } from '../store/unitStore';
import MembersScreen from './MembersScreen';
import VehiclesScreen from './VehiclesScreen';
import DuesScreen from './DuesScreen';
import PetsScreen from './PetsScreen';
import PetRow from '../components/PetRow';
import DocumentsScreen from './DocumentsScreen';
import FacilityBookingScreen from './FacilityBookingScreen';
import MemberDetailScreen from './MemberDetailScreen';

type Overlay = 'members' | 'vehicles' | 'dues' | 'pets' | 'documents' | 'facilities' | null;

const DOC_CATEGORY_LABEL: Record<string, string> = { ownership: 'Ownership', maintenance: 'Maintenance', id_proof: 'ID proof', other: 'Other' };

interface Props {
  onNavigate?: (tab: 'home' | 'myunit' | 'community' | 'events' | 'profile') => void;
  /** Set by Home's "Book facility" quick action to skip straight to the booking sub-screen. */
  initialOverlay?: 'facilities';
}

export default function MyUnitScreen({ onNavigate, initialOverlay }: Props) {
  const { profile, error, fetch } = useUnitStore();
  const [refreshing, setRefreshing] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(initialOverlay ?? null);
  const [member, setMember] = useState<UnitMember | null>(null);

  const load = useCallback(async () => { await fetch(); }, [fetch]);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (member) return <MemberDetailScreen member={member} onBack={() => { setMember(null); load(); }} />;
  if (overlay === 'members') return <MembersScreen onClose={() => { setOverlay(null); load(); }} />;
  if (overlay === 'vehicles') return <VehiclesScreen onClose={() => { setOverlay(null); load(); }} />;
  if (overlay === 'dues') return <DuesScreen onClose={() => { setOverlay(null); load(); }} />;
  if (overlay === 'pets') return <PetsScreen onBack={() => { setOverlay(null); load(); }} />;
  if (overlay === 'documents') return <DocumentsScreen onBack={() => setOverlay(null)} />;
  if (overlay === 'facilities') return <FacilityBookingScreen onBack={() => setOverlay(null)} />;

  const members = profile?.members ?? [];
  const vehicles = profile?.vehicles ?? [];
  const pets = profile?.pets ?? [];
  const documents = profile?.documents ?? [];
  const dues = profile?.dues ?? { outstanding: 0, pendingCount: 0 };

  return (
    <View style={styles.container}>
      <AppBar title="My Unit" />
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}>
        {profile?.unit ? <UnitHero unit={profile.unit} /> : <Card><Text style={type.bodySecondary}>{error ? 'Could not load your unit. Pull to refresh.' : 'Loading…'}</Text></Card>}

        <View style={styles.block}>
          <SectionHeader title="Members" actionLabel="Manage" onAction={() => setOverlay('members')} />
          <Card>
            {members.length === 0 ? <Text style={type.bodySecondary}>No members yet</Text> : members.map((m) => (
              <Pressable key={m.id} onPress={() => setMember(m)}>
                <MemberRow member={m} />
              </Pressable>
            ))}
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
          <View style={styles.docGrid}>
            {documents.map((d) => (
              <Pressable key={d.id} style={styles.docTile} onPress={() => setOverlay('documents')}>
                <Text style={type.h3} numberOfLines={1}>{d.title}</Text>
                <Text style={type.micro}>{DOC_CATEGORY_LABEL[d.category] || 'Other'}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.docTile} onPress={() => setOverlay('documents')}>
              <Text style={type.h3}>+ Add document</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.block}>
          <SectionHeader title="Facilities" actionLabel="Book" onAction={() => setOverlay('facilities')} />
          <Card><Text style={type.bodySecondary}>Book badminton, tennis, basketball and more — one tap.</Text></Card>
        </View>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['3xl'], gap: spacing.sm },
  block: { marginTop: spacing.md },
  docGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  docTile: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
});
