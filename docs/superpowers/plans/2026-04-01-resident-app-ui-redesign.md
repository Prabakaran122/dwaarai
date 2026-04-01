# Resident App UI Redesign — Gradient Glow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Resident App with the same Gradient Glow theme as the Guard App — gradient backgrounds, glowing cards, animated entries, custom components — for a portrait phone layout.

**Architecture:** Copy theme tokens and 6 reusable components from Guard App into Resident App, install the same dependencies, then rewrite all 5 screens (Login, Home, Vehicles, Passes, Notifications) plus the tab bar and entry point using the new design system.

**Tech Stack:** React Native / Expo 52, expo-linear-gradient, react-native-reanimated, @expo/vector-icons (MaterialCommunityIcons), Zustand, TypeScript

---

## File Structure

### Theme + Components (copy from Guard App)
- `apps/resident-app/src/theme/colors.ts`
- `apps/resident-app/src/theme/spacing.ts`
- `apps/resident-app/src/components/GlowCard.tsx`
- `apps/resident-app/src/components/GradientButton.tsx`
- `apps/resident-app/src/components/StatusPill.tsx`
- `apps/resident-app/src/components/PlateText.tsx`
- `apps/resident-app/src/components/IconBadge.tsx`
- `apps/resident-app/src/components/AnimatedEntry.tsx`

### Screens (rewrite)
- `apps/resident-app/src/screens/LoginScreen.tsx`
- `apps/resident-app/src/screens/HomeScreen.tsx`
- `apps/resident-app/src/screens/VehiclesScreen.tsx`
- `apps/resident-app/src/screens/PassesScreen.tsx`
- `apps/resident-app/src/screens/NotificationsScreen.tsx`

### Entry point (rewrite)
- `apps/resident-app/app/index.tsx`

---

### Task 1: Install dependencies

**Files:**
- Modify: `apps/resident-app/package.json`

- [ ] **Step 1: Install expo-linear-gradient and react-native-reanimated**

```bash
cd apps/resident-app && npx expo install expo-linear-gradient react-native-reanimated
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/package.json pnpm-lock.yaml
git commit -m "chore(resident-app): add expo-linear-gradient and react-native-reanimated"
```

---

### Task 2: Copy theme and components from Guard App

**Files:**
- Create: `apps/resident-app/src/theme/colors.ts`
- Create: `apps/resident-app/src/theme/spacing.ts`
- Create: `apps/resident-app/src/components/GlowCard.tsx`
- Create: `apps/resident-app/src/components/GradientButton.tsx`
- Create: `apps/resident-app/src/components/StatusPill.tsx`
- Create: `apps/resident-app/src/components/PlateText.tsx`
- Create: `apps/resident-app/src/components/IconBadge.tsx`
- Create: `apps/resident-app/src/components/AnimatedEntry.tsx`

- [ ] **Step 1: Copy theme files**

```bash
mkdir -p apps/resident-app/src/theme
cp apps/guard-app/src/theme/colors.ts apps/resident-app/src/theme/colors.ts
cp apps/guard-app/src/theme/spacing.ts apps/resident-app/src/theme/spacing.ts
```

- [ ] **Step 2: Copy component files**

```bash
cp apps/guard-app/src/components/GlowCard.tsx apps/resident-app/src/components/GlowCard.tsx
cp apps/guard-app/src/components/GradientButton.tsx apps/resident-app/src/components/GradientButton.tsx
cp apps/guard-app/src/components/StatusPill.tsx apps/resident-app/src/components/StatusPill.tsx
cp apps/guard-app/src/components/PlateText.tsx apps/resident-app/src/components/PlateText.tsx
cp apps/guard-app/src/components/IconBadge.tsx apps/resident-app/src/components/IconBadge.tsx
cp apps/guard-app/src/components/AnimatedEntry.tsx apps/resident-app/src/components/AnimatedEntry.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/resident-app/src/theme/ apps/resident-app/src/components/GlowCard.tsx apps/resident-app/src/components/GradientButton.tsx apps/resident-app/src/components/StatusPill.tsx apps/resident-app/src/components/PlateText.tsx apps/resident-app/src/components/IconBadge.tsx apps/resident-app/src/components/AnimatedEntry.tsx
git commit -m "feat(resident-app): copy Gradient Glow theme and components from Guard App"
```

