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
import PassCard from '../components/PassCard';
import * as api from '../api/client';

interface Pass {
  id: string;
  visitorName: string;
  visitorPhone: string;
  otp: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  validFrom: string;
  validUntil: string;
}

export default function PassesScreen() {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [hours, setHours] = useState('24');

  const fetchPasses = async () => {
    setLoading(true);
    try {
      const res = await api.getPasses();
      setPasses(res.data.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPasses();
  }, []);

  const handleCreate = async () => {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Error', 'Name and phone are required');
      return;
    }
    try {
      const now = new Date();
      const until = new Date(now.getTime() + parseInt(hours, 10) * 3600000);
      await api.createPass({
        visitorName: name.trim(),
        visitorPhone: phone.trim(),
        validFrom: now.toISOString(),
        validUntil: until.toISOString(),
      });
      setName('');
      setPhone('');
      setHours('24');
      setShowForm(false);
      fetchPasses();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error || 'Failed to create pass');
    }
  };

  const handleRevoke = (id: string) => {
    Alert.alert('Revoke Pass', 'This will invalidate the visitor pass.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          await api.revokePass(id);
          fetchPasses();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={passes}
        keyExtractor={(p) => p.id}
        refreshing={loading}
        onRefresh={fetchPasses}
        renderItem={({ item }) => (
          <PassCard pass={item} onRevoke={handleRevoke} />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No visitor passes</Text>
        }
      />

      <TouchableOpacity style={styles.fab} onPress={() => setShowForm(true)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Visitor Pass</Text>
            <TextInput
              style={styles.input}
              placeholder="Visitor name"
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="Visitor phone"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Validity (hours)"
              value={hours}
              onChangeText={setHours}
              keyboardType="number-pad"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setShowForm(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreate} style={styles.saveBtn}>
                <Text style={styles.saveText}>Create</Text>
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
