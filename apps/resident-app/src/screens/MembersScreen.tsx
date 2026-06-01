import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, Modal, TouchableOpacity, Switch } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useMemberStore, Member } from '../store/memberStore';

const RELATIONSHIPS = ['spouse', 'child', 'parent', 'sibling', 'other'] as const;
type Relationship = (typeof RELATIONSHIPS)[number];

const relationshipIcons: Record<string, string> = {
  spouse: 'heart',
  child: 'baby-face-outline',
  parent: 'account-supervisor',
  sibling: 'account-multiple',
  other: 'account',
};

export default function MembersScreen({ onClose }: { onClose: () => void }) {
  const { members, loading, fetch, add, update, remove } = useMemberStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('spouse');
  const [notify, setNotify] = useState(true);

  useEffect(() => { fetch(); }, []);

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
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Household</Text>
        <View style={{ width: 28 }} />
      </View>

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
        renderItem={({ item, index }) => (
          <AnimatedEntry direction="left" delay={index * 80}>
            <GlowCard style={styles.memberCard}>
              <TouchableOpacity
                onPress={() => openEdit(item)}
                onLongPress={() => handleRemove(item)}
                activeOpacity={0.7}
              >
                <View style={styles.memberRow}>
                  <IconBadge
                    icon={(relationshipIcons[item.relationship || 'other'] || 'account') as any}
                    color={colors.info}
                    gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']}
                    size={40}
                  />
                  <View style={styles.memberInfo}>
                    <View style={styles.nameRow}>
                      <Text style={styles.memberName}>{item.name}</Text>
                      {item.isSelf ? <Text style={styles.youTag}>You</Text> : null}
                    </View>
                    <Text style={styles.memberDetail}>
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
                        color={item.notifyOnApproval ? colors.success : colors.textMuted}
                      />
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            </GlowCard>
          </AnimatedEntry>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="account-group" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No household members yet</Text>
            <Text style={styles.emptySubtext}>Tap + to add a family member</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fabWrap} onPress={openAdd} activeOpacity={0.8}>
        <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.fab}>
          <MaterialCommunityIcons name="account-plus" size={26} color={colors.white} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Modal Form */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Member' : 'Add Member'}</Text>

            <TextInput
              style={styles.input}
              placeholder="Full name"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />

            {editing ? (
              <View style={styles.lockedField}>
                <MaterialCommunityIcons name="phone-lock" size={16} color={colors.textMuted} />
                <Text style={styles.lockedText}>{mobile}</Text>
              </View>
            ) : (
              <TextInput
                style={styles.input}
                placeholder="Mobile number"
                placeholderTextColor={colors.textMuted}
                value={mobile}
                onChangeText={setMobile}
                keyboardType="phone-pad"
                maxLength={15}
              />
            )}

            <Text style={styles.fieldLabel}>Relationship</Text>
            <View style={styles.chips}>
              {RELATIONSHIPS.map((r) => (
                <TouchableOpacity key={r} onPress={() => setRelationship(r)}>
                  {relationship === r ? (
                    <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.chip}>
                      <Text style={styles.chipTextActive}>{r}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.chipInactive}>
                      <Text style={styles.chipText}>{r}</Text>
                    </View>
                  )}
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: spacing['3xl'], paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  backBtn: { width: 28, alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  list: { padding: spacing.lg, paddingBottom: 100 },
  intro: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.lg },
  memberCard: { marginBottom: spacing.md },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  memberInfo: { flex: 1, gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memberName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  youTag: { fontSize: 10, fontWeight: '700', color: colors.info, backgroundColor: 'rgba(99,102,241,0.15)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
  memberDetail: { color: colors.textMuted, fontSize: 13, textTransform: 'capitalize' },
  memberMeta: { alignItems: 'flex-end' },
  primaryPill: { backgroundColor: 'rgba(16,185,129,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  primaryPillText: { fontSize: 10, fontWeight: '700', color: colors.success },
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
  lockedField: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, marginBottom: spacing.md,
  },
  lockedText: { fontSize: 16, color: colors.textMuted },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  chipInactive: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  chipText: { color: colors.textMuted, fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: colors.white, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  notifyTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  notifySub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
});
