# Guard App Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Guard App's multi-screen stack navigation with a single-screen three-panel workstation optimized for fast approve/deny decisions on a landscape Android tablet.

**Architecture:** Pure frontend rewrite — no backend changes. The existing WebSocket events, API endpoints, and stores are reused. The queueStore gets priority sorting and shift stats. Four old screens (Queue, Approve, OTPVerify, Incident) are replaced by one WorkstationScreen composed of three panel components (ActionZone, LiveFeed, ToolsPanel), each built from focused sub-components.

**Tech Stack:** React Native (Expo 52), Zustand, Socket.io-client, expo-linear-gradient, react-native-reanimated, MaterialCommunityIcons. Existing dark Gradient Glow theme.

---

## File Structure

### Modified:

| File | Responsibility |
|------|---------------|
| `src/store/queueStore.ts` | Add priority sorting, pending/feed selectors, shift stats tracking |
| `app/index.tsx` | Render WorkstationScreen instead of QueueScreen |
| `App.tsx` | Simplify to re-export from expo-router |

### New:

| File | Responsibility |
|------|---------------|
| `src/components/FeedItem.tsx` | Single event row in the live feed |
| `src/components/OTPInput.tsx` | Compact 6-digit input with auto-advance |
| `src/components/ShiftStats.tsx` | Shift duration timer + event counters |
| `src/components/IncidentForm.tsx` | Inline expandable incident report form |
| `src/components/ActionZone.tsx` | Left panel — pending vehicle + action buttons + register form |
| `src/components/LiveFeed.tsx` | Center panel — scrolling event timeline |
| `src/components/ToolsPanel.tsx` | Right panel — gate status, OTP, stats, incidents |
| `src/screens/WorkstationScreen.tsx` | Three-panel layout with header bar |

### Deleted:

| File | Reason |
|------|--------|
| `src/screens/QueueScreen.tsx` | Replaced by WorkstationScreen |
| `src/screens/ApproveScreen.tsx` | Inline in ActionZone |
| `src/screens/OTPVerifyScreen.tsx` | Inline in ToolsPanel |
| `src/screens/IncidentScreen.tsx` | Inline in ToolsPanel |

---

## Task 1: Queue Store — Priority Sorting + Shift Stats

**Files:**
- Modify: `apps/guard-app/src/store/queueStore.ts`

- [ ] **Step 1: Rewrite queueStore with selectors and shift stats**

Replace the entire file `apps/guard-app/src/store/queueStore.ts`:

```typescript
import { create } from 'zustand';

export interface QueueEntry {
  id: string;
  plate: string;
  method: 'anpr' | 'rfid' | 'fastag' | 'otp' | 'manual';
  decision: 'allow' | 'deny' | 'guard_review';
  reason?: string;
  timestamp: string;
  snapshot?: string;
  fastagTidHash?: string;
  unitNumber?: string;
  residentName?: string;
  autoPaired?: boolean;
  alertType?: 'unknown_vehicle' | 'auto_paired' | 'fastag_mismatch';
}

function priorityScore(entry: QueueEntry): number {
  if (entry.decision === 'deny') return 0; // blacklisted — highest
  if (entry.alertType === 'fastag_mismatch') return 1;
  if (entry.decision === 'guard_review') return 2;
  return 3; // allow — lowest priority for action
}

interface ShiftStats {
  shiftStart: string;
  totalEntries: number;
  totalDenied: number;
  totalVisitors: number;
}

interface QueueState {
  entries: QueueEntry[];
  shiftStats: ShiftStats;
  addEntry: (entry: QueueEntry) => void;
  removeEntry: (id: string) => void;
  clearQueue: () => void;
  resetShift: () => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  entries: [],
  shiftStats: {
    shiftStart: new Date().toISOString(),
    totalEntries: 0,
    totalDenied: 0,
    totalVisitors: 0,
  },

  addEntry: (entry) =>
    set((s) => {
      const newEntries = [entry, ...s.entries].slice(0, 50);
      const stats = { ...s.shiftStats };
      stats.totalEntries += 1;
      if (entry.decision === 'deny') stats.totalDenied += 1;
      if (entry.method === 'otp') stats.totalVisitors += 1;
      return { entries: newEntries, shiftStats: stats };
    }),

  removeEntry: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

  clearQueue: () => set({ entries: [] }),

  resetShift: () =>
    set({
      shiftStats: {
        shiftStart: new Date().toISOString(),
        totalEntries: 0,
        totalDenied: 0,
        totalVisitors: 0,
      },
    }),
}));

// Selectors
export function selectPendingEntries(entries: QueueEntry[]): QueueEntry[] {
  return entries
    .filter((e) => e.decision === 'guard_review' || e.decision === 'deny')
    .sort((a, b) => priorityScore(a) - priorityScore(b));
}

export function selectFeedEntries(entries: QueueEntry[]): QueueEntry[] {
  return entries;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/store/queueStore.ts
git commit -m "feat: add priority sorting + shift stats to guard queue store"
```

