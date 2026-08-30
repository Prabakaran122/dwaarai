import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { useAuthStore } from '../store/authStore';
import { useLangStore, useT } from '../store/langStore';
import { LANGUAGES } from '../i18n/translations';

/**
 * Sarthi's own sign-in.
 *
 * Deliberately not Nazar's: a valet at a hotel is not a society gate guard,
 * and signing into a screen branded "Guard Station" would be the wrong product
 * in their hands. The credentials underneath are the same staff records — one
 * property, one set of people — but the app they hold is the valet one.
 */
export default function LoginScreen() {
  const t = useT();
  const { lang, setLang } = useLangStore();
  const { login, loading, error } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = username.trim().length > 0 && password.length > 0 && !loading;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <View style={styles.logo}>
          <MaterialCommunityIcons name="car-key" size={30} color={colors.bgPrimary} />
        </View>
        <Text style={styles.wordmark}>Sarthi</Text>
        <Text style={styles.tagline}>{t('valetStation')}</Text>

        <View style={styles.field}>
          <MaterialCommunityIcons name="account" size={18} color={colors.textTertiary} />
          <TextInput
            testID="login-username"
            value={username}
            onChangeText={setUsername}
            placeholder={t('username')}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <MaterialCommunityIcons name="lock" size={18} color={colors.textTertiary} />
          <TextInput
            testID="login-password"
            value={password}
            onChangeText={setPassword}
            placeholder={t('password')}
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            style={styles.input}
          />
        </View>

        {error && <Text style={styles.error} testID="login-error">{t(error)}</Text>}

        <Pressable
          testID="login-submit"
          disabled={!canSubmit}
          onPress={() => login(username.trim(), password)}
          style={[styles.cta, !canSubmit && styles.ctaDisabled]}
        >
          {loading
            ? <ActivityIndicator color={colors.bgPrimary} />
            : <Text style={styles.ctaText}>{t('signIn')}</Text>}
        </Pressable>

        {/* Valets, like guards, may not read English. */}
        <View style={styles.langRow}>
          {LANGUAGES.map((l) => (
            <Pressable
              key={l.code}
              testID={`lang-${l.code}`}
              onPress={() => setLang(l.code)}
              style={[styles.langChip, lang === l.code && styles.langChipActive]}
            >
              <Text style={[styles.langText, lang === l.code && styles.langTextActive]}>
                {l.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary, justifyContent: 'center', padding: spacing.xl },
  card: {
    backgroundColor: colors.card, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.xl, gap: spacing.md, alignItems: 'stretch',
  },
  logo: {
    width: 60, height: 60, borderRadius: radius.lg, alignSelf: 'center',
    backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center',
  },
  wordmark: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  tagline: {
    color: colors.textSecondary, fontSize: 11, textAlign: 'center',
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.sm,
  },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.elevated, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, paddingVertical: spacing.md, color: colors.textPrimary, fontSize: 15 },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  cta: {
    backgroundColor: colors.actionPrimary, borderRadius: radius.md,
    paddingVertical: spacing.lg, alignItems: 'center', marginTop: spacing.sm,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.bgPrimary, fontWeight: '700', fontSize: 16 },
  langRow: {
    flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  langChip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill, backgroundColor: colors.elevated,
  },
  langChipActive: { backgroundColor: colors.actionPrimary },
  langText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  langTextActive: { color: colors.bgPrimary },
});