---

### Task 3: Redesign LoginScreen

**Files:**
- Modify: `apps/resident-app/src/screens/LoginScreen.tsx`

- [ ] **Step 1: Rewrite LoginScreen.tsx**

Replace the full contents of `apps/resident-app/src/screens/LoginScreen.tsx` with:

```typescript
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
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/LoginScreen.tsx
git commit -m "feat(resident-app): redesign LoginScreen with Gradient Glow theme"
```

---

### Task 4: Redesign HomeScreen

**Files:**
- Modify: `apps/resident-app/src/screens/HomeScreen.tsx`

- [ ] **Step 1: Rewrite HomeScreen.tsx**

Replace the full contents of `apps/resident-app/src/screens/HomeScreen.tsx` with:

```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { getEvents, getPasses } from '../api/client';
import { useVehicleStore } from '../store/vehicleStore';
import { useAuthStore } from '../store/authStore';

interface EntryEvent {
  id: string;
  visitorName: string;
  gate: string;
  timestamp: string;
}

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const { vehicles, fetch: fetchVehicles } = useVehicleStore();
  const [activePasses, setActivePasses] = useState(0);
  const [recentEntries, setRecentEntries] = useState<EntryEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      await fetchVehicles();
      const [passRes, eventRes] = await Promise.all([getPasses(), getEvents({ limit: '5' })]);
      const passes = passRes.data.data || [];
      setActivePasses(passes.filter((p: any) => p.status === 'active').length);
      setRecentEntries(eventRes.data.data || []);
    } catch { /* silently fail on refresh */ }
  };

  useEffect(() => { loadData(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.info} />}
      >
        <AnimatedEntry direction="fade">
          <View style={styles.greetingRow}>
            <MaterialCommunityIcons name="hand-wave" size={24} color={colors.warning} />
            <Text style={styles.greeting}>Hello, {user?.name ?? 'Resident'}</Text>
          </View>
        </AnimatedEntry>

        <View style={styles.statsRow}>
          <AnimatedEntry direction="left" delay={100}>
            <GlowCard style={styles.statCard}>
              <IconBadge icon="car" color={colors.info} gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']} size={36} />
              <Text style={styles.statNumber}>{vehicles.length}</Text>
              <Text style={styles.statLabel}>Vehicles</Text>
            </GlowCard>
          </AnimatedEntry>
          <AnimatedEntry direction="right" delay={200}>
            <GlowCard style={styles.statCard}>
              <IconBadge icon="ticket-account" color="#c084fc" gradientColors={['rgba(168,85,247,0.3)', 'rgba(236,72,153,0.1)']} size={36} />
              <Text style={styles.statNumber}>{activePasses}</Text>
              <Text style={styles.statLabel}>Active Passes</Text>
            </GlowCard>
          </AnimatedEntry>
        </View>

        <Text style={styles.sectionTitle}>Recent Entries</Text>
        {recentEntries.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="clock-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>No recent entries</Text>
          </View>
        ) : (
          recentEntries.map((e, i) => (
            <AnimatedEntry key={e.id} direction="left" delay={i * 100}>
              <GlowCard style={styles.entryCard}>
                <View style={styles.entryRow}>
                  <IconBadge icon="gate" color={colors.success} gradientColors={['rgba(34,197,94,0.3)', 'rgba(16,185,129,0.1)']} size={32} />
                  <View style={styles.entryInfo}>
                    <Text style={styles.entryName}>{e.visitorName}</Text>
                    <Text style={styles.entryGate}>{e.gate}</Text>
                  </View>
                  <Text style={styles.entryTime}>
                    {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </GlowCard>
            </AnimatedEntry>
          ))
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing['2xl'] },
  greeting: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing['2xl'] },
  statCard: { flex: 1, alignItems: 'center', gap: spacing.sm },
  statNumber: { fontSize: 32, fontWeight: '800', color: colors.textPrimary },
  statLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  entryCard: { marginBottom: spacing.sm },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  entryInfo: { flex: 1 },
  entryName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  entryGate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  entryTime: { fontSize: 13, color: colors.textSecondary },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['3xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/HomeScreen.tsx
git commit -m "feat(resident-app): redesign HomeScreen with Gradient Glow theme"
```

