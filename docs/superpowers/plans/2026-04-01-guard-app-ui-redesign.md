# Guard App UI Redesign — Gradient Glow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Guard App with a "Gradient Glow" theme — rich gradients, glowing accents, purple-blue palette, smooth animations — while keeping all existing functionality intact.

**Architecture:** Create a theme system (colors + spacing tokens), build 6 reusable components (GlowCard, GradientButton, StatusPill, PlateText, IconBadge, AnimatedEntry), then rewrite each of the 5 screens and the entry point using the new design system. No external UI library — custom components with expo-linear-gradient and react-native-reanimated.

**Tech Stack:** React Native / Expo 52, expo-linear-gradient, react-native-reanimated, @expo/vector-icons (MaterialCommunityIcons), Zustand, TypeScript

---

## File Structure

### Theme (new)
- `apps/guard-app/src/theme/colors.ts` — all color tokens
- `apps/guard-app/src/theme/spacing.ts` — spacing scale + border radius

### Components (new)
- `apps/guard-app/src/components/GlowCard.tsx` — card with gradient border glow
- `apps/guard-app/src/components/GradientButton.tsx` — button with linear gradient
- `apps/guard-app/src/components/StatusPill.tsx` — rounded status indicator
- `apps/guard-app/src/components/PlateText.tsx` — monospace plate display
- `apps/guard-app/src/components/IconBadge.tsx` — icon in gradient circle
- `apps/guard-app/src/components/AnimatedEntry.tsx` — mount animation wrapper

### Screens (rewrite)
- `apps/guard-app/src/screens/LoginScreen.tsx` — gradient glow login
- `apps/guard-app/src/screens/QueueScreen.tsx` — landscape split with glow cards
- `apps/guard-app/src/screens/ApproveScreen.tsx` — overlay with gradient buttons
- `apps/guard-app/src/screens/OTPVerifyScreen.tsx` — individual digit boxes
- `apps/guard-app/src/screens/IncidentScreen.tsx` — gradient chips + glow textarea

### Entry point (modify)
- `apps/guard-app/app/index.tsx` — use redesigned screens, keep auth/socket logic

---

### Task 1: Install dependencies

**Files:**
- Modify: `apps/guard-app/package.json`

- [ ] **Step 1: Install expo-linear-gradient and react-native-reanimated**

```bash
cd apps/guard-app && npx expo install expo-linear-gradient react-native-reanimated
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/package.json pnpm-lock.yaml
git commit -m "chore(guard-app): add expo-linear-gradient and react-native-reanimated"
```

---

### Task 2: Create theme tokens

**Files:**
- Create: `apps/guard-app/src/theme/colors.ts`
- Create: `apps/guard-app/src/theme/spacing.ts`

- [ ] **Step 1: Create colors.ts**

```typescript
// apps/guard-app/src/theme/colors.ts

export const colors = {
  // Backgrounds
  bgPrimary: '#0c1222',
  bgAlt: '#1a1145',
  surface: 'rgba(255,255,255,0.04)',
  surfaceBorder: 'rgba(255,255,255,0.06)',
  surfaceHover: 'rgba(255,255,255,0.08)',

  // Gradients (arrays for LinearGradient)
  gradientPrimary: ['#3b82f6', '#8b5cf6'] as const,
  gradientAccent: ['#a855f7', '#ec4899'] as const,
  gradientSuccess: ['#22c55e', '#10b981'] as const,
  gradientDanger: ['#ef4444', '#dc2626'] as const,
  gradientWarning: ['#f59e0b', '#eab308'] as const,
  gradientBg: ['#0c1222', '#1a1145'] as const,

  // Status
  success: '#34d399',
  successBg: 'rgba(34,197,94,0.2)',
  successBorder: 'rgba(34,197,94,0.15)',
  danger: '#f87171',
  dangerBg: 'rgba(239,68,68,0.2)',
  dangerBorder: 'rgba(239,68,68,0.15)',
  warning: '#fbbf24',
  warningBg: 'rgba(251,191,36,0.2)',
  warningBorder: 'rgba(251,191,36,0.15)',
  info: '#818cf8',
  infoBg: 'rgba(99,102,241,0.2)',

  // Text
  textPrimary: '#e2e8f0',
  textSecondary: '#6366f1',
  textMuted: '#475569',

  // Misc
  white: '#ffffff',
  transparent: 'transparent',
} as const;
```

