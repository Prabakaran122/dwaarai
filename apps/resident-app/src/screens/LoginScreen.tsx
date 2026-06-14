import React, { useState, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
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
      const { token, user, refreshToken } = res.data.data;
      login(token, user, refreshToken);
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
    <View style={styles.container}>
      <Card style={styles.card}>
        {/* Brand header */}
        <View style={styles.logoRow}>
          <View style={styles.logoCircle}>
            <MaterialCommunityIcons name="door-sliding" size={28} color={colors.textInverse} />
          </View>
        </View>
        <Text style={styles.title}>Dwaar AI</Text>
        <Text style={styles.subtitle}>Resident Login</Text>

        {errorMsg ? (
          <Text style={styles.error}>{errorMsg}</Text>
        ) : null}

        {otpStep === 'phone' ? (
          <>
            <View style={styles.inputSpacing}>
              <Input
                label="Phone number"
                placeholder="e.g. 9876543210"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                onFocus={() => setFocusedField(true)}
                onBlur={() => setFocusedField(false)}
              />
            </View>
            <Button
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
            <Button
              title="Verify"
              onPress={handleVerifyOTP}
              icon="check-circle"
              loading={loading}
              disabled={otp.length !== 6}
            />
            <TouchableOpacity onPress={handleChangeNumber} style={styles.linkRow}>
              <Text style={styles.linkText}>Change number</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => setShowRegister(true)} style={styles.linkRow}>
          <Text style={styles.registerLinkText}>New here? Register with community code</Text>
        </TouchableOpacity>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.mist,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: { width: '100%', maxWidth: 360 },
  logoRow: { alignItems: 'center', marginBottom: spacing.lg },
  logoCircle: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...font(700),
    fontSize: 24,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...font(400),
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing['2xl'],
    letterSpacing: 0.5,
  },
  error: {
    ...font(400),
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  inputSpacing: { marginBottom: spacing.lg },
  otpSentLabel: {
    ...font(400),
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  digitRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
    justifyContent: 'center',
  },
  digitBox: {
    width: 44,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  digitBoxFilled: { borderColor: colors.teal, borderWidth: 1.5 },
  digitInput: {
    ...font(700),
    fontSize: 24,
    color: colors.textPrimary,
    width: '100%',
    height: '100%',
    textAlign: 'center',
  },
  linkRow: { alignItems: 'center', marginTop: spacing.lg },
  linkText: { ...font(400), color: colors.textSecondary, fontSize: 14 },
  registerLinkText: { ...font(500), color: colors.teal, fontSize: 14 },
});
