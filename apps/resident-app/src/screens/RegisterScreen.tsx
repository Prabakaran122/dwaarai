import React, { useState, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { font } from '../theme/typography';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
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
    <View style={styles.container}>
      <Card style={styles.card}>
        {/* Brand header */}
        <View style={styles.logoRow}>
          <View style={styles.logoCircle}>
            <MaterialCommunityIcons name="account-plus" size={28} color={colors.textInverse} />
          </View>
        </View>
        <Text style={styles.title}>Join Community</Text>
        <Text style={styles.subtitle}>Resident Registration</Text>

        {errorMsg ? (
          <Text style={styles.error}>{errorMsg}</Text>
        ) : null}

        {step === 'details' ? (
          <>
            <View style={styles.inputSpacing}>
              <Input
                label="Community code"
                placeholder="e.g. PALM2026"
                value={communityCode}
                onChangeText={setCommunityCode}
                autoCapitalize="characters"
              />
            </View>
            <View style={styles.inputSpacing}>
              <Input
                label="Phone number"
                placeholder="e.g. 9876543210"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
            </View>
            <View style={styles.inputSpacing}>
              <Input
                label="Unit number"
                placeholder="e.g. 301"
                value={unitNumber}
                onChangeText={setUnitNumber}
              />
            </View>
            <Button
              title="Register"
              onPress={handleRegister}
              icon="account-plus"
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
            <Button
              title="Verify OTP"
              onPress={handleVerifyOTP}
              icon="check-circle"
              loading={loading}
              disabled={otp.length !== 6}
            />
            <TouchableOpacity
              onPress={() => { setStep('details'); setDigits(['', '', '', '', '', '']); setErrorMsg(''); }}
              style={styles.linkRow}
            >
              <Text style={styles.linkText}>Change details</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => setShowRegister(false)} style={styles.linkRow}>
          <Text style={styles.linkText}>Already have an account? Login</Text>
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
    backgroundColor: colors.teal,
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
  inputSpacing: { marginBottom: spacing.md },
  otpSentLabel: {
    ...font(400),
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  communityLabel: {
    ...font(500),
    color: colors.teal,
    fontSize: 14,
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
});