- [ ] **Step 2: Create spacing.ts**

```typescript
// apps/guard-app/src/theme/spacing.ts

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  pill: 20,
  full: 9999,
} as const;
```

- [ ] **Step 3: Commit**

```bash
git add apps/guard-app/src/theme/
git commit -m "feat(guard-app): add Gradient Glow theme tokens"
```

---

### Task 3: Create reusable components — GlowCard, GradientButton, StatusPill

**Files:**
- Create: `apps/guard-app/src/components/GlowCard.tsx`
- Create: `apps/guard-app/src/components/GradientButton.tsx`
- Create: `apps/guard-app/src/components/StatusPill.tsx`

- [ ] **Step 1: Create GlowCard.tsx**

```typescript
// apps/guard-app/src/components/GlowCard.tsx
import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { radius } from '../theme/spacing';

type Variant = 'default' | 'success' | 'danger' | 'warning';

interface GlowCardProps {
  children: React.ReactNode;
  variant?: Variant;
  style?: ViewStyle;
  onPress?: () => void;
}

const borderColors: Record<Variant, readonly [string, string]> = {
  default: ['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)'],
  success: ['rgba(34,197,94,0.4)', 'rgba(16,185,129,0.1)'],
  danger: ['rgba(239,68,68,0.4)', 'rgba(220,38,38,0.1)'],
  warning: ['rgba(251,191,36,0.4)', 'rgba(245,158,11,0.1)'],
};

export default function GlowCard({ children, variant = 'default', style }: GlowCardProps) {
  return (
    <LinearGradient
      colors={borderColors[variant] as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.border, style]}
    >
      <View style={styles.inner}>
        {children}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  border: {
    borderRadius: radius.lg,
    padding: 1,
  },
  inner: {
    backgroundColor: colors.bgPrimary,
    borderRadius: radius.lg - 1,
    padding: 16,
  },
});
```

- [ ] **Step 2: Create GradientButton.tsx**

```typescript
// apps/guard-app/src/components/GradientButton.tsx
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { colors } from '../theme/colors';
import { radius } from '../theme/spacing';

type Variant = 'primary' | 'success' | 'danger';

interface GradientButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
}

const gradients: Record<Variant, readonly [string, string]> = {
  primary: colors.gradientPrimary,
  success: colors.gradientSuccess,
  danger: colors.gradientDanger,
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function GradientButton({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
}: GradientButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  return (
    <AnimatedTouchable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[animatedStyle, (disabled || loading) && { opacity: 0.5 }]}
      activeOpacity={0.9}
    >
      <LinearGradient
        colors={gradients[variant] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.gradient}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <View style={styles.content}>
            {icon && (
              <MaterialCommunityIcons name={icon} size={20} color={colors.white} style={styles.icon} />
            )}
            <Text style={styles.text}>{title}</Text>
          </View>
        )}
      </LinearGradient>
    </AnimatedTouchable>
  );
}

const styles = StyleSheet.create({
  gradient: {
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
});
```

- [ ] **Step 3: Create StatusPill.tsx**

```typescript
// apps/guard-app/src/components/StatusPill.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

type Status = 'allow' | 'deny' | 'guard_review';
type Size = 'sm' | 'md';

interface StatusPillProps {
  status: Status;
  size?: Size;
}

const statusConfig: Record<Status, { label: string; color: string; bg: string }> = {
  allow: { label: 'ALLOWED', color: colors.success, bg: colors.successBg },
  deny: { label: 'DENIED', color: colors.danger, bg: colors.dangerBg },
  guard_review: { label: 'REVIEW', color: colors.warning, bg: colors.warningBg },
};

export default function StatusPill({ status, size = 'md' }: StatusPillProps) {
  const config = statusConfig[status] || statusConfig.deny;
  const isSmall = size === 'sm';

  return (
    <View style={[styles.pill, { backgroundColor: config.bg }, isSmall && styles.pillSm]}>
      <Text style={[styles.text, { color: config.color }, isSmall && styles.textSm]}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  pillSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textSm: {
    fontSize: 10,
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/guard-app/src/components/GlowCard.tsx apps/guard-app/src/components/GradientButton.tsx apps/guard-app/src/components/StatusPill.tsx
git commit -m "feat(guard-app): add GlowCard, GradientButton, and StatusPill components"
```