---

## Task 2: FeedItem Component

**Files:**
- Create: `apps/guard-app/src/components/FeedItem.tsx`

- [ ] **Step 1: Create FeedItem component**

Create `apps/guard-app/src/components/FeedItem.tsx`:

```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import PlateText from './PlateText';
import type { QueueEntry } from '../store/queueStore';

const methodConfig: Record<string, { color: string; label: string; icon: string }> = {
  anpr: { color: '#3b82f6', label: 'ANPR', icon: 'camera' },
  rfid: { color: '#8b5cf6', label: 'RFID', icon: 'card-bulleted' },
  fastag: { color: '#06b6d4', label: 'FASTag', icon: 'car-wireless' },
  otp: { color: '#c084fc', label: 'OTP', icon: 'numeric' },
  manual: { color: colors.warning, label: 'Manual', icon: 'account' },
};

const decisionConfig: Record<string, { color: string; label: string }> = {
  allow: { color: colors.success, label: 'ALLOWED' },
  deny: { color: colors.danger, label: 'DENIED' },
  guard_review: { color: colors.warning, label: 'REVIEW' },
};

function getVariant(entry: QueueEntry): 'default' | 'danger' | 'success' {
  if (entry.decision === 'deny') return 'danger';
  if (entry.alertType === 'auto_paired') return 'success';
  return 'default';
}

export default function FeedItem({ entry }: { entry: QueueEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const method = methodConfig[entry.method] || methodConfig.manual;
  const decision = decisionConfig[entry.decision] || decisionConfig.deny;
  const isEntry = true; // gate events are entries by default in current system

  return (
    <GlowCard variant={getVariant(entry)} style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.time}>{time}</Text>
        <MaterialCommunityIcons
          name={isEntry ? 'arrow-down-circle' : 'arrow-up-circle'}
          size={16}
          color={isEntry ? colors.success : colors.danger}
        />
        <PlateText plate={entry.plate} size="sm" />
        <View style={[styles.pill, { backgroundColor: method.color + '20' }]}>
          <Text style={[styles.pillText, { color: method.color }]}>{method.label}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: decision.color + '20' }]}>
          <Text style={[styles.pillText, { color: decision.color }]}>{decision.label}</Text>
        </View>
      </View>
      {entry.residentName ? (
        <Text style={styles.resident} numberOfLines={1}>{entry.residentName}</Text>
      ) : null}
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.xs, padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, width: 55 },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontSize: 9, fontWeight: '700' },
  resident: { fontSize: 11, color: colors.textMuted, marginTop: 2, marginLeft: 55 + spacing.sm },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/components/FeedItem.tsx
git commit -m "feat: add FeedItem component for live event feed"
```

---

## Task 3: OTPInput Component

**Files:**
- Create: `apps/guard-app/src/components/OTPInput.tsx`

- [ ] **Step 1: Create OTPInput component**

Create `apps/guard-app/src/components/OTPInput.tsx`:

```typescript
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
      // Auto-reset after 10 seconds
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/components/OTPInput.tsx
git commit -m "feat: add compact OTPInput component with verify + open gate"
```

---

## Task 4: ShiftStats Component

**Files:**
- Create: `apps/guard-app/src/components/ShiftStats.tsx`

- [ ] **Step 1: Create ShiftStats component**

