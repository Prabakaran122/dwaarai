import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import AnimatedEntry from './AnimatedEntry';
import { verifyOTP, sendGateCommand } from '../api/client';
import { useAuthStore } from '../store/authStore';

interface VerifyResult {
  status: 'allow' | 'deny';
  visitorName?: string;
  unitId?: string;
}

export default function OTPInput() {
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetForm = () => {
    setDigits(['', '', '', '', '', '']);
    setResult(null);
    setLoading(false);
    if (resetTimer.current) clearTimeout(resetTimer.current);
  };

  useEffect(() => {
    return () => { if (resetTimer.current) clearTimeout(resetTimer.current); };
  }, []);

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

  const handleVerify = async () => {
    if (otp.length !== 6 || !gateId) return;
    setLoading(true);
    try {
      const res = await verifyOTP(otp, gateId);
      const data = res.data.data;
      const status = data.decision === 'allow' ? 'allow' : 'deny';
      setResult({
        status,
        visitorName: data.visitor_name,
        unitId: data.unit_id,
      });
      resetTimer.current = setTimeout(resetForm, 10000);
    } catch {
      setResult({ status: 'deny' });
      resetTimer.current = setTimeout(resetForm, 3000);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenGate = async () => {
    try {
      await sendGateCommand(gateId, 'open');
      resetForm();
    } catch {
      Alert.alert('Error', 'Failed to open gate');
    }
  };

  if (result) {
    const isAllow = result.status === 'allow';
    return (
      <AnimatedEntry direction="fade" duration={300}>
        <GlowCard variant={isAllow ? 'success' : 'danger'} style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <MaterialCommunityIcons
              name={isAllow ? 'check-circle' : 'close-circle'}
              size={24}
              color={isAllow ? colors.success : colors.danger}
            />
            <Text style={[styles.resultStatus, { color: isAllow ? colors.success : colors.danger }]}>
              {isAllow ? 'VERIFIED' : 'INVALID OTP'}
            </Text>
          </View>
          {result.visitorName ? (
            <Text style={styles.visitorName}>{result.visitorName}</Text>
          ) : null}
          {isAllow && (
            <GradientButton title="Open Gate" icon="gate" variant="success" onPress={handleOpenGate} />
          )}
        </GlowCard>
      </AnimatedEntry>
    );
  }

  return (
    <GlowCard style={styles.container}>
      <Text style={styles.label}>VERIFY VISITOR</Text>
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
        title="Verify"
        icon="check-circle"
        onPress={handleVerify}
        loading={loading}
        disabled={otp.length !== 6}
      />
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  container: {},
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  digitRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md, justifyContent: 'center' },
  digitBox: {
    width: 36, height: 44, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
  },
  digitBoxFilled: { borderColor: 'rgba(99,102,241,0.5)' },
  digitInput: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, width: '100%', height: '100%', textAlign: 'center' },
  resultCard: {},
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  resultStatus: { fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  visitorName: { fontSize: 14, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.md },
});
