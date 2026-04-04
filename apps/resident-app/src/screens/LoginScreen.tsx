import React, { useState, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { requestOTP, verifyOTP } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const setShowRegister = useAuthStore((s) => s.setShowRegister);
  const [phone, setPhone] = useState('');
  const [otpStep, setOtpStep] = useState<'phone' | 'otp'>('phone');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [focusedField, setFocusedField] = useState(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const handleRequestOTP = async () => {
    if (!phone.trim() || phone.trim().length < 10) return;
    setErrorMsg('');
    setLoading(true);
    try {
      await requestOTP(phone.trim());
      setOtpStep('otp');
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'Failed to send OTP';
      setErrorMsg(typeof msg === 'string' ? msg : 'Failed to send OTP');
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
      const res = await verifyOTP(phone.trim(), otp);
      const { token, user } = res.data.data;
      login(token, user);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'Invalid or expired OTP';
      setErrorMsg(typeof msg === 'string' ? msg : 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleChangeNumber = () => {
    setOtpStep('phone');
    setDigits(['', '', '', '', '', '']);
    setErrorMsg('');
  };

  return (
    <LinearGradient colors={colors.gradientBg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.container}>
      <AnimatedEntry direction="up" duration={600}>
        <GlowCard style={styles.card}>
          <View style={styles.logoRow}>
            <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.logoCircle}>
              <MaterialCommunityIcons name="cellphone" size={28} color={colors.white} />
            </LinearGradient>
          </View>
          <Text style={styles.title}>CommunityGate</Text>
          <Text style={styles.subtitle}>RESIDENT LOGIN</Text>

          {errorMsg ? (
            <AnimatedEntry direction="fade">
              <Text style={styles.error}>{errorMsg}</Text>
            </AnimatedEntry>
          ) : null}

          {otpStep === 'phone' ? (
            <>
              <View style={[styles.inputWrapper, focusedField && styles.inputFocused]}>
                <MaterialCommunityIcons name="phone" size={18} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Phone number"
                  placeholderTextColor={colors.textMuted}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  onFocus={() => setFocusedField(true)}
                  onBlur={() => setFocusedField(false)}
                />
              </View>
              <GradientButton
                title="Send OTP"
                onPress={handleRequestOTP}
                icon="message-text"
                loading={loading}
                disabled={!phone.trim() || phone.trim().length < 10}
              />
            </>
          ) : (
            <>
              <Text style={styles.otpSentLabel}>OTP sent to {phone}</Text>
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
                loading={loading}
                disabled={otp.length !== 6}
              />
              <TouchableOpacity onPress={handleChangeNumber} style={styles.changeLink}>
                <Text style={styles.changeLinkText}>Change number</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity onPress={() => setShowRegister(true)} style={styles.changeLink}>
            <Text style={styles.registerLinkText}>First time? Register with community code</Text>
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
  subtitle: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing['2xl'], letterSpacing: 2 },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    marginBottom: spacing.lg, paddingHorizontal: spacing.md,
  },
  inputFocused: { borderColor: 'rgba(99,102,241,0.5)' },
  inputIcon: { marginRight: spacing.sm },
  input: { flex: 1, padding: spacing.lg, fontSize: 16, color: colors.textPrimary },
  otpSentLabel: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg },
  digitRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl, justifyContent: 'center' },
  digitBox: {
    width: 44, height: 56, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
  },
  digitBoxFilled: { borderColor: 'rgba(99,102,241,0.5)' },
  digitInput: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, width: '100%', height: '100%', textAlign: 'center' },
  changeLink: { alignItems: 'center', marginTop: spacing.lg },
  changeLinkText: { color: colors.textSecondary, fontSize: 14 },
  registerLinkText: { color: colors.success, fontSize: 14, fontWeight: '500' },
});