---

### Task 4: Create reusable components — PlateText, IconBadge, AnimatedEntry

**Files:**
- Create: `apps/guard-app/src/components/PlateText.tsx`
- Create: `apps/guard-app/src/components/IconBadge.tsx`
- Create: `apps/guard-app/src/components/AnimatedEntry.tsx`

- [ ] **Step 1: Create PlateText.tsx**

```typescript
// apps/guard-app/src/components/PlateText.tsx
import React from 'react';
import { Text, StyleSheet, Platform } from 'react-native';
import { colors } from '../theme/colors';

type Size = 'sm' | 'md' | 'lg';

interface PlateTextProps {
  plate: string;
  size?: Size;
}

const fontSizes: Record<Size, number> = { sm: 14, md: 16, lg: 24 };

export default function PlateText({ plate, size = 'md' }: PlateTextProps) {
  return (
    <Text style={[styles.text, { fontSize: fontSizes[size] }]}>
      {plate}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
```

- [ ] **Step 2: Create IconBadge.tsx**

```typescript
// apps/guard-app/src/components/IconBadge.tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface IconBadgeProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  gradientColors: readonly [string, string];
  size?: number;
}

export default function IconBadge({ icon, color, gradientColors, size = 40 }: IconBadgeProps) {
  return (
    <LinearGradient
      colors={gradientColors as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.container, { width: size, height: size, borderRadius: size * 0.25 }]}
    >
      <MaterialCommunityIcons name={icon} size={size * 0.5} color={color} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

- [ ] **Step 3: Create AnimatedEntry.tsx**

```typescript
// apps/guard-app/src/components/AnimatedEntry.tsx
import React from 'react';
import Animated, { FadeIn, SlideInLeft, SlideInRight, SlideInDown } from 'react-native-reanimated';

type Direction = 'left' | 'right' | 'up' | 'fade';

interface AnimatedEntryProps {
  children: React.ReactNode;
  delay?: number;
  direction?: Direction;
  duration?: number;
}

const animations = {
  left: SlideInLeft,
  right: SlideInRight,
  up: SlideInDown,
  fade: FadeIn,
};

export default function AnimatedEntry({
  children,
  delay = 0,
  direction = 'fade',
  duration = 400,
}: AnimatedEntryProps) {
  const Animation = animations[direction];

  return (
    <Animated.View entering={Animation.delay(delay).duration(duration).springify()}>
      {children}
    </Animated.View>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/guard-app/src/components/PlateText.tsx apps/guard-app/src/components/IconBadge.tsx apps/guard-app/src/components/AnimatedEntry.tsx
git commit -m "feat(guard-app): add PlateText, IconBadge, and AnimatedEntry components"
```

---

### Task 5: Redesign LoginScreen

**Files:**
- Modify: `apps/guard-app/src/screens/LoginScreen.tsx`

- [ ] **Step 1: Rewrite LoginScreen.tsx**

Replace the full contents of `apps/guard-app/src/screens/LoginScreen.tsx` with:

```typescript
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { login as apiLogin } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [focusedField, setFocusedField] = useState<string | null>(null);
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
    <LinearGradient
      colors={colors.gradientBg}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <AnimatedEntry direction="up" duration={600}>
        <GlowCard style={styles.card}>
          <View style={styles.logoRow}>
            <LinearGradient
              colors={colors.gradientPrimary as unknown as string[]}
              style={styles.logoCircle}
            >
              <MaterialCommunityIcons name="shield-check" size={32} color={colors.white} />
            </LinearGradient>
          </View>
          <Text style={styles.title}>CommunityGate</Text>
          <Text style={styles.subtitle}>Guard Station</Text>

          {errorMsg ? (
            <AnimatedEntry direction="fade">
              <Text style={styles.error}>{errorMsg}</Text>
            </AnimatedEntry>
          ) : null}

          <View style={[styles.inputWrapper, focusedField === 'username' && styles.inputFocused]}>
            <MaterialCommunityIcons name="account" size={18} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={colors.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setFocusedField('username')}
              onBlur={() => setFocusedField(null)}
            />
          </View>

          <View style={[styles.inputWrapper, focusedField === 'password' && styles.inputFocused]}>
            <MaterialCommunityIcons name="lock" size={18} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
            />
          </View>

          <View style={styles.buttonWrapper}>
            <GradientButton
              title="Sign In"
              onPress={handleLogin}
              icon="login"
              loading={loading}
              disabled={!username.trim() || !password.trim()}
            />
          </View>
        </GlowCard>
      </AnimatedEntry>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: 400,
  },
  logoRow: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing['2xl'],
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  inputFocused: {
    borderColor: 'rgba(99,102,241,0.5)',
  },
  inputIcon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    padding: spacing.lg,
    fontSize: 16,
    color: colors.textPrimary,
  },
  buttonWrapper: {
    marginTop: spacing.sm,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/screens/LoginScreen.tsx
git commit -m "feat(guard-app): redesign LoginScreen with Gradient Glow theme"
```

---

### Task 6: Redesign QueueScreen

**Files:**
- Modify: `apps/guard-app/src/screens/QueueScreen.tsx`

- [ ] **Step 1: Rewrite QueueScreen.tsx**

Replace the full contents of `apps/guard-app/src/screens/QueueScreen.tsx` with:

```typescript
import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import StatusPill from '../components/StatusPill';
import PlateText from '../components/PlateText';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useQueueStore, type QueueEntry } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';