---

### Task 5: Redesign VehiclesScreen

**Files:**
- Modify: `apps/resident-app/src/screens/VehiclesScreen.tsx`

- [ ] **Step 1: Rewrite VehiclesScreen.tsx**

Replace the full contents of `apps/resident-app/src/screens/VehiclesScreen.tsx` with:

```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, Modal, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import PlateText from '../components/PlateText';
import StatusPill from '../components/StatusPill';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useVehicleStore, Vehicle } from '../store/vehicleStore';

const typeIcons: Record<string, string> = {
  car: 'car',
  bike: 'motorbike',
  truck: 'truck',
};

export default function VehiclesScreen() {
  const { vehicles, loading, fetch, add, update, remove } = useVehicleStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [type, setType] = useState('car');

  useEffect(() => { fetch(); }, []);

  const resetForm = () => { setPlate(''); setMake(''); setModel(''); setType('car'); setEditing(null); setShowForm(false); };

  const openEdit = (v: Vehicle) => {
    setEditing(v); setPlate(v.plate); setMake(v.make); setModel(v.model); setType(v.type); setShowForm(true);
  };

  const handleSave = async () => {
    if (!plate.trim()) { Alert.alert('Error', 'Plate number is required'); return; }
    try {
      if (editing) { await update(editing.id, { plate, make, model, type }); }
      else { await add({ plate, make, model, type }); }
      resetForm();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.error || 'Save failed'); }
  };

  const handleDelete = (id: string) => {
    Alert.alert('Remove Vehicle', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(id) },
    ]);
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <FlatList
        data={vehicles}
        keyExtractor={(v) => v.id}
        refreshing={loading}
        onRefresh={fetch}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <AnimatedEntry direction="left" delay={index * 80}>
            <GlowCard style={styles.vehicleCard}>
              <TouchableOpacity onPress={() => openEdit(item)} onLongPress={() => handleDelete(item.id)} activeOpacity={0.7}>
                <View style={styles.vehicleRow}>
                  <IconBadge
                    icon={(typeIcons[item.type] || 'car') as any}
                    color={colors.info}
                    gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']}
                    size={36}
                  />
                  <View style={styles.vehicleInfo}>
                    <PlateText plate={item.plate} size="md" />
                    <Text style={styles.vehicleDetail}>{item.make} {item.model}</Text>
                  </View>
                  <View style={styles.vehicleMeta}>
                    <View style={[styles.rfidPill, { backgroundColor: item.rfidTag ? colors.successBg : colors.surface }]}>
                      <Text style={[styles.rfidText, { color: item.rfidTag ? colors.success : colors.textMuted }]}>
                        {item.rfidTag ? 'RFID' : 'No RFID'}
                      </Text>
                    </View>
                    <Text style={styles.vehicleType}>{item.type}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </GlowCard>
          </AnimatedEntry>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="car" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No vehicles registered</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fabWrap} onPress={() => setShowForm(true)} activeOpacity={0.8}>
        <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.fab}>
          <MaterialCommunityIcons name="plus" size={28} color={colors.white} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Modal Form */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Vehicle' : 'Add Vehicle'}</Text>
            <TextInput style={styles.input} placeholder="Plate number" placeholderTextColor={colors.textMuted} value={plate} onChangeText={setPlate} autoCapitalize="characters" />
            <TextInput style={styles.input} placeholder="Make" placeholderTextColor={colors.textMuted} value={make} onChangeText={setMake} />
            <TextInput style={styles.input} placeholder="Model" placeholderTextColor={colors.textMuted} value={model} onChangeText={setModel} />
            <View style={styles.typeChips}>
              {['car', 'bike', 'truck'].map((t) => (
                <TouchableOpacity key={t} onPress={() => setType(t)}>
                  {type === t ? (
                    <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.chip}>
                      <MaterialCommunityIcons name={(typeIcons[t] || 'car') as any} size={16} color={colors.white} />
                      <Text style={styles.chipTextActive}>{t}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.chipInactive}>
                      <MaterialCommunityIcons name={(typeIcons[t] || 'car') as any} size={16} color={colors.textMuted} />
                      <Text style={styles.chipText}>{t}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={resetForm} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Save" variant="success" icon="check-circle" onPress={handleSave} />
              </View>
            </View>
          </GlowCard>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: 100 },
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleInfo: { flex: 1, gap: spacing.xs },
  vehicleDetail: { color: colors.textMuted, fontSize: 13 },
  vehicleMeta: { alignItems: 'flex-end', gap: spacing.xs },
  vehicleType: { color: colors.textMuted, fontSize: 11, textTransform: 'capitalize' },
  rfidPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  rfidText: { fontSize: 10, fontWeight: '700' },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md,
  },
  typeChips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  chipInactive: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  chipText: { color: colors.textMuted, fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: colors.white, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/VehiclesScreen.tsx
git commit -m "feat(resident-app): redesign VehiclesScreen with Gradient Glow theme"
```