Create `apps/guard-app/src/components/ShiftStats.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import GlowCard from './GlowCard';
import { useQueueStore } from '../store/queueStore';

function formatDuration(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ShiftStats() {
  const stats = useQueueStore((s) => s.shiftStats);
  const [duration, setDuration] = useState(formatDuration(stats.shiftStart));

  useEffect(() => {
    const interval = setInterval(() => {
      setDuration(formatDuration(stats.shiftStart));
    }, 60000);
    return () => clearInterval(interval);
  }, [stats.shiftStart]);

  return (
    <GlowCard style={styles.container}>
      <Text style={styles.label}>SHIFT</Text>
      <Text style={styles.since}>On since {formatTime(stats.shiftStart)} · {duration}</Text>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{stats.totalEntries}</Text>
          <Text style={styles.statLabel}>Entries</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={[styles.statNumber, { color: colors.danger }]}>{stats.totalDenied}</Text>
          <Text style={styles.statLabel}>Denied</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={[styles.statNumber, { color: colors.info }]}>{stats.totalVisitors}</Text>
          <Text style={styles.statLabel}>Visitors</Text>
        </View>
      </View>
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  container: {},
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.xs },
  since: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center' },
  statNumber: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  statLabel: { fontSize: 9, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
  divider: { width: 1, height: 28, backgroundColor: colors.surfaceBorder },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/components/ShiftStats.tsx
git commit -m "feat: add ShiftStats component with live duration timer"
```

---

## Task 5: IncidentForm Component

**Files:**
- Create: `apps/guard-app/src/components/IncidentForm.tsx`

- [ ] **Step 1: Create IncidentForm component**

Create `apps/guard-app/src/components/IncidentForm.tsx`:

```typescript
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import { createIncident } from '../api/client';
import { useAuthStore } from '../store/authStore';

const INCIDENT_TYPES = [
  { key: 'unauthorized_entry', label: 'Unauthorized', icon: 'account-alert' },
  { key: 'tailgating', label: 'Tailgating', icon: 'car-multiple' },
  { key: 'suspicious_person', label: 'Suspicious', icon: 'eye' },
  { key: 'vehicle_damage', label: 'Damage', icon: 'car-wrench' },
  { key: 'equipment_malfunction', label: 'Equipment', icon: 'cog-off' },
  { key: 'other', label: 'Other', icon: 'dots-horizontal' },
];

export default function IncidentForm() {
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const [expanded, setExpanded] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setSelectedType('');
    setDescription('');
    setExpanded(false);
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!selectedType || !gateId) return;
    setLoading(true);
    try {
      await createIncident({ type: selectedType, description: description.trim(), gateId });
      Alert.alert('Incident Logged', 'Report submitted successfully.');
      resetForm();
    } catch {
      Alert.alert('Error', 'Failed to submit incident');
      setLoading(false);
    }
  };

  if (!expanded) {
    return (
      <TouchableOpacity onPress={() => setExpanded(true)} activeOpacity={0.7}>
        <GlowCard variant="warning" style={styles.button}>
          <View style={styles.buttonRow}>
            <MaterialCommunityIcons name="alert-circle" size={18} color={colors.warning} />
            <Text style={styles.buttonText}>Log Incident</Text>
          </View>
        </GlowCard>
      </TouchableOpacity>
    );
  }

  return (
    <GlowCard variant="warning" style={styles.container}>
      <Text style={styles.label}>LOG INCIDENT</Text>
      <View style={styles.chipGrid}>
        {INCIDENT_TYPES.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => setSelectedType(t.key)}>
            {selectedType === t.key ? (
              <LinearGradient colors={colors.gradientDanger as [string, string]} style={styles.chip}>
                <MaterialCommunityIcons name={t.icon as any} size={14} color={colors.white} />
                <Text style={styles.chipTextActive}>{t.label}</Text>
              </LinearGradient>
            ) : (
              <View style={styles.chipInactive}>
                <MaterialCommunityIcons name={t.icon as any} size={14} color={colors.textMuted} />
                <Text style={styles.chipText}>{t.label}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder="Description (optional)"
        placeholderTextColor={colors.textMuted}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <GradientButton title="Cancel" variant="danger" onPress={resetForm} />
        </View>
        <View style={{ flex: 1 }}>
          <GradientButton title="Submit" variant="primary" icon="send" onPress={handleSubmit} loading={loading} disabled={!selectedType} />
        </View>
      </View>
    </GlowCard>
  );
}

const styles = StyleSheet.create({
  container: {},
  button: {},
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  buttonText: { color: colors.warning, fontSize: 14, fontWeight: '700' },
  label: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill,
  },
  chipInactive: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
  },
  chipText: { color: colors.textMuted, fontSize: 11 },
  chipTextActive: { color: colors.white, fontSize: 11, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.sm, fontSize: 13, color: colors.textPrimary, marginBottom: spacing.md, minHeight: 60,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/components/IncidentForm.tsx
git commit -m "feat: add inline IncidentForm component with type chips"
```

