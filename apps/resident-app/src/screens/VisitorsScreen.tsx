import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Modal, TouchableOpacity, Switch } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import VisitorPassCard, { PassData } from '../components/VisitorPassCard';
import RecurringPassCard, { RecurringPassData } from '../components/RecurringPassCard';
import * as api from '../api/client';
import * as recurringApi from '../api/client';
import { useAuthStore } from '../store/authStore';

const DURATION_OPTIONS = [
  { label: 'Today', hours: 4 },
  { label: 'Tomorrow', hours: 24 },
  { label: '48h', hours: 48 },
  { label: 'Custom', hours: 0 },
];

export default function VisitorsScreen() {
  const user = useAuthStore((s) => s.user);
  const [passes, setPasses] = useState<PassData[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [byCab, setByCab] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(0);
  const [recurringPasses, setRecurringPasses] = useState<RecurringPassData[]>([]);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [rName, setRName] = useState('');
  const [rRole, setRRole] = useState('maid');
  const [rScheduleType, setRScheduleType] = useState('daily');
  const [rDays, setRDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [rTimeFrom, setRTimeFrom] = useState('06:00');
  const [rTimeUntil, setRTimeUntil] = useState('09:00');

  const fetchPasses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPasses();
      const data = res.data.data;
      setPasses(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPasses(); }, [fetchPasses]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      const now = new Date();
      const hours = DURATION_OPTIONS[selectedDuration].hours || 24;
      const until = new Date(now.getTime() + hours * 3600000);
      await api.createPass({
        visitor_name: name.trim(),
        visitor_vehicle: byCab ? undefined : vehicle.trim() || undefined,
        valid_from: now.toISOString(),
        valid_until: until.toISOString(),
      });
      setName('');
      setVehicle('');
      setByCab(false);
      setSelectedDuration(0);
      setShowForm(false);
      fetchPasses();
    } catch (err: any) {
      // Alert handled by global error handler if needed
    }
  };

  const handleRevoke = async (id: string) => {
    await api.revokePass(id);
    fetchPasses();
  };

  const fetchRecurring = useCallback(async () => {
    try {
      const res = await recurringApi.getRecurringPasses();
      const data = res.data.data;
      setRecurringPasses(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => { fetchRecurring(); }, [fetchRecurring]);

  const handleCreateRecurring = async () => {
    if (!rName.trim()) return;
    try {
      await recurringApi.createRecurringPass({
        visitor_name: rName.trim(),
        visitor_role: rRole,
        schedule_type: rScheduleType,
        schedule_days: rScheduleType === 'daily' ? undefined : rDays,
        time_from: rTimeFrom,
        time_until: rTimeUntil,
      });
      setRName('');
      setShowRecurringForm(false);
      fetchRecurring();
    } catch {}
  };

  const handlePause = async (id: string) => {
    await recurringApi.updateRecurringPass(id, { status: 'paused' });
    fetchRecurring();
  };

  const handleResume = async (id: string) => {
    await recurringApi.updateRecurringPass(id, { status: 'active' });
    fetchRecurring();
  };

  const handleCancelRecurring = async (id: string) => {
    await recurringApi.cancelRecurringPass(id);
    fetchRecurring();
  };

  const toggleDay = (day: number) => {
    setRDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort());
  };

  const activePasses = passes.filter((p) => p.status === 'active');
  const otherPasses = passes.filter((p) => p.status !== 'active');

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Quick Share Bar */}
      <TouchableOpacity onPress={() => setShowForm(true)} activeOpacity={0.8} style={styles.shareBarWrap}>
        <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.shareBar}>
          <MaterialCommunityIcons name="share-variant" size={20} color={colors.white} />
          <Text style={styles.shareBarText}>Share Visitor Pass</Text>
        </LinearGradient>
      </TouchableOpacity>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {/* Recurring Visitors Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recurring Visitors ({recurringPasses.length})</Text>
        </View>

        {recurringPasses.map((pass) => (
          <RecurringPassCard
            key={pass.id}
            pass={pass}
            onPause={handlePause}
            onResume={handleResume}
            onCancel={handleCancelRecurring}
          />
        ))}

        <TouchableOpacity onPress={() => setShowRecurringForm(true)} style={styles.addButton}>
          <MaterialCommunityIcons name="plus-circle" size={20} color={colors.info} />
          <Text style={styles.addButtonText}>Add Recurring Visitor</Text>
        </TouchableOpacity>

        {/* Visitor Passes Section */}
        <View style={[styles.sectionHeader, { marginTop: spacing.xl }]}>
          <Text style={styles.sectionTitle}>Visitor Passes ({passes.length})</Text>
        </View>

        {passes.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No visitor passes</Text>
          </View>
        ) : (
          [...activePasses, ...otherPasses].map((item, index) => (
            <AnimatedEntry key={item.id} direction="left" delay={index * 80}>
              <VisitorPassCard
                pass={item}
                residentName={user?.name || 'Resident'}
                unitNumber={user?.unitNumber ? `Unit ${user.unitNumber}` : ''}
                communityName={user?.communityName}
                onRevoke={handleRevoke}
              />
            </AnimatedEntry>
          ))
        )}
      </ScrollView>

      {/* Create Pass Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Visitor Pass</Text>
            <TextInput
              style={styles.input}
              placeholder="Visitor name"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />
            {!byCab && (
              <TextInput
                style={styles.input}
                placeholder="Vehicle number (optional)"
                placeholderTextColor={colors.textMuted}
                value={vehicle}
                onChangeText={setVehicle}
                autoCapitalize="characters"
              />
            )}
            <View style={styles.cabRow}>
              <Text style={styles.cabLabel}>Coming by cab</Text>
              <Switch
                value={byCab}
                onValueChange={setByCab}
                trackColor={{ false: colors.surface, true: colors.successBg }}
                thumbColor={byCab ? colors.success : colors.textMuted}
              />
            </View>

            <Text style={styles.durationLabel}>TIME WINDOW</Text>
            <View style={styles.durationChips}>
              {DURATION_OPTIONS.map((opt, i) => (
                <TouchableOpacity key={i} onPress={() => setSelectedDuration(i)}>
                  {selectedDuration === i ? (
                    <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.durationChip}>
                      <Text style={styles.durationChipTextActive}>{opt.label}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.durationChipInactive}>
                      <Text style={styles.durationChipText}>{opt.label}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={() => setShowForm(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Create" variant="success" icon="ticket-account" onPress={handleCreate} disabled={!name.trim()} />
              </View>
            </View>
          </GlowCard>
        </View>
      </Modal>

      {/* Recurring Visitor Form Modal */}
      <Modal visible={showRecurringForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Recurring Visitor</Text>
            <TextInput
              style={styles.input}
              placeholder="Visitor name"
              placeholderTextColor={colors.textMuted}
              value={rName}
              onChangeText={setRName}
            />

            <Text style={styles.durationLabel}>ROLE</Text>
            <View style={styles.durationChips}>
              {['maid', 'cook', 'driver', 'tutor', 'newspaper', 'other'].map((role) => (
                <TouchableOpacity key={role} onPress={() => setRRole(role)}>
                  {rRole === role ? (
                    <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.durationChip}>
                      <Text style={styles.durationChipTextActive}>{role}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.durationChipInactive}>
                      <Text style={styles.durationChipText}>{role}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.durationLabel}>SCHEDULE</Text>
            <View style={styles.durationChips}>
              {['daily', 'weekday', 'weekly', 'custom'].map((type) => (
                <TouchableOpacity key={type} onPress={() => setRScheduleType(type)}>
                  {rScheduleType === type ? (
                    <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.durationChip}>
                      <Text style={styles.durationChipTextActive}>{type}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.durationChipInactive}>
                      <Text style={styles.durationChipText}>{type}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {(rScheduleType === 'weekly' || rScheduleType === 'custom') && (
              <>
                <Text style={styles.durationLabel}>DAYS</Text>
                <View style={styles.durationChips}>
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, i) => (
                    <TouchableOpacity key={i} onPress={() => toggleDay(i)}>
                      {rDays.includes(i) ? (
                        <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.dayChip}>
                          <Text style={styles.durationChipTextActive}>{label}</Text>
                        </LinearGradient>
                      ) : (
                        <View style={styles.dayChipInactive}>
                          <Text style={styles.durationChipText}>{label}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.durationLabel}>TIME WINDOW</Text>
            <View style={styles.timeRow}>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={rTimeFrom}
                onChangeText={setRTimeFrom}
                placeholder="06:00"
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.timeSep}>to</Text>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={rTimeUntil}
                onChangeText={setRTimeUntil}
                placeholder="09:00"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={() => setShowRecurringForm(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Save" variant="success" icon="check" onPress={handleCreateRecurring} disabled={!rName.trim()} />
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
  shareBarWrap: { marginHorizontal: spacing.lg, marginTop: spacing.md },
  shareBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.lg,
  },
  shareBarText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  list: { padding: spacing.lg, paddingBottom: 100 },
  emptyState: { alignItems: 'center', gap: spacing.sm, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: colors.textMuted, fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md,
  },
  cabRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  cabLabel: { color: colors.textPrimary, fontSize: 14 },
  durationLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm },
  durationChips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  durationChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  durationChipInactive: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
  },
  durationChipText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  durationChipTextActive: { color: colors.white, fontSize: 14, fontWeight: '600' },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
  sectionHeader: { marginBottom: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  addButtonText: { fontSize: 14, color: colors.info, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  timeInput: { flex: 1, textAlign: 'center', marginBottom: 0 },
  timeSep: { color: colors.textMuted, fontSize: 14 },
  dayChip: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayChipInactive: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
});