---

### Task 6: Redesign PassesScreen

**Files:**
- Modify: `apps/resident-app/src/screens/PassesScreen.tsx`

- [ ] **Step 1: Rewrite PassesScreen.tsx**

Replace the full contents of `apps/resident-app/src/screens/PassesScreen.tsx` with:

```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, Modal, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import * as api from '../api/client';

interface Pass {
  id: string;
  visitorName: string;
  visitorPhone: string;
  otp: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  validFrom: string;
  validUntil: string;
}

const statusConfig: Record<Pass['status'], { color: string; bg: string; label: string }> = {
  active: { color: colors.success, bg: colors.successBg, label: 'Active' },
  used: { color: colors.info, bg: colors.infoBg, label: 'Used' },
  expired: { color: colors.textMuted, bg: colors.surface, label: 'Expired' },
  revoked: { color: colors.danger, bg: colors.dangerBg, label: 'Revoked' },
};

const DURATION_OPTIONS = ['4', '12', '24', '48'];

export default function PassesScreen() {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [hours, setHours] = useState('24');
  const [expandedOtp, setExpandedOtp] = useState<string | null>(null);

  const fetchPasses = async () => {
    setLoading(true);
    try { const res = await api.getPasses(); setPasses(res.data.data || []); } finally { setLoading(false); }
  };

  useEffect(() => { fetchPasses(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || !phone.trim()) { Alert.alert('Error', 'Name and phone are required'); return; }
    try {
      const now = new Date();
      const until = new Date(now.getTime() + parseInt(hours, 10) * 3600000);
      await api.createPass({ visitorName: name.trim(), visitorPhone: phone.trim(), validFrom: now.toISOString(), validUntil: until.toISOString() });
      setName(''); setPhone(''); setHours('24'); setShowForm(false); fetchPasses();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.error || 'Failed to create pass'); }
  };

  const handleRevoke = (id: string) => {
    Alert.alert('Revoke Pass', 'This will invalidate the visitor pass.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => { await api.revokePass(id); fetchPasses(); } },
    ]);
  };

  const renderPass = ({ item, index }: { item: Pass; index: number }) => {
    const status = statusConfig[item.status];
    const variant = item.status === 'active' ? 'success' : item.status === 'revoked' ? 'danger' : 'default';
    const isExpanded = expandedOtp === item.id;
    const validUntil = new Date(item.validUntil).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return (
      <AnimatedEntry direction="left" delay={index * 80}>
        <GlowCard variant={variant} style={styles.passCard}>
          <TouchableOpacity onPress={() => setExpandedOtp(isExpanded ? null : item.id)} activeOpacity={0.7}>
            <View style={styles.passHeader}>
              <View style={styles.passInfo}>
                <Text style={styles.passName}>{item.visitorName}</Text>
                <Text style={styles.passPhone}>{item.visitorPhone}</Text>
                <Text style={styles.passValidity}>Valid until {validUntil}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
              </View>
            </View>

            {isExpanded && item.status === 'active' && (
              <AnimatedEntry direction="fade" duration={300}>
                <View style={styles.otpBox}>
                  <Text style={styles.otpLabel}>OTP</Text>
                  <Text style={styles.otpCode}>{item.otp}</Text>
                </View>
                <View style={styles.revokeWrap}>
                  <GradientButton title="Revoke" icon="close-circle" variant="danger" onPress={() => handleRevoke(item.id)} />
                </View>
              </AnimatedEntry>
            )}
          </TouchableOpacity>
        </GlowCard>
      </AnimatedEntry>
    );
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <FlatList
        data={passes}
        keyExtractor={(p) => p.id}
        refreshing={loading}
        onRefresh={fetchPasses}
        contentContainerStyle={styles.list}
        renderItem={renderPass}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="ticket-account" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No visitor passes</Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.fabWrap} onPress={() => setShowForm(true)} activeOpacity={0.8}>
        <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.fab}>
          <MaterialCommunityIcons name="plus" size={28} color={colors.white} />
        </LinearGradient>
      </TouchableOpacity>

      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <GlowCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Visitor Pass</Text>
            <TextInput style={styles.input} placeholder="Visitor name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Visitor phone" placeholderTextColor={colors.textMuted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Text style={styles.durationLabel}>DURATION</Text>
            <View style={styles.durationChips}>
              {DURATION_OPTIONS.map((h) => (
                <TouchableOpacity key={h} onPress={() => setHours(h)}>
                  {hours === h ? (
                    <LinearGradient colors={colors.gradientAccent as [string, string]} style={styles.durationChip}>
                      <Text style={styles.durationChipTextActive}>{h}h</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.durationChipInactive}>
                      <Text style={styles.durationChipText}>{h}h</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <GradientButton title="Cancel" variant="danger" onPress={() => setShowForm(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <GradientButton title="Create" variant="success" icon="ticket-account" onPress={handleCreate} />
              </View>
            </View>
          </GlowCard>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: 100 },
  passCard: { marginBottom: spacing.md },
  passHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  passInfo: { flex: 1, gap: 2 },
  passName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  passPhone: { fontSize: 13, color: colors.textMuted },
  passValidity: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: '700' },
  otpBox: { marginTop: spacing.lg, backgroundColor: colors.infoBg, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center' },
  otpLabel: { fontSize: 11, color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.xs },
  otpCode: { fontSize: 28, fontWeight: '800', color: colors.info, letterSpacing: 4, fontFamily: 'monospace' },
  revokeWrap: { marginTop: spacing.md },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md,
  },
  durationLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm },
  durationChips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  durationChip: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.pill },
  durationChipInactive: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  durationChipText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  durationChipTextActive: { color: colors.white, fontSize: 14, fontWeight: '600' },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/PassesScreen.tsx
git commit -m "feat(resident-app): redesign PassesScreen with Gradient Glow theme"
```