type NavProp = NativeStackNavigationProp<RootStackParamList, 'Queue'>;

const methodIcons: Record<string, { icon: string; color: string; gradient: readonly [string, string] }> = {
  anpr: { icon: 'camera', color: colors.info, gradient: ['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.1)'] },
  rfid: { icon: 'card-bulleted', color: colors.success, gradient: ['rgba(34,197,94,0.3)', 'rgba(16,185,129,0.1)'] },
  manual: { icon: 'account', color: colors.warning, gradient: ['rgba(251,191,36,0.3)', 'rgba(245,158,11,0.1)'] },
  otp: { icon: 'numeric', color: '#c084fc', gradient: ['rgba(168,85,247,0.3)', 'rgba(139,92,246,0.1)'] },
};

function VehicleItem({ entry, onPress, index }: { entry: QueueEntry; onPress: (e: QueueEntry) => void; index: number }) {
  const method = methodIcons[entry.method] || methodIcons.manual;
  const variant = entry.decision === 'guard_review' ? 'warning' : entry.decision === 'deny' ? 'danger' : 'success';

  return (
    <AnimatedEntry direction="left" delay={index * 100}>
      <GlowCard variant={variant} style={styles.vehicleCard}>
        <View style={styles.vehicleRow} onTouchEnd={() => onPress(entry)}>
          <IconBadge
            icon={method.icon as any}
            color={method.color}
            gradientColors={method.gradient}
            size={40}
          />
          <View style={styles.vehicleInfo}>
            <PlateText plate={entry.plate} size="md" />
            <Text style={styles.vehicleDetail}>
              {entry.method.toUpperCase()} &bull; {new Date(entry.timestamp).toLocaleTimeString()}
            </Text>
          </View>
          <StatusPill status={entry.decision} />
        </View>
      </GlowCard>
    </AnimatedEntry>
  );
}

function RecentItem({ entry, index }: { entry: QueueEntry; index: number }) {
  return (
    <AnimatedEntry direction="right" delay={index * 80}>
      <View style={styles.recentRow}>
        <View style={[styles.recentDot, {
          backgroundColor: entry.decision === 'allow' ? colors.success
            : entry.decision === 'deny' ? colors.danger : colors.warning,
        }]} />
        <PlateText plate={entry.plate} size="sm" />
        <Text style={styles.recentTime}>
          {new Date(entry.timestamp).toLocaleTimeString()}
        </Text>
        <StatusPill status={entry.decision} size="sm" />
      </View>
    </AnimatedEntry>
  );
}

