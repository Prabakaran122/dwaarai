import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '../src/store/authStore';
import { requestOTP, verifyOTP } from '../src/api/client';

// ── Login Screen ──────────────────────────────────────────────────────
function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpStep, setOtpStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const login = useAuthStore((s) => s.login);

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

  const handleVerifyOTP = async () => {
    if (!otp.trim() || otp.length < 6) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await verifyOTP(phone.trim(), otp.trim());
      const { token, user } = res.data.data;
      login(token, user);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'Invalid or expired OTP';
      setErrorMsg(typeof msg === 'string' ? msg : 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={loginStyles.container}>
      <View style={loginStyles.card}>
        <Text style={loginStyles.title}>CommunityGate</Text>
        <Text style={loginStyles.subtitle}>Resident Login</Text>
        {errorMsg ? <Text style={loginStyles.error}>{errorMsg}</Text> : null}

        {otpStep === 'phone' ? (
          <>
            <TextInput
              style={loginStyles.input}
              placeholder="Phone number"
              placeholderTextColor="#94a3b8"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TouchableOpacity
              style={[loginStyles.button, loading && { opacity: 0.6 }]}
              onPress={handleRequestOTP}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={loginStyles.buttonText}>Get OTP</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={loginStyles.phoneLabel}>OTP sent to {phone}</Text>
            <TextInput
              style={loginStyles.input}
              placeholder="Enter 6-digit OTP"
              placeholderTextColor="#94a3b8"
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
            />
            <TouchableOpacity
              style={[loginStyles.button, loading && { opacity: 0.6 }]}
              onPress={handleVerifyOTP}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={loginStyles.buttonText}>Verify OTP</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setOtpStep('phone'); setErrorMsg(''); }}>
              <Text style={loginStyles.backLink}>Change number</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const loginStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 32, width: 350, alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e40af', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 24 },
  input: { width: '100%', backgroundColor: '#f1f5f9', borderRadius: 8, padding: 14, fontSize: 16, color: '#1e293b', marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  button: { width: '100%', backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#ef4444', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  phoneLabel: { fontSize: 14, color: '#94a3b8', marginBottom: 16 },
  backLink: { color: '#60a5fa', marginTop: 16, fontSize: 14 },
});

// ── Home (Tabs) ───────────────────────────────────────────────────────
function HomeTab() {
  const user = useAuthStore((s) => s.user);
  return (
    <ScrollView style={tabStyles.container}>
      <Text style={tabStyles.greeting}>Hello, {user?.name ?? 'Resident'}</Text>
      <View style={tabStyles.cardsRow}>
        <View style={tabStyles.statCard}>
          <Text style={tabStyles.statNumber}>2</Text>
          <Text style={tabStyles.statLabel}>Vehicles</Text>
        </View>
        <View style={tabStyles.statCard}>
          <Text style={tabStyles.statNumber}>0</Text>
          <Text style={tabStyles.statLabel}>Active Passes</Text>
        </View>
      </View>
      <Text style={tabStyles.sectionTitle}>Recent Entries</Text>
      <Text style={tabStyles.empty}>No recent entries</Text>
    </ScrollView>
  );
}

function VehiclesTab() {
  return (
    <ScrollView style={tabStyles.container}>
      <Text style={tabStyles.sectionTitle}>My Vehicles</Text>
      <View style={tabStyles.vehicleCard}>
        <Text style={tabStyles.plate}>KA 05 MF 1234</Text>
        <Text style={tabStyles.vehicleDetail}>Honda City - White</Text>
        <Text style={tabStyles.vehicleDetail}>Unit 301</Text>
      </View>
      <View style={tabStyles.vehicleCard}>
        <Text style={tabStyles.plate}>KA 05 EB 2345</Text>
        <Text style={tabStyles.vehicleDetail}>Toyota Innova - Silver</Text>
        <Text style={tabStyles.vehicleDetail}>Unit 302</Text>
      </View>
    </ScrollView>
  );
}

function PassesTab() {
  return (
    <ScrollView style={tabStyles.container}>
      <Text style={tabStyles.sectionTitle}>Visitor Passes</Text>
      <TouchableOpacity style={tabStyles.addButton}>
        <Text style={tabStyles.addButtonText}>+ Create Visitor Pass</Text>
      </TouchableOpacity>
      <Text style={tabStyles.empty}>No active passes</Text>
    </ScrollView>
  );
}

function AlertsTab() {
  return (
    <ScrollView style={tabStyles.container}>
      <Text style={tabStyles.sectionTitle}>Notifications</Text>
      <Text style={tabStyles.empty}>No notifications</Text>
    </ScrollView>
  );
}

const tabStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  greeting: { fontSize: 22, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  cardsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 20, alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3 },
  statNumber: { fontSize: 32, fontWeight: '700', color: '#2563eb' },
  statLabel: { fontSize: 14, color: '#64748b', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1e293b', marginBottom: 12 },
  empty: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 20 },
  vehicleCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, elevation: 1 },
  plate: { fontSize: 18, fontWeight: '700', color: '#1e293b', letterSpacing: 1 },
  vehicleDetail: { fontSize: 14, color: '#64748b', marginTop: 4 },
  addButton: { backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center', marginBottom: 16 },
  addButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

// ── Main with Tab Navigation ──────────────────────────────────────────
function ResidentApp() {
  const [tab, setTab] = useState<'home' | 'vehicles' | 'passes' | 'alerts'>('home');
  const logout = useAuthStore((s) => s.logout);

  const tabs = [
    { key: 'home' as const, label: 'Home' },
    { key: 'vehicles' as const, label: 'Vehicles' },
    { key: 'passes' as const, label: 'Passes' },
    { key: 'alerts' as const, label: 'Alerts' },
  ];

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={appStyles.header}>
        <Text style={appStyles.headerTitle}>CommunityGate</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={appStyles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeTab />}
        {tab === 'vehicles' && <VehiclesTab />}
        {tab === 'passes' && <PassesTab />}
        {tab === 'alerts' && <AlertsTab />}
      </View>

      {/* Tab Bar */}
      <View style={appStyles.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[appStyles.tab, tab === t.key && appStyles.activeTab]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[appStyles.tabText, tab === t.key && appStyles.activeTabText]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const appStyles = StyleSheet.create({
  header: { backgroundColor: '#1e40af', padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  logoutText: { color: '#bfdbfe', fontSize: 14 },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  activeTab: { borderTopWidth: 2, borderTopColor: '#2563eb' },
  tabText: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },
  activeTabText: { color: '#2563eb' },
});

// ── Root ──────────────────────────────────────────────────────────────
export default function Page() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  useEffect(() => {
    rehydrate();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return isAuthenticated ? <ResidentApp /> : <LoginScreen />;
}