---

## Task 6: ActionZone Component (Left Panel)

**Files:**
- Create: `apps/guard-app/src/components/ActionZone.tsx`

- [ ] **Step 1: Create ActionZone component**

Create `apps/guard-app/src/components/ActionZone.tsx`:

```typescript
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import PlateText from './PlateText';
import IconBadge from './IconBadge';
import AnimatedEntry from './AnimatedEntry';
import { useQueueStore, selectPendingEntries, type QueueEntry } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';
import { sendGateCommand, registerVehicleAtGate } from '../api/client';

const methodIcons: Record<string, { icon: string; color: string; gradient: readonly [string, string] }> = {
  anpr: { icon: 'camera', color: '#3b82f6', gradient: ['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)'] },
  rfid: { icon: 'card-bulleted', color: '#8b5cf6', gradient: ['rgba(139,92,246,0.3)', 'rgba(168,85,247,0.1)'] },
  fastag: { icon: 'car-wireless', color: '#06b6d4', gradient: ['rgba(6,182,212,0.3)', 'rgba(20,184,166,0.1)'] },
  otp: { icon: 'numeric', color: '#c084fc', gradient: ['rgba(168,85,247,0.3)', 'rgba(139,92,246,0.1)'] },
  manual: { icon: 'account', color: colors.warning, gradient: ['rgba(251,191,36,0.3)', 'rgba(245,158,11,0.1)'] },
};

export default function ActionZone() {
  const entries = useQueueStore((s) => s.entries);
  const removeEntry = useQueueStore((s) => s.removeEntry);
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const [showRegister, setShowRegister] = useState(false);
  const [unitNumber, setUnitNumber] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const pending = selectPendingEntries(entries);
  const current = pending[0] || null;

  const handleApprove = async () => {
    if (!current || !gateId) return;
    setActionLoading(true);
    try {
      await sendGateCommand(gateId, 'open');
      removeEntry(current.id);
    } catch {
      Alert.alert('Error', 'Failed to open gate');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeny = async () => {
    if (!current || !gateId) return;
    setActionLoading(true);
    try {
      await sendGateCommand(gateId, 'deny');
      removeEntry(current.id);
    } catch {
      Alert.alert('Error', 'Failed to send deny command');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!current || !unitNumber.trim()) return;
    setActionLoading(true);
    try {
      await registerVehicleAtGate({
        community_id: '', // extracted from JWT on server side
        plate: current.plate,
        unit_number: unitNumber.trim(),
        fastag_tid_hash: current.fastagTidHash,
      });
      await sendGateCommand(gateId, 'open');
      removeEntry(current.id);
      setShowRegister(false);
      setUnitNumber('');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error || 'Registration failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Empty state
  if (!current) {
    return (
      <View style={styles.container}>
        <AnimatedEntry direction="fade">
          <GlowCard variant="success" style={styles.emptyCard}>
            <MaterialCommunityIcons name="check-circle" size={48} color={colors.success} />
            <Text style={styles.emptyTitle}>All Clear</Text>
            <Text style={styles.emptySubtext}>No vehicles pending review</Text>
          </GlowCard>
        </AnimatedEntry>
      </View>
    );
  }

  const method = methodIcons[current.method] || methodIcons.manual;
  const isUnknown = !current.residentName && !current.unitNumber;
  const showRegisterButton = isUnknown && (current.method === 'fastag' || current.method === 'anpr');
  const time = new Date(current.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.container}>
      {/* Pending count */}
      <Text style={styles.pendingCount}>{pending.length} pending</Text>

      <AnimatedEntry direction="left" duration={300}>
        <GlowCard style={styles.vehicleCard}>
          {/* Alert banners */}
          {current.decision === 'deny' && current.reason && (
            <View style={[styles.alertBanner, { backgroundColor: colors.dangerBg }]}>
              <MaterialCommunityIcons name="alert" size={16} color={colors.danger} />
              <Text style={[styles.alertText, { color: colors.danger }]}>BLACKLISTED — {current.reason}</Text>
            </View>
          )}
          {current.alertType === 'fastag_mismatch' && (
            <View style={[styles.alertBanner, { backgroundColor: colors.warningBg }]}>
              <MaterialCommunityIcons name="alert" size={16} color={colors.warning} />
              <Text style={[styles.alertText, { color: colors.warning }]}>FASTag mismatch — different tag</Text>
            </View>
          )}
          {current.alertType === 'auto_paired' && (
            <View style={[styles.alertBanner, { backgroundColor: 'rgba(6,182,212,0.15)' }]}>
              <MaterialCommunityIcons name="information" size={16} color="#06b6d4" />
              <Text style={[styles.alertText, { color: '#06b6d4' }]}>FASTag auto-paired</Text>
            </View>
          )}

          {/* Vehicle info */}
          <View style={styles.vehicleRow}>
            <IconBadge icon={method.icon as any} color={method.color} gradientColors={method.gradient} size={44} />
            <View style={styles.vehicleInfo}>
              <PlateText plate={current.plate} size="lg" />
              {current.residentName && current.unitNumber && (
                <Text style={styles.residentText}>Unit {current.unitNumber} · {current.residentName}</Text>
              )}
              <Text style={styles.timeText}>{time} · {method.icon === 'camera' ? 'ANPR' : current.method.toUpperCase()}</Text>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <GradientButton title="Approve" icon="check-circle" variant="success" onPress={handleApprove} loading={actionLoading} />
            <GradientButton title="Deny" icon="close-circle" variant="danger" onPress={handleDeny} loading={actionLoading} />
            {showRegisterButton && !showRegister && (
              <GradientButton title="Approve + Register" icon="car-plus" variant="primary" onPress={() => setShowRegister(true)} />
            )}
          </View>

          {/* Inline register form */}
          {showRegister && (
            <AnimatedEntry direction="fade" duration={200}>
              <View style={styles.registerForm}>
                <Text style={styles.registerLabel}>REGISTER VEHICLE</Text>
                <TextInput
                  style={styles.registerInput}
                  placeholder="Unit number"
                  placeholderTextColor={colors.textMuted}
                  value={unitNumber}
                  onChangeText={setUnitNumber}
                />
                <View style={styles.registerActions}>
                  <View style={{ flex: 1 }}>
                    <GradientButton title="Cancel" variant="danger" onPress={() => { setShowRegister(false); setUnitNumber(''); }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GradientButton title="Register & Open" icon="check-circle" variant="success" onPress={handleRegister} loading={actionLoading} disabled={!unitNumber.trim()} />
                  </View>
                </View>
              </View>
            </AnimatedEntry>
          )}
        </GlowCard>
      </AnimatedEntry>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md },
  pendingCount: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  vehicleCard: {},
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, marginBottom: spacing.md },
  alertText: { fontSize: 12, fontWeight: '700', flex: 1 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  vehicleInfo: { flex: 1, gap: spacing.xs },
  residentText: { fontSize: 14, color: colors.textSecondary },
  timeText: { fontSize: 12, color: colors.textMuted },
  actions: { gap: spacing.sm },
  registerForm: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
  registerLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  registerInput: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.sm,
  },
  registerActions: { flexDirection: 'row', gap: spacing.sm },
  emptyCard: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing['3xl'] },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.success },
  emptySubtext: { fontSize: 13, color: colors.textMuted },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/components/ActionZone.tsx
git commit -m "feat: add ActionZone component with approve/deny/register"
```

