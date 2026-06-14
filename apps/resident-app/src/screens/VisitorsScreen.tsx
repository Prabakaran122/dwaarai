import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import AppBar from '../components/ui/AppBar';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import SectionHeader from '../components/ui/SectionHeader';
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

export default function VisitorsScreen({ onClose }: { onClose?: () => void } = {}) {
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
    setRDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  };

  const activePasses = passes.filter((p) => p.status === 'active');
  const otherPasses = passes.filter((p) => p.status !== 'active');

  return (
    <View style={styles.container}>
      <AppBar title="Visitors" onBack={onClose} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {/* Visitor Passes Section */}
        <SectionHeader
          title={`Visitor passes (${passes.length})`}
          actionLabel="+ Invite"
          onAction={() => setShowForm(true)}
        />

        {passes.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>No visitor passes</Text>
            <Text style={[type.bodySecondary, { textAlign: 'center' }]}>
              Tap &quot;Invite&quot; above to create a one-time visitor pass.
            </Text>
          </Card>
        ) : (
          [...activePasses, ...otherPasses].map((item) => (
            <VisitorPassCard
              key={item.id}
              pass={item}
              residentName={user?.name || 'Resident'}
              unitNumber={user?.unitNumber ? `Unit ${user.unitNumber}` : ''}
              communityName={user?.communityName}
              onRevoke={handleRevoke}
            />
          ))
        )}

        {/* Recurring Passes Section */}
        <View style={styles.sectionSpacer} />
        <SectionHeader
          title={`Pre-approved (recurring) (${recurringPasses.length})`}
          actionLabel="+ Add"
          onAction={() => setShowRecurringForm(true)}
        />

        {recurringPasses.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>No recurring passes</Text>
            <Text style={[type.bodySecondary, { textAlign: 'center' }]}>
              Tap &quot;Add&quot; above to pre-approve a recurring visitor.
            </Text>
          </Card>
        ) : (
          recurringPasses.map((pass) => (
            <RecurringPassCard
              key={pass.id}
              pass={pass}
              onPause={handlePause}
              onResume={handleResume}
              onCancel={handleCancelRecurring}
            />
          ))
        )}
      </ScrollView>

      {/* Create One-Time Pass Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Visitor Pass</Text>

            <Input
              placeholder="Visitor name"
              value={name}
              onChangeText={setName}
              style={styles.inputSpacing}
            />

            {!byCab && (
              <Input
                placeholder="Vehicle number (optional)"
                value={vehicle}
                onChangeText={setVehicle}
                autoCapitalize="characters"
                style={styles.inputSpacing}
              />
            )}

            <View style={styles.cabRow}>
              <Text style={type.body}>Coming by cab</Text>
              <Switch
                value={byCab}
                onValueChange={setByCab}
                trackColor={{ false: colors.surfaceBorder, true: colors.teal }}
                thumbColor={byCab ? colors.brandPrimary : colors.textTertiary}
              />
            </View>

            <Text style={styles.fieldLabel}>TIME WINDOW</Text>
            <View style={styles.chips}>
              {DURATION_OPTIONS.map((opt, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => setSelectedDuration(i)}
                  style={[
                    styles.chip,
                    selectedDuration === i ? styles.chipActive : styles.chipInactive,
                  ]}
                >
                  <Text
                    style={selectedDuration === i ? styles.chipTextActive : styles.chipText}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => setShowForm(false)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Create"
                  variant="primary"
                  icon="ticket-account"
                  onPress={handleCreate}
                  disabled={!name.trim()}
                />
              </View>
            </View>
          </Card>
        </View>
      </Modal>

      {/* Add Recurring Visitor Modal */}
      <Modal visible={showRecurringForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Recurring Visitor</Text>

            <Input
              placeholder="Visitor name"
              value={rName}
              onChangeText={setRName}
              style={styles.inputSpacing}
            />

            <Text style={styles.fieldLabel}>ROLE</Text>
            <View style={styles.chips}>
              {['maid', 'cook', 'driver', 'tutor', 'newspaper', 'other'].map((role) => (
                <TouchableOpacity
                  key={role}
                  onPress={() => setRRole(role)}
                  style={[
                    styles.chip,
                    rRole === role ? styles.chipActive : styles.chipInactive,
                  ]}
                >
                  <Text style={rRole === role ? styles.chipTextActive : styles.chipText}>
                    {role}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>SCHEDULE</Text>
            <View style={styles.chips}>
              {['daily', 'weekday', 'weekly', 'custom'].map((schedType) => (
                <TouchableOpacity
                  key={schedType}
                  onPress={() => setRScheduleType(schedType)}
                  style={[
                    styles.chip,
                    rScheduleType === schedType ? styles.chipActive : styles.chipInactive,
                  ]}
                >
                  <Text
                    style={
                      rScheduleType === schedType ? styles.chipTextActive : styles.chipText
                    }
                  >
                    {schedType}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {(rScheduleType === 'weekly' || rScheduleType === 'custom') && (
              <>
                <Text style={styles.fieldLabel}>DAYS</Text>
                <View style={styles.chips}>
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, i) => (
                    <TouchableOpacity
                      key={i}
                      onPress={() => toggleDay(i)}
                      style={[
                        styles.dayChip,
                        rDays.includes(i) ? styles.dayChipActive : styles.dayChipInactive,
                      ]}
                    >
                      <Text
                        style={
                          rDays.includes(i) ? styles.chipTextActive : styles.chipText
                        }
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.fieldLabel}>TIME WINDOW</Text>
            <View style={styles.timeRow}>
              <Input
                value={rTimeFrom}
                onChangeText={setRTimeFrom}
                placeholder="06:00"
                style={styles.timeInput}
              />
              <Text style={[type.body, styles.timeSep]}>to</Text>
              <Input
                value={rTimeUntil}
                onChangeText={setRTimeUntil}
                placeholder="09:00"
                style={styles.timeInput}
              />
            </View>

            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => setShowRecurringForm(false)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Save"
                  variant="primary"
                  icon="check"
                  onPress={handleCreateRecurring}
                  disabled={!rName.trim()}
                />
              </View>
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  list: { padding: spacing.lg, paddingBottom: 100 },
  sectionSpacer: { height: spacing.xl },

  // Empty state
  emptyCard: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  emptyText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: { width: '88%', maxWidth: 380 },
  modalTitle: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  inputSpacing: { marginBottom: spacing.sm },

  // Cab toggle row
  cabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.md,
  },

  // Field label (caps)
  fieldLabel: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },

  // Chip row
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  chipActive: { backgroundColor: colors.teal },
  chipInactive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  chipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
  },
  chipTextActive: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.white,
  },

  // Day chips (round)
  dayChip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipActive: { backgroundColor: colors.brandPrimary },
  dayChipInactive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },

  // Time row
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  timeInput: { flex: 1, textAlign: 'center' },
  timeSep: { color: colors.textSecondary },

  // Modal action buttons
  modalButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
