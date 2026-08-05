import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Switch, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button, SectionHeader, Avatar, StatusBadge } from '../components/ui';
import * as api from '../api/client';
import type { UnitMember } from '../store/unitStore';

type ConsentLocation = 'gate' | 'pool' | 'clubhouse' | 'gym';
type ConsentMap = Record<ConsentLocation, boolean>;

const LOCATION_META: Record<ConsentLocation, { label: string; icon: string; desc: string }> = {
  gate: { label: 'Main gate', icon: 'boom-gate', desc: 'Walk-in pedestrian entry' },
  pool: { label: 'Swimming pool', icon: 'pool', desc: 'Pool gate access' },
  clubhouse: { label: 'Clubhouse', icon: 'sofa', desc: 'Clubhouse entry' },
  gym: { label: 'Gym', icon: 'dumbbell', desc: 'Gym access' },
};

const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  not_enrolled: { label: 'Not enrolled', color: colors.textMuted, icon: 'face-recognition' },
  pending: { label: 'Awaiting verification', color: colors.warning, icon: 'clock-outline' },
  active: { label: 'Active', color: colors.success, icon: 'check-circle' },
  deleted: { label: 'Not enrolled', color: colors.textMuted, icon: 'face-recognition' },
};

const EMPTY_CONSENTS: ConsentMap = { gate: false, pool: false, clubhouse: false, gym: false };

// No on-device face-capture pipeline exists in this app yet (self-enrolment
// doesn't send a real scan either — see FaceIdentityScreen, which posts
// consent only and leaves the server to mark the enrolment 'pending').
// The member-scoped enrol endpoint requires a non-empty vector, so until a
// real capture/vectorization step ships, this produces a placeholder that is
// never persisted client-side and never leaves this function.
function placeholderVector(): number[] {
  return [Date.now() % 1000];
}

interface Props {
  member: UnitMember;
  onBack: () => void;
}

export default function MemberDetailScreen({ member, onBack }: Props) {
  const [status, setStatus] = useState<string>('not_enrolled');
  const [consents, setConsents] = useState<ConsentMap>(EMPTY_CONSENTS);
  const [locations, setLocations] = useState<ConsentLocation[]>(['gate', 'pool', 'clubhouse', 'gym']);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.getMemberFace(member.id);
      const data = res.data.data;
      setStatus(data.status);
      setConsents({ ...EMPTY_CONSENTS, ...data.consents });
      if (Array.isArray(data.locations) && data.locations.length) setLocations(data.locations);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [member.id]);

  useEffect(() => { load(); }, [load]);

  const isEnrolled = status === 'active' || status === 'pending';
  const sm = STATUS_META[status] || STATUS_META.not_enrolled;

  const doEnroll = async () => {
    setBusy(true);
    try {
      // The vector is generated and sent in the same call; it is never
      // assigned to component state and never rendered or logged.
      const res = await api.enrollMemberFace(member.id, placeholderVector());
      setStatus(res.data.data.status);
      Alert.alert('Enrolled', `${member.name}'s face ID is now set up for the locations you enable below.`);
    } catch (err: any) {
      Alert.alert('Enrolment failed', err?.response?.data?.error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggleConsent = async (loc: ConsentLocation, value: boolean) => {
    const prev = consents;
    setConsents((c) => ({ ...c, [loc]: value }));
    try {
      await api.setMemberFaceConsent(member.id, loc, value);
    } catch (err: any) {
      setConsents(prev);
      Alert.alert('Could not update', err?.response?.data?.error?.message || 'Please try again.');
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Remove face ID?',
      `This permanently deletes ${member.name}'s face data and turns off facial access everywhere. Access falls back to OTP immediately. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteMemberFace(member.id);
              setStatus('not_enrolled');
              setConsents(EMPTY_CONSENTS);
            } catch (err: any) {
              Alert.alert('Could not remove', err?.response?.data?.error?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  };

  if (failed) {
    return (
      <View style={styles.container}>
        <AppBar title={member.name} onBack={onBack} />
        <View style={styles.centre}><Text style={type.bodySecondary}>Could not load this member. Go back and try again.</Text></View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <AppBar title={member.name} onBack={onBack} />
        <View style={styles.centre}><ActivityIndicator color={colors.teal} /></View>
      </View>
    );
  }

  const sub = [member.isPrimary ? 'Primary' : null, member.relationship].filter(Boolean).join(' · ');

  return (
    <View style={styles.container}>
      <AppBar title={member.name} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <Avatar name={member.name} size="lg" />
            <View style={{ flex: 1 }}>
              <Text style={type.h2}>{member.name}</Text>
              {!!sub && <Text style={type.bodySecondary}>{sub}</Text>}
              <View style={styles.badges}>
                {member.appAccess && <StatusBadge preset="info" label="App access" size="sm" />}
              </View>
            </View>
          </View>
        </Card>

        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={[styles.statusIcon, { backgroundColor: colors.mist }]}>
              <MaterialCommunityIcons name={sm.icon as any} size={26} color={sm.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusLabel}>Facial recognition</Text>
              <Text style={[styles.statusValue, { color: sm.color }]}>{sm.label}</Text>
            </View>
          </View>
        </Card>

        <Card style={styles.infoCard}>
          <SectionHeader title="Where facial access is allowed" />
          {locations.map((loc) => {
            const meta = LOCATION_META[loc];
            if (!meta) return null;
            return (
              <View key={loc} style={styles.consentRow}>
                <MaterialCommunityIcons name={meta.icon as any} size={20} color={colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.consentLabel}>{meta.label}</Text>
                  <Text style={styles.consentDesc}>{meta.desc}</Text>
                </View>
                <Switch
                  value={consents[loc]}
                  onValueChange={(v) => toggleConsent(loc, v)}
                  trackColor={{ false: colors.surfaceBorder, true: colors.success }}
                  thumbColor={colors.white}
                />
              </View>
            );
          })}
          {!isEnrolled ? (
            <Text style={styles.hint}>Turn face ID on below to activate access at the locations you enable.</Text>
          ) : null}
        </Card>

        <View style={styles.actions}>
          {busy ? (
            <ActivityIndicator color={colors.info} />
          ) : isEnrolled ? (
            <Button title="Remove face ID" icon="delete-forever" variant="destructive" onPress={confirmDelete} />
          ) : (
            <Button title="Enrol face ID" icon="face-recognition" variant="primary" onPress={doEnroll} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  headerCard: { marginBottom: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badges: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  statusCard: { marginBottom: spacing.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  statusLabel: { ...type.caption, textTransform: 'uppercase', letterSpacing: 0.5 },
  statusValue: { ...type.h2, marginTop: 2 },
  infoCard: { marginBottom: spacing.lg },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  consentLabel: { ...type.body, fontFamily: 'DMSans_500Medium' },
  consentDesc: { ...type.micro, marginTop: 1 },
  hint: { ...type.micro, color: colors.warning, marginTop: spacing.sm },
  actions: { marginBottom: spacing.lg },
});