---

## Task 7: LiveFeed Component (Center Panel)

**Files:**
- Create: `apps/guard-app/src/components/LiveFeed.tsx`

- [ ] **Step 1: Create LiveFeed component**

Create `apps/guard-app/src/components/LiveFeed.tsx`:

```typescript
import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import AnimatedEntry from './AnimatedEntry';
import FeedItem from './FeedItem';
import { useQueueStore, selectFeedEntries } from '../store/queueStore';

export default function LiveFeed() {
  const entries = useQueueStore((s) => s.entries);
  const feed = selectFeedEntries(entries);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LIVE FEED</Text>
      <FlatList
        data={feed}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <AnimatedEntry direction="fade" delay={index < 5 ? index * 60 : 0} duration={300}>
            <FeedItem entry={item} />
          </AnimatedEntry>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="antenna" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>Waiting for events...</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md },
  title: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.sm },
  list: { paddingBottom: spacing.lg },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: spacing['5xl'] },
  emptyText: { color: colors.textMuted, fontSize: 13 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/components/LiveFeed.tsx
git commit -m "feat: add LiveFeed component for real-time event timeline"
```

---

## Task 8: ToolsPanel Component (Right Panel)

**Files:**
- Create: `apps/guard-app/src/components/ToolsPanel.tsx`

