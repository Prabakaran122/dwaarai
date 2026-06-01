import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { useAuthStore } from '../store/authStore';
import { useMemberStore } from '../store/memberStore';
import { useFaceStore } from '../store/faceStore';
import MembersScreen from './MembersScreen';
import FaceIdentityScreen from './FaceIdentityScreen';

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const members = useMemberStore((s) => s.members);
  const fetchMembers = useMemberStore((s) => s.fetch);
  const faceStatus = useFaceStore((s) => s.status);
  const fetchFace = useFaceStore((s) => s.fetch);
  const [showMembers, setShowMembers] = useState(false);
  const [showFace, setShowFace] = useState(false);

  useEffect(() => { fetchMembers().catch(() => {}); fetchFace().catch(() => {}); }, []);

  const memberCount = members.length;
  const needsSetup = memberCount <= 1;
  const faceLabel = faceStatus === 'active' ? 'Active' : faceStatus === 'pending' ? 'Awaiting verification' : 'Not set up';

  if (showMembers) {
    return <MembersScreen onClose={() => { setShowMembers(false); fetchMembers().catch(() => {}); }} />;
  }
  if (showFace) {
    return <FaceIdentityScreen onClose={() => { setShowFace(false); fetchFace().catch(() => {}); }} />;
  }

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Unit Info Card */}
        <AnimatedEntry direction="fade">
          <GlowCard style={styles.unitCard}>
            <View style={styles.unitHeader}>
              <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(user?.name || 'R').charAt(0).toUpperCase()}
                </Text>
              </LinearGradient>
              <View style={styles.unitInfo}>
                <Text style={styles.unitName}>{user?.name || 'Resident'}</Text>
                <Text style={styles.unitDetail}>Unit {user?.unitNumber || '-'}</Text>
                {user?.communityName ? (
                  <Text style={styles.communityName}>{user.communityName}</Text>
                ) : null}
              </View>
            </View>
          </GlowCard>
        </AnimatedEntry>

        {/* Contact Details */}
        <AnimatedEntry direction="up" delay={100}>
          <GlowCard style={styles.detailsCard}>
            <Text style={styles.sectionTitle}>Contact Details</Text>
            <View style={styles.detailRow}>
              <MaterialCommunityIcons name="phone" size={18} color={colors.textMuted} />
              <Text style={styles.detailText}>{user?.phone || '-'}</Text>
            </View>
          </GlowCard>
        </AnimatedEntry>

        {/* Household / Family Members */}
        <AnimatedEntry direction="up" delay={150}>
          <GlowCard style={styles.detailsCard}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => setShowMembers(true)}>
              <View style={styles.householdHeader}>
                <Text style={styles.sectionTitle}>Household</Text>
                <View style={styles.manageRow}>
                  <Text style={styles.manageText}>Manage</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
                </View>
              </View>
              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="account-group" size={18} color={colors.textMuted} />
                <Text style={styles.detailText}>
                  {memberCount > 0
                    ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`
                    : 'No members added yet'}
                </Text>
              </View>
              {needsSetup ? (
                <View style={styles.nudge}>
                  <MaterialCommunityIcons name="information-outline" size={15} color={colors.info} />
                  <Text style={styles.nudgeText}>
                    Add your family members so they're recognised at the gate.
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </GlowCard>
        </AnimatedEntry>

        {/* Face & Identity */}
        <AnimatedEntry direction="up" delay={175}>
          <GlowCard style={styles.detailsCard}>
            <TouchableOpacity activeOpacity={0.7} onPress={() => setShowFace(true)}>
              <View style={styles.householdHeader}>
                <Text style={styles.sectionTitle}>Face &amp; Identity</Text>
                <View style={styles.manageRow}>
                  <Text style={styles.manageText}>Manage</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
                </View>
              </View>
              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="face-recognition" size={18} color={colors.textMuted} />
                <Text style={styles.detailText}>Facial access · {faceLabel}</Text>
              </View>
            </TouchableOpacity>
          </GlowCard>
        </AnimatedEntry>

        {/* App Info */}
        <AnimatedEntry direction="up" delay={200}>
          <GlowCard style={styles.detailsCard}>
            <Text style={styles.sectionTitle}>About</Text>
            <View style={styles.detailRow}>
              <MaterialCommunityIcons name="information" size={18} color={colors.textMuted} />
              <Text style={styles.detailText}>CommunityGate Resident App v1.0</Text>
            </View>
          </GlowCard>
        </AnimatedEntry>

        {/* Logout */}
        <AnimatedEntry direction="up" delay={300}>
          <View style={styles.logoutSection}>
            <GradientButton title="Logout" icon="logout" variant="danger" onPress={logout} />
          </View>
        </AnimatedEntry>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  unitCard: { marginBottom: spacing.lg },
  unitHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24, fontWeight: '800', color: colors.white },
  unitInfo: { flex: 1 },
  unitName: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  unitDetail: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  communityName: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  detailsCard: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailText: { fontSize: 14, color: colors.textMuted },
  householdHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  manageRow: { flexDirection: 'row', alignItems: 'center' },
  manageText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, backgroundColor: 'rgba(99,102,241,0.10)', borderRadius: radius.sm, padding: spacing.sm },
  nudgeText: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  logoutSection: { marginTop: spacing.xl },
});
