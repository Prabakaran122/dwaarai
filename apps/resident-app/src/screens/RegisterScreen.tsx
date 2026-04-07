import React, { useState, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { registerResident, verifyRegistration } from '../api/client';
import { useAuthStore } from '../store/authStore';

type Step = 'details' | 'otp';

export default function RegisterScreen() {
  const login = useAuthStore((s) => s.login);
  const setShowRegister = useAuthStore((s) => s.setShowRegister);
  const [step, setStep] = useState<Step>('details');
  const [communityCode, setCommunityCode] = useState('');
  const [phone, setPhone] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [communityName, setCommunityName] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const handleRegister = async () => {
    if (!communityCode.trim() || !phone.trim() || !unitNumber.trim()) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await registerResident({
        community_code: communityCode.trim().toUpperCase(),
        phone: phone.trim(),
        unit_number: unitNumber.trim(),
      });
      setCommunityName(res.data.data?.communityName || '');
      setStep('otp');
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'Registration failed';
      setErrorMsg(typeof msg === 'string' ? msg : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '');
    if (!cleaned && value === '') {
      const newDigits = [...digits];
      newDigits[index] = '';
      setDigits(newDigits);
      if (index > 0) inputRefs.current[index - 1]?.focus();
      return;
    }
    if (cleaned.length === 1) {
      const newDigits = [...digits];
      newDigits[index] = cleaned;
      setDigits(newDigits);
      if (index < 5) inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      const newDigits = [...digits];
      newDigits[index - 1] = '';
      setDigits(newDigits);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const otp = digits.join('');

  const handleVerifyOTP = async () => {
    if (otp.length !== 6) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await verifyRegistration(phone.trim(), otp);
      const { token, user, refreshToken } = res.data.data;
      login(token, { ...user, communityName }, refreshToken);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'Invalid or expired OTP';
      setErrorMsg(typeof msg === 'string' ? msg : 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={colors.gradientBg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.container}>
      <AnimatedEntry direction="up" duration={600}>
        <GlowCard style={styles.card}>
          <View style={styles.logoRow}>
            <LinearGradient colors={colors.gradientSuccess as [string, string]} style={styles.logoCircle}>
              <MaterialCommunityIcons name="account-plus" size={28} color={colors.white} />
            </LinearGradient>
          </View>
          <Text style={styles.title}>Join Community</Text>
          <Text style={styles.subtitle}>RESIDENT REGISTRATION</Text>

          {errorMsg ? (
            <AnimatedEntry direction="fade">
              <Text style={styles.error}>{errorMsg}</Text>
            </AnimatedEntry>
          ) : null}

          {step === 'details' ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Community Code (e.g., PALM2026)"
                placeholderTextColor={colors.textMuted}
                value={communityCode}
                onChangeText={setCommunityCode}
                autoCapitalize="characters"
              />
              <TextInput
                style={styles.input}
                placeholder="Phone number"
                placeholderTextColor={colors.textMuted}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
              <TextInput
                style={styles.input}
                placeholder="Unit number (e.g., 301)"
                placeholderTextColor={colors.textMuted}
                value={unitNumber}
                onChangeText={setUnitNumber}
              />
              <GradientButton
                title="Register"
                onPress={handleRegister}
                icon="account-plus"
                variant="success"
                loading={loading}
                disabled={!communityCode.trim() || !phone.trim() || !unitNumber.trim()}
              />
            </>
          ) : (
            <>
              <Text style={styles.otpSentLabel}>OTP sent to {phone}</Text>
              {communityName ? (
                <Text style={styles.communityLabel}>Joining {communityName}</Text>
              ) : null}
              <View style={styles.digitRow}>
                {digits.map((digit, i) => (
                  <View key={i} style={[styles.digitBox, digit ? styles.digitBoxFilled : null]}>
                    <TextInput
                      ref={(ref) => { inputRefs.current[i] = ref; }}
                      style={styles.digitInput}
                      value={digit}
                      onChangeText={(v) => handleDigitChange(i, v)}
                      onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
                      keyboardType="number-pad"
                      maxLength={1}
                      textAlign="center"
                      selectTextOnFocus
                    />
                  </View>
                ))}
              </View>
              <GradientButton
                title="Verify OTP"
                onPress={handleVerifyOTP}
                icon="check-circle"
                variant="success"
                loading={loading}
                disabled={otp.length !== 6}
              />
              <TouchableOpacity onPress={() => { setStep('details'); setDigits(['', '', '', '', '', '']); setErrorMsg(''); }} style={styles.changeLink}>
                <Text style={styles.changeLinkText}>Change details</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity onPress={() => setShowRegister(false)} style={styles.changeLink}>
            <Text style={styles.changeLinkText}>Already have an account? Login</Text>
          </TouchableOpacity>
        </GlowCard>
      </AnimatedEntry>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { width: '85%', maxWidth: 360 },
  logoRow: { alignItems: 'center', marginBottom: spacing.lg },
  logoCircle: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { fontSize: 12, color: colors.success, textAlign: 'center', marginBottom: spacing['2xl'], letterSpacing: 2 },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.lg, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md,
  },
  otpSentLabel: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: spacing.xs },
  communityLabel: { color: colors.success, fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: spacing.lg },
  digitRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl, justifyContent: 'center' },
  digitBox: {
    width: 44, height: 56, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
  },
  digitBoxFilled: { borderColor: 'rgba(34,197,94,0.5)' },
  digitInput: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, width: '100%', height: '100%', textAlign: 'center' },
  changeLink: { alignItems: 'center', marginTop: spacing.lg },
  changeLinkText: { color: colors.textSecondary, fontSize: 14 },
});
