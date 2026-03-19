import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
} from 'react-native';
import VehicleCard from '../components/VehicleCard';
import { useVehicleStore, Vehicle } from '../store/vehicleStore';

export default function VehiclesScreen() {
  const { vehicles, loading, fetch, add, update, remove } = useVehicleStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [type, setType] = useState('car');

  useEffect(() => {
    fetch();
  }, []);

  const resetForm = () => {
    setPlate('');
    setMake('');
    setModel('');
    setType('car');
    setEditing(null);
    setShowForm(false);
  };

  const openEdit = (v: Vehicle) => {
    setEditing(v);
    setPlate(v.plate);
    setMake(v.make);
    setModel(v.model);
    setType(v.type);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!plate.trim()) {
      Alert.alert('Error', 'Plate number is required');
      return;
    }
    try {
      if (editing) {
        await update(editing.id, { plate, make, model, type });
      } else {
        await add({ plate, make, model, type });
      }
      resetForm();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error || 'Save failed');
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('Remove Vehicle', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={vehicles}
        keyExtractor={(v) => v.id}
        refreshing={loading}
        onRefresh={fetch}
        renderItem={({ item }) => (
          <VehicleCard
            vehicle={item}
            onPress={openEdit}
            onDelete={handleDelete}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No vehicles registered</Text>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowForm(true)}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editing ? 'Edit Vehicle' : 'Add Vehicle'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Plate number"
              value={plate}
              onChangeText={setPlate}
              autoCapitalize="characters"
            />
            <TextInput
              style={styles.input}
              placeholder="Make"
              value={make}
              onChangeText={setMake}
            />
            <TextInput
              style={styles.input}
              placeholder="Model"
              value={model}
              onChangeText={setModel}
            />
            <TextInput
              style={styles.input}
              placeholder="Type (car, bike, truck)"
              value={type}
              onChangeText={setType}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={resetForm} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave} style={styles.saveBtn}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 40, fontSize: 16 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    maxWidth: 360,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: '#1e293b',
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  cancelBtn: { padding: 12 },
  cancelText: { color: '#64748b', fontSize: 16 },
  saveBtn: { backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