- [ ] **Step 1: Create ToolsPanel component**

Create `apps/guard-app/src/components/ToolsPanel.tsx`:

```typescript
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import GlowCard from './GlowCard';
import GradientButton from './GradientButton';
import OTPInput from './OTPInput';
import ShiftStats from './ShiftStats';
import IncidentForm from './IncidentForm';
import { useAuthStore } from '../store/authStore';
import { sendGateCommand } from '../api/client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MUTE_KEY = 'communitygate_guard_muted';

export default function ToolsPanel() {
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const [muted, setMuted] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);

  // Load mute state on mount
  React.useEffect(() => {
    AsyncStorage.getItem(MUTE_KEY).then((v) => { if (v === '1') setMuted(true); });
  }, []);

  const toggleMute = () => {
    const newVal = !muted;
    setMuted(newVal);
    AsyncStorage.setItem(MUTE_KEY, newVal ? '1' : '0').catch(() => {});
  };

  const handleManualGate = async (action: string) => {
    if (!gateId) return;
    setGateLoading(true);
    try {
      await sendGateCommand(gateId, action);
    } catch {
      Alert.alert('Error', `Failed to ${action} gate`);
    } finally {
      setGateLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Gate Status */}
      <GlowCard style={styles.gateCard}>
        <View style={styles.gateHeader}>
          <View style={styles.gateStatus}>
            <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
            <Text style={styles.gateLabel}>GATE CONTROLS</Text>
          </View>
          <TouchableOpacity onPress={toggleMute}>
            <MaterialCommunityIcons
              name={muted ? 'bell-off' : 'bell'}
              size={20}
              color={muted ? colors.textMuted : colors.warning}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.gateButtons}>
          <View style={{ flex: 1 }}>
            <GradientButton title="Open" icon="gate" variant="success" onPress={() => handleManualGate('open')} loading={gateLoading} />
          </View>
          <View style={{ flex: 1 }}>
            <GradientButton title="Close" icon="gate" variant="danger" onPress={() => handleManualGate('close')} loading={gateLoading} />
          </View>
        </View>
      </GlowCard>

      {/* OTP Verify */}
      <OTPInput />

      {/* Shift Stats */}
      <ShiftStats />

      {/* Incident */}
      <IncidentForm />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  gateCard: {},
  gateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  gateStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  gateLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  gateButtons: { flexDirection: 'row', gap: spacing.sm },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/components/ToolsPanel.tsx
git commit -m "feat: add ToolsPanel with gate controls, OTP, stats, incidents"
```

---

## Task 9: WorkstationScreen

**Files:**
- Create: `apps/guard-app/src/screens/WorkstationScreen.tsx`

- [ ] **Step 1: Create WorkstationScreen with three-panel layout**

Create `apps/guard-app/src/screens/WorkstationScreen.tsx`:

```typescript
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import ActionZone from '../components/ActionZone';
import LiveFeed from '../components/LiveFeed';
import ToolsPanel from '../components/ToolsPanel';
import { useAuthStore } from '../store/authStore';
import { useQueueStore } from '../store/queueStore';

export default function WorkstationScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const totalEntries = useQueueStore((s) => s.shiftStats.totalEntries);
  const shiftStart = useQueueStore((s) => s.shiftStats.shiftStart);

  const shiftTime = new Date(shiftStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleLogout = () => {
    Alert.alert('End Shift', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
          <Text style={styles.gateName}>Main Gate</Text>
        </View>
        <Text style={styles.shiftInfo}>On since {shiftTime} · {totalEntries} events</Text>
        <View style={styles.headerRight}>
          <Text style={styles.guardName}>{user?.name || 'Guard'}</Text>
          <TouchableOpacity onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={20} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Three panels */}
      <View style={styles.panels}>
        <View style={styles.leftPanel}>
          <ActionZone />
        </View>
        <View style={styles.divider} />
        <View style={styles.centerPanel}>
          <LiveFeed />
        </View>
        <View style={styles.divider} />
        <View style={styles.rightPanel}>
          <ToolsPanel />
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  gateName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  shiftInfo: { fontSize: 12, color: colors.textMuted, flex: 1, textAlign: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1, justifyContent: 'flex-end' },
  guardName: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  panels: { flex: 1, flexDirection: 'row' },
  leftPanel: { flex: 35 },
  centerPanel: { flex: 35 },
  rightPanel: { flex: 30 },
  divider: { width: 1, backgroundColor: colors.surfaceBorder },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/screens/WorkstationScreen.tsx
git commit -m "feat: add WorkstationScreen with three-panel layout + header"
```

