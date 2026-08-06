import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert, Modal, TouchableOpacity, Switch } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type as textType } from '../theme/typography';
import { AppBar, Avatar, Button, Card, Input } from '../components/ui';
import { useMemberStore, Member } from '../store/memberStore';
import { createRecurringPass } from '../api/client';

const RELATIONSHIPS = ['spouse', 'child', 'parent', 'sibling', 'other'] as const;
type Relationship = (typeof RELATIONSHIPS)[number];

const relationshipIcons: Record<string, string> = {
  spouse: 'heart',
  child: 'baby-face-outline',
  parent: 'account-supervisor',
  sibling: 'account-multiple',
  other: 'account',
};

// House help / staff (BRD 4.4) are not a new concept — they are recurring
// passes (see `RecurringPassCard` / VisitorsScreen's full flow). This is a
// lightweight entry point into the same mechanism, scoped to the common
// helper roles, so a resident doesn't have to leave My Household to add one.
const HELPER_ROLES = ['maid', 'cook', 'driver', 'other'] as const;
type HelperRole = (typeof HELPER_ROLES)[number];

export default function MembersScreen({ onClose }: { onClose: () => void }) {
  const { members, loading, fetch, add, update, remove } = useMemberStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('spouse');
  const [notify, setNotify] = useState(true);

  const [showHelperForm, setShowHelperForm] = useState(false);
  const [helperName, setHelperName] = useState('');
  const [helperRole, setHelperRole] = useState<HelperRole>('maid');
  const [helperSaving, setHelperSaving] = useState(false);

  useEffect(() => { fetch(); }, []);

  const resetHelperForm = () => {
    setHelperName(''); setHelperRole('maid'); setShowHelperForm(false);
  };

  const openHelperForm = () => { resetHelperForm(); setShowHelperForm(true); };

  const handleSaveHelper = async () => {
    if (!helperName.trim()) { Alert.alert('Error', 'Name is required'); return; }
    setHelperSaving(true);
    try {
      await createRecurringPass({
        visitor_name: helperName.trim(),
        visitor_role: helperRole,
        schedule_type: 'daily',
        time_from: '06:00',
        time_until: '10:00',
      });
      resetHelperForm();
    } catch (err: any) {
      Alert.alert('Could not save', err?.response?.data?.error?.message || 'Please try again.');
    } finally {
      setHelperSaving(false);
    }
  };

  const resetForm = () => {
    setName(''); setMobile(''); setRelationship('spouse'); setNotify(true);
    setEditing(null); setShowForm(false);
  };

  const openAdd = () => { resetForm(); setShowForm(true); };

  const openEdit = (m: Member) => {
    setEditing(m);
    setName(m.name);
    setMobile(m.mobile);
    setRelationship((m.relationship as Relationship) || 'other');
    setNotify(m.notifyOnApproval);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Name is required'); return; }
    try {
      if (editing) {
        await update(editing.id, { name: name.trim(), relationship, notify_on_approval: notify });
      } else {
        if (!mobile.trim()) { Alert.alert('Error', 'Mobile number is required'); return; }
        await add({ name: name.trim(), mobile: mobile.trim(), relationship });
      }
      resetForm();
    } catch (err: any) {
      Alert.alert('Could not save', err?.response?.data?.error?.message || 'Please try again.');
    }
  };

  const handleRemove = (m: Member) => {
    if (m.isPrimary) {
      Alert.alert('Primary resident', 'The primary resident cannot be removed.');
      return;
    }
    Alert.alert('Remove member', `Remove ${m.name} from your household?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try { await remove(m.id); }
          catch (err: any) { Alert.alert('Could not remove', err?.response?.data?.error?.message || 'Please try again.'); }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <AppBar title="Members" onBack={onClose} />

      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        refreshing={loading}
        onRefresh={fetch}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.intro}>
            Everyone in your household can approve visitors, see gate activity and manage passes.
          </Text>
        }
        renderItem={({ item }) => (
          <Card style={styles.memberCard}>
            <TouchableOpacity
              onPress={() => openEdit(item)}
              onLongPress={() => handleRemove(item)}
              activeOpacity={0.7}
            >
              <View style={styles.memberRow}>
                <Avatar name={item.name} size="md" />
                <View style={styles.memberInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.memberName}>{item.name}</Text>
                    {item.isSelf ? (
                      <View style={styles.youTag}>
                        <Text style={styles.youTagText}>You</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={textType.micro}>
                    {item.relationship ? `${item.relationship} · ` : ''}{item.mobile}
                  </Text>
                </View>
                <View style={styles.memberMeta}>
                  {item.isPrimary ? (
                    <View style={styles.primaryPill}>
                      <Text style={styles.primaryPillText}>Primary</Text>
                    </View>
                  ) : (
                    <MaterialCommunityIcons
                      name={item.notifyOnApproval ? 'bell' : 'bell-off'}
                      size={16}
                      color={item.notifyOnApproval ? colors.success : colors.textTertiary}
                    />
                  )}
                </View>
              </View>
            </TouchableOpacity>
          </Card>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="account-group" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No household members yet</Text>
            <Text style={styles.emptySubtext}>Tap + to add a family member</Text>
          </View>
        }
        ListFooterComponent={
          <TouchableOpacity style={styles.ghostRow} onPress={openHelperForm} activeOpacity={0.7}>
            <View style={styles.ghostIcon}>
              <MaterialCommunityIcons name="broom" size={18} color={colors.textTertiary} />
            </View>
            <Text style={styles.ghostText}>Add house help / staff</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fabWrap} onPress={openAdd} activeOpacity={0.8}>
        <View style={styles.fab}>
          <MaterialCommunityIcons name="account-plus" size={26} color={colors.textInverse} />
        </View>
      </TouchableOpacity>

      {/* Modal Form */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Member' : 'Add Member'}</Text>

            <Input
              placeholder="Full name"
              value={name}
              onChangeText={setName}
              style={styles.inputSpaced}
            />

            {editing ? (
              <View style={styles.lockedField}>
                <MaterialCommunityIcons name="phone-lock" size={16} color={colors.textTertiary} />
                <Text style={styles.lockedText}>{mobile}</Text>
              </View>
            ) : (
              <Input
                placeholder="Mobile number"
                value={mobile}
                onChangeText={setMobile}
                keyboardType="phone-pad"
                maxLength={15}
                style={styles.inputSpaced}
              />
            )}

            <Text style={styles.fieldLabel}>Relationship</Text>
            <View style={styles.chips}>
              {RELATIONSHIPS.map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setRelationship(r)}
                  style={relationship === r ? styles.chipActive : styles.chipInactive}
                >
                  <Text style={relationship === r ? styles.chipTextActive : styles.chipText}>
                    {r}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {editing && !editing.isPrimary ? (
              <View style={styles.notifyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.notifyTitle}>Notify for gate approvals</Text>
                  <Text style={styles.notifySub}>Receive a push when a visitor is at the gate</Text>
                </View>
                <Switch
                  value={notify}
                  onValueChange={setNotify}
                  trackColor={{ false: colors.surfaceBorder, true: colors.success }}
                />
              </View>
            ) : null}

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

      {/* Helper (house help / staff) form — creates a recurring pass */}
      <Modal visible={showHelperForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add house help / staff</Text>
            <Text style={styles.helperHint}>
              They get a recurring gate pass for the hours you set — no need to approve them each day.
            </Text>

            <Input
              placeholder="Name"
              value={helperName}
              onChangeText={setHelperName}
              style={styles.inputSpaced}
            />

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.chips}>
              {HELPER_ROLES.map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setHelperRole(r)}
                  style={helperRole === r ? styles.chipActive : styles.chipInactive}
                >
                  <Text style={helperRole === r ? styles.chipTextActive : styles.chipText}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="destructive" onPress={resetHelperForm} />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={{ flex: 1 }}>
                <Button title="Save" variant="primary" icon="check-circle" onPress={handleSaveHelper} disabled={helperSaving} />
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
  intro: { ...textType.bodySecondary, lineHeight: 19, marginBottom: spacing.lg } as any,
  memberCard: { marginBottom: spacing.md },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  memberInfo: { flex: 1, gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memberName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  youTag: { backgroundColor: colors.tintInfo, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
  youTagText: { fontSize: 10, fontWeight: '700', color: colors.textInfo },
  memberMeta: { alignItems: 'flex-end' },
  primaryPill: { backgroundColor: colors.tintSuccess, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  primaryPillText: { fontSize: 10, fontWeight: '700', color: colors.textSuccess },
  emptyState: { alignItems: 'center', gap: spacing.sm, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: colors.textTertiary, fontSize: 13 },
  ghostRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.surfaceBorder,
    borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xs,
  },
  ghostIcon: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center',
  },
  ghostText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  helperHint: { ...textType.bodySecondary, lineHeight: 18, marginBottom: spacing.lg } as any,
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  inputSpaced: { marginBottom: spacing.md },
  lockedField: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.mist, borderRadius: radius.md, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, marginBottom: spacing.md,
  },
  lockedText: { fontSize: 16, color: colors.textTertiary },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chipActive: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  chipInactive: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  chipText: { color: colors.textTertiary, fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: colors.textInverse, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  notifyTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  notifySub: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  modalButtons: { flexDirection: 'row' },
});
