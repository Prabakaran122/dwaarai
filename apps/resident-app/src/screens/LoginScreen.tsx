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
import { requestOTP, verifyOTP } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpStep, setOtpStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);

  const handleRequestOTP = async () => {
    if (!phone.trim() || phone.trim().length < 10) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }
    setLoading(true);
    try {
      await requestOTP(phone.trim());
      setOtpStep('otp');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim() || otp.length < 4) {
      Alert.alert('Error', 'Please enter the OTP');
      return;
    }
    setLoading(true);
    try {
      const res = await verifyOTP(phone, otp.trim());
      const { token, user } = res.data.data;
      login(token, user);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>CommunityGate</Text>
        <Text style={styles.subtitle}>Resident Login</Text>

        {otpStep === 'phone' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              placeholderTextColor="#94a3b8"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleRequestOTP}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Send OTP</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.phoneLabel}>OTP sent to {phone}</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter OTP"
              placeholderTextColor="#94a3b8"
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleVerifyOTP}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Verify</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOtpStep('phone')}>
              <Text style={styles.backLink}>Change number</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 32,
    width: '85%',
    maxWidth: 360,
    alignItems: 'center',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#94a3b8', marginBottom: 32 },
  phoneLabel: { fontSize: 14, color: '#94a3b8', marginBottom: 16 },
  input: {
    width: '100%',
    backgroundColor: '#334155',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    marginBottom: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  backLink: { color: '#60a5fa', marginTop: 16, fontSize: 14 },
});
