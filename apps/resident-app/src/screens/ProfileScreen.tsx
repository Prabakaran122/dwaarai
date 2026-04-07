import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { useAuthStore } from '../store/authStore';

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

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
  logoutSection: { marginTop: spacing.xl },
});
