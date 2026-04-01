import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { login as apiLogin } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const login = useAuthStore((s) => s.login);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await apiLogin(username.trim(), password);
      const { token, user } = res.data.data;
      login(token, user);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'Login failed';
      setErrorMsg(typeof msg === 'string' ? msg : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={colors.gradientBg}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <AnimatedEntry direction="up" duration={600}>
        <GlowCard style={styles.card}>
          <View style={styles.logoRow}>
            <LinearGradient
              colors={colors.gradientPrimary as unknown as string[]}
              style={styles.logoCircle}
            >
              <MaterialCommunityIcons name="shield-check" size={32} color={colors.white} />
            </LinearGradient>
          </View>
          <Text style={styles.title}>CommunityGate</Text>
          <Text style={styles.subtitle}>Guard Station</Text>

          {errorMsg ? (
            <AnimatedEntry direction="fade">
              <Text style={styles.error}>{errorMsg}</Text>
            </AnimatedEntry>
          ) : null}

          <View style={[styles.inputWrapper, focusedField === 'username' && styles.inputFocused]}>
            <MaterialCommunityIcons name="account" size={18} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={colors.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setFocusedField('username')}
              onBlur={() => setFocusedField(null)}
            />
          </View>

          <View style={[styles.inputWrapper, focusedField === 'password' && styles.inputFocused]}>
            <MaterialCommunityIcons name="lock" size={18} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
            />
          </View>

          <View style={styles.buttonWrapper}>
            <GradientButton
              title="Sign In"
              onPress={handleLogin}
              icon="login"
              loading={loading}
              disabled={!username.trim() || !password.trim()}
            />
          </View>
        </GlowCard>
      </AnimatedEntry>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: 400,
  },
  logoRow: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing['2xl'],
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  inputFocused: {
    borderColor: 'rgba(99,102,241,0.5)',
  },
  inputIcon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    padding: spacing.lg,
    fontSize: 16,
    color: colors.textPrimary,
  },
  buttonWrapper: {
    marginTop: spacing.sm,
  },
});
