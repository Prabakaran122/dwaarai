import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert, Modal, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type as textType } from '../theme/typography';
import { AppBar, Button, Card, Input, StatusBadge } from '../components/ui';
import PlateText from '../components/PlateText';
import { useVehicleStore, Vehicle } from '../store/vehicleStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const typeIcons: Record<string, string> = {
  car: 'car',
  bike: 'motorbike',
  truck: 'truck',
};

const BANNER_KEY = 'communitygate_fastag_banner_dismissed';

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
    <View style={styles.container}>
      <AppBar title="Vehicles" onBack={onClose} />

      <FlatList
        data={vehicles}
        keyExtractor={(v) => v.id}
        refreshing={loading}
        onRefresh={fetch}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          showBanner ? (
            <Card style={styles.bannerCard} accent={colors.success}>
              <View style={styles.bannerRow}>
                <MaterialCommunityIcons name="car-wireless" size={24} color={colors.success} />
                <View style={styles.bannerText}>
                  <Text style={styles.bannerTitle}>Your FASTag links automatically!</Text>
                  <Text style={styles.bannerDesc}>Just drive through the gate — your FASTag will be detected and linked to this vehicle. No setup needed.</Text>
                </View>
                <TouchableOpacity onPress={dismissBanner}>
                  <MaterialCommunityIcons name="close" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            </Card>
          ) : null
        }
        renderItem={({ item }) => {
          const lastEntry = item.lastEntryAt
            ? `Last entered: ${new Date(item.lastEntryAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${new Date(item.lastEntryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '';

          return (
            <Card style={styles.vehicleCard}>
              <TouchableOpacity onPress={() => openEdit(item)} onLongPress={() => handleDelete(item)} activeOpacity={0.7}>
                <View style={styles.vehicleRow}>
                  <View style={styles.vehicleIcon}>
                    <MaterialCommunityIcons
                      name={(typeIcons[item.type] || 'car') as any}
                      size={22}
                      color={colors.brandPrimary}
                    />
                  </View>
                  <View style={styles.vehicleInfo}>
                    <PlateText plate={item.plate} size="md" />
                    {(item.make || item.model) ? (
                      <Text style={textType.bodySecondary}>{item.make} {item.model}</Text>
                    ) : null}
                    {lastEntry ? (
                      <Text style={textType.micro}>{lastEntry}</Text>
                    ) : null}
                  </View>
                  <View style={styles.vehicleMeta}>
                    <StatusBadge
                      preset={item.fastagTidHash ? 'verified' : 'info'}
                      label={item.fastagTidHash ? 'FASTag' : 'No FASTag'}
                      size="sm"
                    />
                  </View>
                </View>
              </TouchableOpacity>
            </Card>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="car" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No vehicles registered</Text>
            <Text style={styles.emptySubtext}>Tap + to add your first vehicle</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fabWrap} onPress={() => setShowForm(true)} activeOpacity={0.8}>
        <View style={styles.fab}>
          <MaterialCommunityIcons name="plus" size={28} color={colors.textInverse} />
        </View>
      </TouchableOpacity>

      {/* Modal Form */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Vehicle' : 'Add Vehicle'}</Text>
            <Input
              placeholder="Plate number"
              value={plate}
              onChangeText={setPlate}
              autoCapitalize="characters"
              style={styles.inputSpaced}
            />
            <Input
              placeholder="Make (optional)"
              value={make}
              onChangeText={setMake}
              style={styles.inputSpaced}
            />
            <Input
              placeholder="Model (optional)"
              value={model}
              onChangeText={setModel}
              style={styles.inputSpaced}
            />
            <View style={styles.typeChips}>
              {(['car', 'bike', 'truck'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setType(t)}
                  style={type === t ? styles.chipActive : styles.chipInactive}
                >
                  <MaterialCommunityIcons
                    name={(typeIcons[t] || 'car') as any}
                    size={16}
                    color={type === t ? colors.textInverse : colors.textTertiary}
                  />
                  <Text style={type === t ? styles.chipTextActive : styles.chipText}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="destructive" onPress={resetForm} />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={{ flex: 1 }}>
                <Button title="Save" variant="primary" icon="check-circle" onPress={handleSave} />
              </View>
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  list: { padding: spacing.lg, paddingBottom: 100 },
  bannerCard: { marginBottom: spacing.lg },
  bannerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: colors.textSuccess, marginBottom: spacing.xs },
  bannerDesc: { fontSize: 12, color: colors.textTertiary, lineHeight: 18 },
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center',
  },
  vehicleInfo: { flex: 1, gap: spacing.xs },
  vehicleMeta: { alignItems: 'flex-end' },
  emptyState: { alignItems: 'center', gap: spacing.sm, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: colors.textTertiary, fontSize: 13 },
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  inputSpaced: { marginBottom: spacing.md },
  typeChips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  chipActive: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  chipInactive: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  chipText: { color: colors.textTertiary, fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: colors.textInverse, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  modalButtons: { flexDirection: 'row' },
});