---

## Task 10: Wire Up Navigation + Cleanup

**Files:**
- Modify: `apps/guard-app/app/index.tsx`
- Modify: `apps/guard-app/App.tsx`
- Delete: `apps/guard-app/src/screens/QueueScreen.tsx`
- Delete: `apps/guard-app/src/screens/ApproveScreen.tsx`
- Delete: `apps/guard-app/src/screens/OTPVerifyScreen.tsx`
- Delete: `apps/guard-app/src/screens/IncidentScreen.tsx`

- [ ] **Step 1: Rewrite app/index.tsx to use WorkstationScreen**

Replace the entire file `apps/guard-app/app/index.tsx`:

```typescript
import React, { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../src/store/authStore';
import { useQueueStore, type QueueEntry } from '../src/store/queueStore';
import { getSocket } from '../src/api/socket';
import { colors } from '../src/theme/colors';
import LoginScreen from '../src/screens/LoginScreen';
import WorkstationScreen from '../src/screens/WorkstationScreen';

function AuthenticatedApp() {
  const addEntry = useQueueStore((s) => s.addEntry);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleEvent = (data: {
      id: string;
      gateId: string;
      detectionMethod: string;
      rawValue: string;
      accessDecision: string;
      denyReason?: string;
      matchedUnitNumber?: string;
      residentName?: string;
      anprConfidence?: number;
      fastagTidHash?: string;
      autoPaired?: boolean;
      alertType?: string;
      eventTs: string;
    }) => {
      const entry: QueueEntry = {
        id: data.id,
        plate: data.rawValue || 'Unknown',
        method: data.detectionMethod as QueueEntry['method'],
        decision: data.accessDecision as QueueEntry['decision'],
        reason: data.denyReason || undefined,
        timestamp: data.eventTs,
        fastagTidHash: data.fastagTidHash,
        unitNumber: data.matchedUnitNumber,
        residentName: data.residentName,
        autoPaired: data.autoPaired,
        alertType: data.alertType as QueueEntry['alertType'],
      };
      addEntry(entry);
    };

    socket.on('gate:event', handleEvent);
    socket.on('fastag:paired', (data: { plate: string; unitNumber: string }) => {
      addEntry({
        id: `paired-${Date.now()}`,
        plate: data.plate,
        method: 'fastag',
        decision: 'allow',
        timestamp: new Date().toISOString(),
        alertType: 'auto_paired',
        unitNumber: data.unitNumber,
      });
    });
    socket.on('fastag:mismatch', (data: { plate: string; rawValue: string }) => {
      addEntry({
        id: `mismatch-${Date.now()}`,
        plate: data.plate || data.rawValue,
        method: 'fastag',
        decision: 'guard_review',
        reason: 'FASTag mismatch — different tag for known vehicle',
        timestamp: new Date().toISOString(),
        alertType: 'fastag_mismatch',
      });
    });
    return () => {
      socket.off('gate:event', handleEvent);
      socket.off('fastag:paired');
      socket.off('fastag:mismatch');
    };
  }, [addEntry]);

  return <WorkstationScreen />;
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

  return isAuthenticated ? <AuthenticatedApp /> : <LoginScreen />;
}
```

- [ ] **Step 2: Simplify App.tsx**

Replace the entire file `apps/guard-app/App.tsx`:

```typescript
// Legacy entry point — the app uses expo-router via app/index.tsx
export { default } from './app/index';
```

- [ ] **Step 3: Delete old screens**

```bash
rm apps/guard-app/src/screens/QueueScreen.tsx
rm apps/guard-app/src/screens/ApproveScreen.tsx
rm apps/guard-app/src/screens/OTPVerifyScreen.tsx
rm apps/guard-app/src/screens/IncidentScreen.tsx
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/guard-app && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (or only pre-existing `process.env` issue).

- [ ] **Step 5: Commit**

```bash
git add -A apps/guard-app/
git commit -m "feat: wire up WorkstationScreen, delete old Queue/Approve/OTP/Incident screens"
```
