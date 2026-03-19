import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { verifyOTP } from '../api/client';
import { useAuthStore } from '../store/authStore';

type VerifyResult = {
  status: 'allow' | 'deny';
  visitorName?: string;
  hostName?: string;
} | null;

export default function OTPVerifyScreen() {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult>(null);
  const gateId = useAuthStore((s) => s.user?.gateId ?? '');

  const handleVerify = async () => {
    if (otp.length !== 6) {
      Alert.alert('Error', 'Please enter a 6-digit OTP');
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await verifyOTP(otp, gateId);
      setResult(res.data.data);
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Verification failed';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setOtp('');
    setResult(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Visitor OTP Verification</Text>

        <TextInput
          style={styles.otpInput}
          placeholder="000000"
          placeholderTextColor="#64748b"
          value={otp}
          onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          textAlign="center"
        />

        {result ? (
          <View
            style={[
              styles.resultBox,
              result.status === 'allow'
                ? styles.resultAllow
                : styles.resultDeny,
            ]}
          >
            <Text style={styles.resultStatus}>
              {result.status === 'allow' ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
            </Text>
            {result.visitorName ? (
              <Text style={styles.resultDetail}>
                Visitor: {result.visitorName}
              </Text>
            ) : null}
            {result.hostName ? (
              <Text style={styles.resultDetail}>Host: {result.hostName}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.verifyBtn, loading && styles.disabled]}
            onPress={handleVerify}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.resetBtn]}
            onPress={handleReset}
          >
            <Text style={styles.buttonText}>Reset</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 40,
    width: 480,
    alignItems: 'center',
    elevation: 3,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 24,
  },
  otpInput: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 12,
    color: '#1e293b',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 16,
    width: '100%',
    marginBottom: 24,
  },
  resultBox: {
    width: '100%',
    borderRadius: 10,
    padding: 20,
    marginBottom: 24,
    alignItems: 'center',
  },
  resultAllow: {
    backgroundColor: '#dcfce7',
  },
  resultDeny: {
    backgroundColor: '#fecaca',
  },
  resultStatus: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  resultDetail: {
    fontSize: 14,
    color: '#334155',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  verifyBtn: {
    backgroundColor: '#2563eb',
  },
  resetBtn: {
    backgroundColor: '#64748b',
  },
  disabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
