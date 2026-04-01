import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, Modal, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import PlateText from '../components/PlateText';
import StatusPill from '../components/StatusPill';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useVehicleStore, Vehicle } from '../store/vehicleStore';

const typeIcons: Record<string, string> = {
  car: 'car',
  bike: 'motorbike',
  truck: 'truck',
};

export default function VehiclesScreen() {
  const { vehicles, loading, fetch, add, update, remove } = useVehicleStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [type, setType] = useState('car');

  useEffect(() => { fetch(); }, []);

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

  const handleDelete = (id: string) => {
    Alert.alert('Remove Vehicle', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(id) },
    ]);
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <FlatList
        data={vehicles}
        keyExtractor={(v) => v.id}
        refreshing={loading}
        onRefresh={fetch}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <AnimatedEntry direction="left" delay={index * 80}>
            <GlowCard style={styles.vehicleCard}>
              <TouchableOpacity onPress={() => openEdit(item)} onLongPress={() => handleDelete(item.id)} activeOpacity={0.7}>
                <View style={styles.vehicleRow}>
                  <IconBadge
                    icon={(typeIcons[item.type] || 'car') as any}
                    color={colors.info}
                    gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']}
                    size={36}
                  />
                  <View style={styles.vehicleInfo}>
                    <PlateText plate={item.plate} size="md" />
                    <Text style={styles.vehicleDetail}>{item.make} {item.model}</Text>
                  </View>
                  <View style={styles.vehicleMeta}>
                    <View style={[styles.rfidPill, { backgroundColor: item.rfidTag ? colors.successBg : colors.surface }]}>
                      <Text style={[styles.rfidText, { color: item.rfidTag ? colors.success : colors.textMuted }]}>
                        {item.rfidTag ? 'RFID' : 'No RFID'}
                      </Text>
                    </View>
                    <Text style={styles.vehicleType}>{item.type}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </GlowCard>
          </AnimatedEntry>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="car" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No vehicles registered</Text>
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
            <TextInput style={styles.input} placeholder="Make" placeholderTextColor={colors.textMuted} value={make} onChangeText={setMake} />
            <TextInput style={styles.input} placeholder="Model" placeholderTextColor={colors.textMuted} value={model} onChangeText={setModel} />
            <View style={styles.typeChips}>
              {['car', 'bike', 'truck'].map((t) => (
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
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleInfo: { flex: 1, gap: spacing.xs },
  vehicleDetail: { color: colors.textMuted, fontSize: 13 },
  vehicleMeta: { alignItems: 'flex-end', gap: spacing.xs },
  vehicleType: { color: colors.textMuted, fontSize: 11, textTransform: 'capitalize' },
  rfidPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  rfidText: { fontSize: 10, fontWeight: '700' },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
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
