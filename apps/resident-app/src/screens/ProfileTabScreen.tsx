import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font, type } from '../theme/typography';
import { AppBar, Card, Avatar, Button, SectionHeader } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import FaceIdentityScreen from './FaceIdentityScreen';
import ComponentGallery from './ComponentGallery';

const LANGS = [{ code: 'en', label: 'English' }, { code: 'hi', label: 'हिंदी' }, { code: 'kn', label: 'ಕನ್ನಡ' }];

function Row({ icon, label, value, onPress }: { icon: string; label: string; value?: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.row}>
      <MaterialCommunityIcons name={icon as any} size={20} color={colors.brandPrimary} />
      <Text style={[type.body, styles.rowLabel]}>{label}</Text>
      {value ? <Text style={type.micro}>{value}</Text> : null}
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

export default function ProfileTabScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [overlay, setOverlay] = useState<'face' | 'gallery' | null>(null);
  const [lang, setLang] = useState('en');

  if (overlay === 'face') return <FaceIdentityScreen onClose={() => setOverlay(null)} />;
  if (overlay === 'gallery') return <ComponentGallery />;

  return (
    <View style={styles.container}>
      <AppBar title="Profile" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.account}>
          <Avatar name={user?.name} size="lg" />
          <View style={styles.accountInfo}>
            <Text style={type.h2}>{user?.name || 'Resident'}</Text>
            {!!user?.phone && <Text style={type.bodySecondary}>{user.phone}</Text>}
            <Text style={type.micro}>Unit {user?.unitNumber}{user?.communityName ? ` · ${user.communityName}` : ''}</Text>
          </View>
        </Card>

        <View style={styles.block}>
          <SectionHeader title="Preferences" />
          <Card>
            <Row icon="bell-outline" label="Notifications" value="On" />
            <View style={styles.divider} />
            <Row icon="face-recognition" label="Face ID & consent" onPress={() => setOverlay('face')} />
          </Card>
        </View>

        <View style={styles.block}>
          <SectionHeader title="Language" />
          <Card>
            <View style={styles.langRow}>
              {LANGS.map((l) => (
                <Text key={l.code} onPress={() => setLang(l.code)} style={[styles.lang, lang === l.code && styles.langOn]}>{l.label}</Text>
              ))}
            </View>
            <Text style={[type.micro, styles.langHint]}>Hindi & Kannada are coming soon.</Text>
          </Card>
        </View>

        <View style={styles.block}>
          <SectionHeader title="Support" />
          <Card>
            <Row icon="lifebuoy" label="Help & support" onPress={() => Linking.openURL('mailto:support@dwaarai.in')} />
            <View style={styles.divider} />
            <Row icon="information-outline" label="About" value="Dwaar AI v1.0" />
          </Card>
        </View>

        {__DEV__ ? (
          <View style={styles.block}>
            <Card><Row icon="palette-outline" label="Component gallery (dev)" onPress={() => setOverlay('gallery')} /></Card>
          </View>
        ) : null}

        <Button title="Log out" variant="destructive" icon="logout" onPress={logout} style={styles.logout} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  account: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  accountInfo: { flex: 1, gap: 2 },
  block: { marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowLabel: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.surfaceBorder },
  langRow: { flexDirection: 'row', gap: spacing.xs },
  lang: { ...font(500), fontSize: 13, color: colors.textSecondary, backgroundColor: colors.mist, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden' },
  langOn: { backgroundColor: colors.teal, color: colors.textInverse },
  langHint: { marginTop: spacing.sm },
  logout: { marginTop: spacing.xl, alignSelf: 'flex-start' },
});
