import React, { useState, useRef } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { verifyOTP } from '../api/client';
import { useAuthStore } from '../store/authStore';

type VerifyResult = {
  status: 'allow' | 'deny';
  visitorName?: string;
  hostName?: string;
} | null;

export default function OTPVerifyScreen() {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult>(null);
  const gateId = useAuthStore((s) => s.user?.gateId ?? '');
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const handleDigitChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '');
    if (!cleaned && value === '') {
      // Backspace
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
    if (otp.length !== 6) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await verifyOTP(otp, gateId);
      setResult(res.data.data);
    } catch {
      setResult({ status: 'deny' });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setDigits(['', '', '', '', '', '']);
    setResult(null);
    inputRefs.current[0]?.focus();
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <AnimatedEntry direction="fade" duration={500}>
        <GlowCard style={styles.card}>
          <IconBadge
            icon="numeric"
            color={colors.info}
            gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']}
            size={48}
          />
          <Text style={styles.title}>Verify Visitor OTP</Text>

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

          {result ? (
            <AnimatedEntry direction="fade" duration={400}>
              <GlowCard variant={result.status === 'allow' ? 'success' : 'danger'} style={styles.resultCard}>
                <View style={styles.resultRow}>
                  <IconBadge
                    icon={result.status === 'allow' ? 'check-circle' : 'close-circle'}
                    color={result.status === 'allow' ? colors.success : colors.danger}
                    gradientColors={result.status === 'allow'
                      ? ['rgba(34,197,94,0.3)', 'rgba(16,185,129,0.1)']
                      : ['rgba(239,68,68,0.3)', 'rgba(220,38,38,0.1)']
                    }
                    size={40}
                  />
                  <View style={styles.resultInfo}>
                    <Text style={[styles.resultStatus, {
                      color: result.status === 'allow' ? colors.success : colors.danger,
                    }]}>
                      {result.status === 'allow' ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
                    </Text>
                    {result.visitorName ? (
                      <Text style={styles.resultDetail}>Visitor: {result.visitorName}</Text>
                    ) : null}
                    {result.hostName ? (
                      <Text style={styles.resultDetail}>Host: {result.hostName}</Text>
                    ) : null}
                  </View>
                </View>
              </GlowCard>
            </AnimatedEntry>
          ) : null}

          <View style={styles.actions}>
            <View style={styles.actionBtn}>
              <GradientButton
                title="Verify"
                icon="check-circle"
                onPress={handleVerify}
                loading={loading}
                disabled={otp.length !== 6}
              />
            </View>
            <View style={styles.actionBtn}>
              <GradientButton
                title="Reset"
                icon="refresh"
                variant="danger"
                onPress={handleReset}
              />
            </View>
          </View>
        </GlowCard>
      </AnimatedEntry>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { width: 480, alignItems: 'center', gap: spacing.lg },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginTop: spacing.md },
  digitRow: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.xl },
  digitBox: {
    width: 52,
    height: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  digitBoxFilled: {
    borderColor: 'rgba(99,102,241,0.5)',
  },
  digitInput: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    width: '100%',
    height: '100%',
    textAlign: 'center',
  },
  resultCard: { width: '100%' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resultInfo: { flex: 1, gap: spacing.xs },
  resultStatus: { fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  resultDetail: { color: colors.textMuted, fontSize: 13 },
  actions: { flexDirection: 'row', gap: spacing.md, width: '100%' },
  actionBtn: { flex: 1 },
});
