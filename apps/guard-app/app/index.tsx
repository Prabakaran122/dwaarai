import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '../src/store/authStore';
import { useQueueStore, type QueueEntry } from '../src/store/queueStore';
import { login as apiLogin } from '../src/api/client';
import VehicleCard from '../src/components/VehicleCard';
import StatusBadge from '../src/components/StatusBadge';

// ── Login Screen ──────────────────────────────────────────────────────
function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
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
    <View style={loginStyles.container}>
      <View style={loginStyles.card}>
        <Text style={loginStyles.title}>CommunityGate</Text>
        <Text style={loginStyles.subtitle}>Guard Station</Text>
        {errorMsg ? <Text style={loginStyles.error}>{errorMsg}</Text> : null}
        <TextInput
          style={loginStyles.input}
          placeholder="Username"
          placeholderTextColor="#94a3b8"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={loginStyles.input}
          placeholder="Password"
          placeholderTextColor="#94a3b8"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TouchableOpacity
          style={[loginStyles.button, loading && { opacity: 0.6 }]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={loginStyles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const loginStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#1e293b', borderRadius: 16, padding: 40, width: 400, alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#94a3b8', marginBottom: 32 },
  input: { width: '100%', backgroundColor: '#334155', borderRadius: 8, padding: 14, fontSize: 16, color: '#fff', marginBottom: 16 },
  button: { width: '100%', backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#ef4444', fontSize: 14, marginBottom: 16, textAlign: 'center' },
});

// ── Queue Screen ──────────────────────────────────────────────────────
function QueueView() {
  const entries = useQueueStore((s) => s.entries);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<'queue' | 'otp' | 'incident'>('queue');

  const pendingEntries = entries.filter((e) => e.decision === 'guard_review');
  const recentEntries = entries.filter((e) => e.decision !== 'guard_review');

  return (
    <View style={queueStyles.container}>
      {/* Header */}
      <View style={queueStyles.header}>
        <Text style={queueStyles.headerTitle}>Vehicle Queue</Text>
        <Text style={queueStyles.headerUser}>Guard: {user?.name || 'Unknown'}</Text>
      </View>

      {/* Content */}
      <View style={queueStyles.content}>
        <View style={queueStyles.panel}>
          <Text style={queueStyles.sectionTitle}>Pending Review ({pendingEntries.length})</Text>
          {pendingEntries.length === 0 ? (
            <Text style={queueStyles.empty}>No vehicles pending review</Text>
          ) : (
            <FlatList
              data={pendingEntries}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <VehicleCard entry={item} onPress={() => {}} />}
            />
          )}
        </View>
        <View style={queueStyles.panel}>
          <Text style={queueStyles.sectionTitle}>Recent ({recentEntries.length})</Text>
          {recentEntries.length === 0 ? (
            <Text style={queueStyles.empty}>No recent entries</Text>
          ) : (
            <FlatList
              data={recentEntries}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <VehicleCard entry={item} onPress={() => {}} />}
            />
          )}
        </View>
      </View>

      {/* Bottom bar */}
      <View style={queueStyles.bottomBar}>
        <TouchableOpacity style={queueStyles.navButton} onPress={() => setActiveTab('otp')}>
          <Text style={queueStyles.navButtonText}>Verify OTP</Text>
        </TouchableOpacity>
        <TouchableOpacity style={queueStyles.navButton} onPress={() => setActiveTab('incident')}>
          <Text style={queueStyles.navButtonText}>Log Incident</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[queueStyles.navButton, { backgroundColor: '#dc2626', flex: 0.5 }]} onPress={logout}>
          <Text style={queueStyles.navButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const queueStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  header: { backgroundColor: '#1e40af', padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  headerUser: { color: '#bfdbfe', fontSize: 14 },
  content: { flex: 1, flexDirection: 'row', padding: 16, gap: 16 },
  panel: { flex: 1, backgroundColor: '#e2e8f0', borderRadius: 12, padding: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 14 },
  bottomBar: { flexDirection: 'row', padding: 12, backgroundColor: '#1e293b', gap: 12 },
  navButton: { flex: 1, backgroundColor: '#2563eb', borderRadius: 8, padding: 12, alignItems: 'center' },
  navButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
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
      <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return isAuthenticated ? <QueueView /> : <LoginScreen />;
}