---

### Task 7: Redesign NotificationsScreen

**Files:**
- Modify: `apps/resident-app/src/screens/NotificationsScreen.tsx`

- [ ] **Step 1: Rewrite NotificationsScreen.tsx**

Replace the full contents of `apps/resident-app/src/screens/NotificationsScreen.tsx` with:

```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { getEvents } from '../api/client';

interface Notification {
  id: string;
  visitorName: string;
  gate: string;
  timestamp: string;
  type: string;
}

export default function NotificationsScreen() {
  const [events, setEvents] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEvents = async () => {
    setLoading(true);
    try { const res = await getEvents({ limit: '50' }); setEvents(res.data.data || []); } finally { setLoading(false); }
  };

  useEffect(() => { fetchEvents(); }, []);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchEvents} tintColor={colors.info} />}
        renderItem={({ item, index }) => (
          <AnimatedEntry direction="left" delay={index * 60}>
            <GlowCard style={styles.card}>
              <View style={styles.row}>
                <IconBadge
                  icon={item.type === 'gate' ? 'gate' : 'car'}
                  color={colors.info}
                  gradientColors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)']}
                  size={32}
                />
                <View style={styles.info}>
                  <Text style={styles.name}>{item.visitorName}</Text>
                  <Text style={styles.gate}>{item.gate}</Text>
                </View>
                <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
              </View>
            </GlowCard>
          </AnimatedEntry>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="bell-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No notifications yet</Text>
          </View>
        }
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  gate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  time: { fontSize: 11, color: colors.textSecondary },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/screens/NotificationsScreen.tsx
git commit -m "feat(resident-app): redesign NotificationsScreen with Gradient Glow theme"
```