export default function QueueScreen() {
  const navigation = useNavigation<NavProp>();
  const entries = useQueueStore((s) => s.entries);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  const pendingEntries = entries.filter((e) => e.decision === 'guard_review');
  const recentEntries = entries.filter((e) => e.decision !== 'guard_review');
  const deniedCount = entries.filter((e) => e.decision === 'deny').length;

  const handleCardPress = useCallback(
    (entry: QueueEntry) => navigation.navigate('Approve', { entryId: entry.id }),
    [navigation],
  );

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['rgba(99,102,241,0.15)', 'rgba(168,85,247,0.05)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons name="gate" size={22} color={colors.info} />
          <Text style={styles.headerGate}>{user?.gateId ? 'Main Gate' : 'Gate'}</Text>
        </View>
        <Text style={styles.headerTitle}>Vehicle Queue</Text>
        <View style={styles.headerRight}>
          <Text style={styles.headerUser}>{user?.name || 'Guard'}</Text>
          <MaterialCommunityIcons
            name="logout"
            size={20}
            color={colors.danger}
            onPress={logout}
            style={styles.logoutIcon}
          />
        </View>
      </LinearGradient>

      {/* Body — split panels */}
      <View style={styles.body}>
        {/* Left — Pending */}
        <View style={styles.panelLeft}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Pending Review</Text>
            <View style={styles.countBadge}>
              <LinearGradient colors={colors.gradientWarning as unknown as string[]} style={styles.countGradient}>
                <Text style={styles.countText}>{pendingEntries.length}</Text>
              </LinearGradient>
            </View>
          </View>
          {pendingEntries.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="gate" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>All clear — no vehicles pending</Text>
            </View>
          ) : (
            <FlatList
              data={pendingEntries}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) => (
                <VehicleItem entry={item} onPress={handleCardPress} index={index} />
              )}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        {/* Right — Recent */}
        <View style={styles.panelRight}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent</Text>
            <Text style={styles.sectionCount}>{recentEntries.length}</Text>
          </View>
          {recentEntries.length === 0 ? (
            <Text style={styles.emptyTextSmall}>No recent entries</Text>
          ) : (
            <FlatList
              data={recentEntries}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) => <RecentItem entry={item} index={index} />}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>

      {/* Bottom stats + nav */}
      <View style={styles.bottomBar}>
        <View style={styles.stats}>
          <LinearGradient colors={colors.gradientPrimary as unknown as string[]} style={styles.statCard}>
            <Text style={styles.statLabel}>PENDING</Text>
            <Text style={styles.statValue}>{pendingEntries.length}</Text>
          </LinearGradient>
          <LinearGradient colors={colors.gradientAccent as unknown as string[]} style={styles.statCard}>
            <Text style={styles.statLabel}>TODAY</Text>
            <Text style={styles.statValue}>{entries.length}</Text>
          </LinearGradient>
          <LinearGradient colors={colors.gradientDanger as unknown as string[]} style={styles.statCard}>
            <Text style={styles.statLabel}>DENIED</Text>
            <Text style={styles.statValue}>{deniedCount}</Text>
          </LinearGradient>
        </View>
        <View style={styles.navButtons}>
          <GradientButton title="Verify OTP" icon="numeric" onPress={() => navigation.navigate('OTPVerify')} />
          <View style={styles.navGap} />
          <GradientButton title="Log Incident" icon="alert" variant="danger" onPress={() => navigation.navigate('Incidents')} />
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerGate: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerUser: { color: colors.textMuted, fontSize: 13 },
  logoutIcon: { padding: spacing.xs },
  body: { flex: 1, flexDirection: 'row', padding: spacing.lg, gap: spacing.lg },
  panelLeft: { flex: 0.6 },
  panelRight: { flex: 0.4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, gap: spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  sectionCount: { color: colors.textMuted, fontSize: 14 },
  countBadge: { overflow: 'hidden', borderRadius: radius.pill },
  countGradient: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: radius.pill },
  countText: { color: colors.bgPrimary, fontSize: 12, fontWeight: '800' },
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleInfo: { flex: 1, gap: spacing.xs },
  vehicleDetail: { color: colors.textMuted, fontSize: 12, letterSpacing: 0.5 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  recentDot: { width: 6, height: 6, borderRadius: 3 },
  recentTime: { color: colors.textMuted, fontSize: 11, marginLeft: 'auto', marginRight: spacing.sm },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  emptyTextSmall: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: spacing['3xl'] },
  listContent: { paddingBottom: spacing.lg },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    gap: spacing.lg,
  },
  stats: { flexDirection: 'row', gap: spacing.sm },
  statCard: { borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center', minWidth: 80 },
  statLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  statValue: { color: colors.white, fontSize: 22, fontWeight: '800' },
  navButtons: { flex: 1, flexDirection: 'row' },
  navGap: { width: spacing.sm },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/screens/QueueScreen.tsx
git commit -m "feat(guard-app): redesign QueueScreen with Gradient Glow theme"
```

---

### Task 7: Redesign ApproveScreen

**Files:**
- Modify: `apps/guard-app/src/screens/ApproveScreen.tsx`

- [ ] **Step 1: Rewrite ApproveScreen.tsx**

Replace the full contents of `apps/guard-app/src/screens/ApproveScreen.tsx` with:

```typescript
import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../App';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import StatusPill from '../components/StatusPill';
import PlateText from '../components/PlateText';
import IconBadge from '../components/IconBadge';
import AnimatedEntry from '../components/AnimatedEntry';
import { useQueueStore } from '../store/queueStore';
import { useAuthStore } from '../store/authStore';
import { sendGateCommand } from '../api/client';

type RouteParams = RouteProp<RootStackParamList, 'Approve'>;

export default function ApproveScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { entryId } = route.params;
  const entry = useQueueStore((s) => s.entries.find((e) => e.id === entryId));
  const removeEntry = useQueueStore((s) => s.removeEntry);
  const gateId = useAuthStore((s) => s.user?.gateId ?? '');
  const [loading, setLoading] = useState(false);

  if (!entry) {
    return (
      <LinearGradient colors={colors.gradientBg} style={styles.container}>
        <View style={styles.notFoundWrap}>
          <MaterialCommunityIcons name="car-off" size={48} color={colors.textMuted} />
          <Text style={styles.notFound}>Entry not found</Text>
        </View>
      </LinearGradient>
    );
  }

  const handleDecision = async (action: 'open' | 'deny') => {
    setLoading(true);
    try {
      await sendGateCommand(gateId, action);
      removeEntry(entryId);
      navigation.goBack();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Command failed';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Command failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <View style={styles.content}>
        {/* Snapshot panel */}
        <View style={styles.snapshotPanel}>
          {entry.snapshot ? (
            <Image source={{ uri: entry.snapshot }} style={styles.snapshot} resizeMode="contain" />
          ) : (
            <View style={styles.noSnapshot}>
              <MaterialCommunityIcons name="camera-off" size={48} color={colors.textMuted} />
              <Text style={styles.noSnapshotText}>No snapshot</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', colors.bgPrimary]}
            style={styles.snapshotOverlay}
          />
        </View>

        {/* Info panel */}
        <AnimatedEntry direction="up" duration={500}>
          <GlowCard variant={entry.decision === 'deny' ? 'danger' : 'warning'} style={styles.infoCard}>
            <PlateText plate={entry.plate} size="lg" />
            <View style={styles.statusRow}>
              <StatusPill status={entry.decision} />
            </View>

            <View style={styles.detailGrid}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>METHOD</Text>
                <View style={styles.detailValueRow}>
                  <MaterialCommunityIcons
                    name={entry.method === 'anpr' ? 'camera' : entry.method === 'rfid' ? 'card-bulleted' : 'account'}
                    size={16}
                    color={colors.info}
                  />
                  <Text style={styles.detailValue}>{entry.method.toUpperCase()}</Text>
                </View>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>TIME</Text>
                <View style={styles.detailValueRow}>
                  <MaterialCommunityIcons name="clock-outline" size={16} color={colors.info} />
                  <Text style={styles.detailValue}>{new Date(entry.timestamp).toLocaleTimeString()}</Text>
                </View>
              </View>
              {entry.reason ? (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>REASON</Text>
                  <Text style={styles.detailValue}>{entry.reason}</Text>
                </View>
              ) : null}
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={colors.info} style={styles.loader} />
            ) : (
              <View style={styles.actions}>
                <View style={styles.actionBtn}>
                  <GradientButton
                    title="Approve"
                    icon="check-circle"
                    variant="success"
                    onPress={() => handleDecision('open')}
                  />
                </View>
                <View style={styles.actionBtn}>
                  <GradientButton
                    title="Deny"
                    icon="close-circle"
                    variant="danger"
                    onPress={() => handleDecision('deny')}
                  />
                </View>
              </View>
            )}
          </GlowCard>
        </AnimatedEntry>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, flexDirection: 'row', padding: spacing.lg, gap: spacing.lg },
  snapshotPanel: { flex: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.02)', justifyContent: 'center', alignItems: 'center' },
  snapshot: { width: '90%', height: '90%', borderRadius: radius.md },
  noSnapshot: { justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  noSnapshotText: { color: colors.textMuted, fontSize: 14 },
  snapshotOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  infoCard: { width: 380 },
  statusRow: { flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.xl },
  detailGrid: { gap: spacing.lg, marginBottom: spacing['2xl'] },
  detailItem: { gap: spacing.xs },
  detailLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  detailValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.md },
  actionBtn: { flex: 1 },
  loader: { marginVertical: spacing['2xl'] },
  notFoundWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  notFound: { color: colors.textMuted, fontSize: 16 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/screens/ApproveScreen.tsx
git commit -m "feat(guard-app): redesign ApproveScreen with Gradient Glow theme"
```

---

### Task 8: Redesign OTPVerifyScreen

**Files:**
- Modify: `apps/guard-app/src/screens/OTPVerifyScreen.tsx`

- [ ] **Step 1: Rewrite OTPVerifyScreen.tsx**

Replace the full contents of `apps/guard-app/src/screens/OTPVerifyScreen.tsx` with:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/screens/OTPVerifyScreen.tsx
git commit -m "feat(guard-app): redesign OTPVerifyScreen with Gradient Glow theme"
```

---

### Task 9: Redesign IncidentScreen

**Files:**
- Modify: `apps/guard-app/src/screens/IncidentScreen.tsx`

- [ ] **Step 1: Rewrite IncidentScreen.tsx**

Replace the full contents of `apps/guard-app/src/screens/IncidentScreen.tsx` with:

```typescript
import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import GlowCard from '../components/GlowCard';
import GradientButton from '../components/GradientButton';
import AnimatedEntry from '../components/AnimatedEntry';
import { createIncident } from '../api/client';
import { useAuthStore } from '../store/authStore';

const INCIDENT_TYPES = [
  { key: 'unauthorized_entry', label: 'Unauthorized Entry', icon: 'account-alert' as const },
  { key: 'tailgating', label: 'Tailgating', icon: 'car-multiple' as const },
  { key: 'suspicious_person', label: 'Suspicious Person', icon: 'eye' as const },
  { key: 'vehicle_damage', label: 'Vehicle Damage', icon: 'car-wrench' as const },
  { key: 'equipment_malfunction', label: 'Equipment Fault', icon: 'cog-off' as const },
  { key: 'other', label: 'Other', icon: 'dots-horizontal' as const },
];

export default function IncidentScreen() {
  const [type, setType] = useState(INCIDENT_TYPES[0].key);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const gateId = useAuthStore((s) => s.user?.gateId ?? '');

  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert('Error', 'Please enter a description');
      return;
    }
    setLoading(true);
    try {
      await createIncident({ type, description: description.trim(), gateId });
      Alert.alert('Success', 'Incident logged successfully');
      setDescription('');
      setType(INCIDENT_TYPES[0].key);
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to log incident';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Failed to log incident');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={colors.gradientBg} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <AnimatedEntry direction="fade" duration={500}>
          <GlowCard variant="danger" style={styles.card}>
            <View style={styles.titleRow}>
              <MaterialCommunityIcons name="alert" size={24} color={colors.danger} />
              <Text style={styles.title}>Report Incident</Text>
            </View>

            <Text style={styles.label}>INCIDENT TYPE</Text>
            <View style={styles.chipGrid}>
              {INCIDENT_TYPES.map((t) => {
                const isActive = type === t.key;
                return (
                  <TouchableOpacity key={t.key} onPress={() => setType(t.key)} activeOpacity={0.7}>
                    {isActive ? (
                      <LinearGradient
                        colors={colors.gradientDanger as unknown as string[]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.chip}
                      >
                        <MaterialCommunityIcons name={t.icon} size={16} color={colors.white} />
                        <Text style={styles.chipTextActive}>{t.label}</Text>
                      </LinearGradient>
                    ) : (
                      <View style={styles.chipInactive}>
                        <MaterialCommunityIcons name={t.icon} size={16} color={colors.textMuted} />
                        <Text style={styles.chipText}>{t.label}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>DESCRIPTION</Text>
            <TextInput
              style={[styles.textArea, focused && styles.textAreaFocused]}
              placeholder="Describe the incident..."
              placeholderTextColor={colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />

            <GradientButton
              title="Submit Report"
              icon="alert"
              variant="danger"
              onPress={handleSubmit}
              loading={loading}
              disabled={!description.trim()}
            />
          </GlowCard>
        </AnimatedEntry>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing['2xl'], alignItems: 'center' },
  card: { width: 600 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing['2xl'] },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing['2xl'] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  chipInactive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: colors.white, fontSize: 13, fontWeight: '600' },
  textArea: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 120,
    marginBottom: spacing['2xl'],
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  textAreaFocused: {
    borderColor: 'rgba(239,68,68,0.4)',
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/screens/IncidentScreen.tsx
git commit -m "feat(guard-app): redesign IncidentScreen with Gradient Glow theme"
```

---

### Task 10: Update entry point (app/index.tsx)

**Files:**
- Modify: `apps/guard-app/app/index.tsx`

- [ ] **Step 1: Rewrite app/index.tsx**

Replace the full contents of `apps/guard-app/app/index.tsx` with:

```typescript
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../src/store/authStore';
import { useQueueStore, type QueueEntry } from '../src/store/queueStore';
import { getSocket } from '../src/api/socket';
import { colors } from '../src/theme/colors';
import LoginScreen from '../src/screens/LoginScreen';
import QueueScreen from '../src/screens/QueueScreen';

function AuthenticatedApp() {
  const addEntry = useQueueStore((s) => s.addEntry);

  // Listen for live gate events via Socket.io
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
      eventTs: string;
    }) => {
      const entry: QueueEntry = {
        id: data.id,
        plate: data.rawValue || 'Unknown',
        method: data.detectionMethod as QueueEntry['method'],
        decision: data.accessDecision as QueueEntry['decision'],
        reason: data.denyReason || undefined,
        timestamp: data.eventTs,
      };
      addEntry(entry);
    };

    socket.on('gate:event', handleEvent);
    return () => { socket.off('gate:event', handleEvent); };
  }, [addEntry]);

  return <QueueScreen />;
}

export default function Page() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  useEffect(() => {
    rehydrate();
  }, []);

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

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/app/index.tsx
git commit -m "feat(guard-app): update entry point for redesigned screens"
```

---

### Task 11: Visual smoke test

- [ ] **Step 1: Start the Guard App**

```bash
cd apps/guard-app && npx expo start --web --port 8081
```

- [ ] **Step 2: Verify Login Screen**

Open http://localhost:8081. Verify:
- Gradient background (navy → purple diagonal)
- Shield icon in gradient circle
- "CommunityGate" title, "GUARD STATION" subtitle with letter spacing
- Input fields with icons (account, lock), glowing border on focus
- Gradient "Sign In" button with login icon
- Press animation on button (slight scale down)

- [ ] **Step 3: Verify Queue Screen**

Login with `guard1`/`guard123`. Verify:
- Full gradient background
- Header with gate icon, title, guard name, logout icon
- Two-panel split layout (60/40)
- Empty state: gate icon + "All clear" text
- Bottom bar: 3 gradient stat counters + 2 gradient nav buttons
- Icons throughout (gate, numeric, alert)

- [ ] **Step 4: Verify other screens**

Navigate to OTP Verify and Incident screens via bottom buttons. Verify:
- OTP: 6 individual digit boxes with glow on fill, gradient verify/reset buttons
- Incident: gradient type chips with icons, glowing textarea, gradient submit button
- All screens have gradient backgrounds
- Animations play on screen entry
