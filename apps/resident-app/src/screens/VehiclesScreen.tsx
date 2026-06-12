import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, Modal, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import PlateText from '../components/PlateText';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useVehicleStore, Vehicle } from '../store/vehicleStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const typeIcons: Record<string, string> = {
  car: 'car',
  bike: 'motorbike',
  truck: 'truck',
};

const BANNER_KEY = 'communitygate_fastag_banner_dismissed';

function FastagBadge({ vehicle }: { vehicle: Vehicle }) {
  if (vehicle.fastagTidHash) {
    return (
      <View style={[badgeStyles.pill, { backgroundColor: 'rgba(6,182,212,0.15)' }]}>
        <MaterialCommunityIcons name="car-wireless" size={12} color="#06b6d4" />
        <Text style={[badgeStyles.text, { color: '#06b6d4' }]}>FASTag Linked</Text>
      </View>
    );
  }
  return (
    <View style={[badgeStyles.pill, { backgroundColor: colors.surface }]}>
      <Text style={[badgeStyles.text, { color: colors.textMuted }]}>No FASTag</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  text: { fontSize: 10, fontWeight: '700' },
});

export default function VehiclesScreen({ onClose }: { onClose?: () => void } = {}) {
  const { vehicles, loading, fetch, add, update, remove } = useVehicleStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [type, setType] = useState('car');
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    fetch();
    AsyncStorage.getItem(BANNER_KEY).then((v) => { if (!v) setShowBanner(true); });
  }, []);

  const dismissBanner = () => {
    setShowBanner(false);
    AsyncStorage.setItem(BANNER_KEY, '1').catch(() => {});
  };

  const resetForm = () => { setPlate(''); setMake(''); setModel(''); setType('car'); setEditing(null); setShowForm(false); };

  const openEdit = (v: Vehicle) => {
    setEditing(v); setPlate(v.plate); setMake(v.make); setModel(v.model); setType(v.type); setShowForm(true);
  };

  const handleSave = async () => {
    if (!plate.trim()) { Alert.alert('Error', 'Plate number is required'); return; }
    try {
      if (editing) { await update(editing.id, { plate, make, model, type }); }
      else { await add({ plate, make, model, type }); }
      resetForm();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.error || 'Save failed'); }
  };

  const handleDelete = (v: Vehicle) => {
    Alert.alert('Remove Vehicle', `Remove ${v.plate}? This will unlink any FASTag.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(v.id) },
    ]);
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {onClose && (
        <TouchableOpacity onPress={onClose} style={{ padding: spacing.lg, paddingBottom: 0 }}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
      )}
      <FlatList
        data={vehicles}
        keyExtractor={(v) => v.id}
        refreshing={loading}
        onRefresh={fetch}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          showBanner ? (
            <AnimatedEntry direction="fade">
              <GlowCard variant="success" style={styles.bannerCard}>
                <View style={styles.bannerRow}>
                  <MaterialCommunityIcons name="car-wireless" size={24} color={colors.success} />
                  <View style={styles.bannerText}>
                    <Text style={styles.bannerTitle}>Your FASTag links automatically!</Text>
                    <Text style={styles.bannerDesc}>Just drive through the gate — your FASTag will be detected and linked to this vehicle. No setup needed.</Text>
                  </View>
                  <TouchableOpacity onPress={dismissBanner}>
                    <MaterialCommunityIcons name="close" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </GlowCard>
            </AnimatedEntry>
          ) : null
        }
        renderItem={({ item, index }) => {
          const lastEntry = item.lastEntryAt
            ? `Last entered: ${new Date(item.lastEntryAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${new Date(item.lastEntryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '';

          return (
            <AnimatedEntry direction="left" delay={index * 80}>
              <GlowCard style={styles.vehicleCard}>
                <TouchableOpacity onPress={() => openEdit(item)} onLongPress={() => handleDelete(item)} activeOpacity={0.7}>
                  <View style={styles.vehicleRow}>
                    <IconBadge
                      icon={(typeIcons[item.type] || 'car') as any}
                      color={colors.info}
                      gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']}
                      size={40}
                    />
                    <View style={styles.vehicleInfo}>
                      <PlateText plate={item.plate} size="lg" />
                      {(item.make || item.model) ? (
                        <Text style={styles.vehicleDetail}>{item.make} {item.model}</Text>
                      ) : null}
                      {lastEntry ? (
                        <Text style={styles.lastEntry}>{lastEntry}</Text>
                      ) : null}
                    </View>
                    <View style={styles.vehicleMeta}>
                      <FastagBadge vehicle={item} />
                    </View>
                  </View>
                </TouchableOpacity>
              </GlowCard>
            </AnimatedEntry>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="car" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No vehicles registered</Text>
            <Text style={styles.emptySubtext}>Tap + to add your first vehicle</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fabWrap} onPress={() => setShowForm(true)} activeOpacity={0.8}>
        <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.fab}>
          <MaterialCommunityIcons name="plus" size={28} color={colors.white} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Modal Form */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Vehicle' : 'Add Vehicle'}</Text>
            <TextInput style={styles.input} placeholder="Plate number" placeholderTextColor={colors.textMuted} value={plate} onChangeText={setPlate} autoCapitalize="characters" />
            <TextInput style={styles.input} placeholder="Make (optional)" placeholderTextColor={colors.textMuted} value={make} onChangeText={setMake} />
            <TextInput style={styles.input} placeholder="Model (optional)" placeholderTextColor={colors.textMuted} value={model} onChangeText={setModel} />
            <View style={styles.typeChips}>
              {(['car', 'bike', 'truck'] as const).map((t) => (
                <TouchableOpacity key={t} onPress={() => setType(t)}>
                  {type === t ? (
                    <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.chip}>
                      <MaterialCommunityIcons name={(typeIcons[t] || 'car') as any} size={16} color={colors.white} />
                      <Text style={styles.chipTextActive}>{t}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.chipInactive}>
                      <MaterialCommunityIcons name={(typeIcons[t] || 'car') as any} size={16} color={colors.textMuted} />
                      <Text style={styles.chipText}>{t}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={resetForm} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Save" variant="success" icon="check-circle" onPress={handleSave} />
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
  list: { padding: spacing.lg, paddingBottom: 100 },
  bannerCard: { marginBottom: spacing.lg },
  bannerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: colors.success, marginBottom: spacing.xs },
  bannerDesc: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleInfo: { flex: 1, gap: spacing.xs },
  vehicleDetail: { color: colors.textMuted, fontSize: 13 },
  lastEntry: { color: colors.textSecondary, fontSize: 11 },
  vehicleMeta: { alignItems: 'flex-end' },
  emptyState: { alignItems: 'center', gap: spacing.sm, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: colors.textMuted, fontSize: 13 },
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md,
  },
  typeChips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  chipInactive: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  chipText: { color: colors.textMuted, fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: colors.white, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
});