---

### Task 8: Redesign entry point with gradient tab bar

**Files:**
- Modify: `apps/resident-app/app/index.tsx`

- [ ] **Step 1: Rewrite app/index.tsx**

Replace the full contents of `apps/resident-app/app/index.tsx` with:

```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/authStore';
import { colors } from '../src/theme/colors';
import { spacing } from '../src/theme/spacing';
import LoginScreen from '../src/screens/LoginScreen';
import HomeScreen from '../src/screens/HomeScreen';
import VehiclesScreen from '../src/screens/VehiclesScreen';
import PassesScreen from '../src/screens/PassesScreen';
import NotificationsScreen from '../src/screens/NotificationsScreen';

type TabKey = 'home' | 'vehicles' | 'passes' | 'notifications';

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'vehicles', label: 'Vehicles', icon: 'car' },
  { key: 'passes', label: 'Passes', icon: 'ticket-account' },
  { key: 'notifications', label: 'Alerts', icon: 'bell' },
];

function TabBar({ active, onSelect }: { active: TabKey; onSelect: (key: TabKey) => void }) {
  return (
    <View style={tabStyles.bar}>
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <TouchableOpacity key={tab.key} style={tabStyles.tab} onPress={() => onSelect(tab.key)} activeOpacity={0.7}>
            {isActive && (
              <LinearGradient
                colors={colors.gradientPrimary as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={tabStyles.indicator}
              />
            )}
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={22}
              color={isActive ? colors.textPrimary : colors.textMuted}
            />
            <Text style={[tabStyles.label, isActive && tabStyles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ResidentApp() {
  const [tab, setTab] = useState<TabKey>('home');
  const logout = useAuthStore((s) => s.logout);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      {/* Header */}
      <View style={headerStyles.header}>
        <Text style={headerStyles.title}>CommunityGate</Text>
        <TouchableOpacity onPress={logout}>
          <MaterialCommunityIcons name="logout" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen />}
        {tab === 'vehicles' && <VehiclesScreen />}
        {tab === 'passes' && <PassesScreen />}
        {tab === 'notifications' && <NotificationsScreen />}
      </View>

      {/* Tab Bar */}
      <TabBar active={tab} onSelect={setTab} />
    </View>
  );
}

export default function Page() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  useEffect(() => { rehydrate(); }, []);

  if (isLoading) {
    return (
      <LinearGradient colors={colors.gradientBg} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.info} />
      </LinearGradient>
    );
  }

  return isAuthenticated ? <ResidentApp /> : <LoginScreen />;
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing.sm,
    gap: 2,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: '20%',
    right: '20%',
    height: 2,
    borderRadius: 1,
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  labelActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
});

const headerStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/app/index.tsx
git commit -m "feat(resident-app): redesign entry point with gradient tab bar"
```

---

### Task 9: Visual smoke test

- [ ] **Step 1: Start the Resident App**

```bash
cd apps/resident-app && npx expo start --web --port 8082
```

- [ ] **Step 2: Verify Login Screen**

Open http://localhost:8082. Verify:
- Gradient background, phone icon in gradient circle
- "CommunityGate" + "RESIDENT LOGIN" heading
- Phone input with phone icon, glowing focus border
- "Send OTP" gradient button

- [ ] **Step 3: Verify all tabs**

Login (use a phone number from the residents table + OTP from API logs). Verify:
- Home: gradient background, wave greeting, stat GlowCards, recent entries
- Vehicles: vehicle GlowCards with PlateText + icons, gradient FAB, modal with gradient chips
- Passes: pass GlowCards with status badges, collapsible OTP, gradient FAB
- Notifications: event GlowCards with icons, pull-to-refresh
- Tab bar: gradient indicator on active tab, icons throughout
