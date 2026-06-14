# Dwaar AI Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the light-mode Dwaar AI design system (tokens, fonts, flat base components) and the 5-tab navigation shell for the resident app, with branded placeholder tabs and a dev component gallery.

**Architecture:** Replace the dark `theme/colors.ts` with the Dwaar light palette (keeping back-compat aliases so existing screens still compile), add DM Sans / Noto fonts via `expo-font`, build a set of token-driven flat components under `src/components/ui/`, and rewrite `app/index.tsx` to a 5-tab shell rendering placeholders. No backend or per-tab feature work.

**Tech Stack:** Expo SDK 52 / React Native 0.76, expo-router, TypeScript, `@expo-google-fonts/*`, `react-native-safe-area-context`, jest-expo + @testing-library/react-native for tests.

**Spec:** `docs/superpowers/specs/2026-06-11-dwaar-foundation-design.md`
**Branch:** `redesign/dwaar-light`

### Conventions for every task
- Run tests: `pnpm --filter resident-app test`
- Type-check gate: `pnpm --filter resident-app exec tsc --noEmit`
- All colours/spacing come from tokens — no hardcoded hex in components.
- `font(w)` returns `{ fontFamily }`; spread it into a style with an explicit `fontSize`.

---

## Task 1: Test harness (jest-expo)

**Files:**
- Modify: `apps/resident-app/package.json` (devDeps + `test` script)
- Create: `apps/resident-app/jest.config.js`
- Create: `apps/resident-app/src/__tests__/smoke.test.ts`

- [ ] **Step 1: Install dev dependencies**

Run (from repo root):
```bash
pnpm --filter resident-app add -D jest@^29 jest-expo@~52.0.0 @testing-library/react-native@^12.7.2 react-test-renderer@18.3.1 @types/jest@^29
```

- [ ] **Step 2: Add the test script**

In `apps/resident-app/package.json`, add to `"scripts"`:
```json
"test": "jest"
```

- [ ] **Step 3: Create `jest.config.js`**

```js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['@testing-library/react-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@react-native-async-storage/.*))',
  ],
};
```

- [ ] **Step 4: Write a smoke test**

`apps/resident-app/src/__tests__/smoke.test.ts`:
```ts
describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `pnpm --filter resident-app test`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add apps/resident-app/package.json apps/resident-app/jest.config.js apps/resident-app/src/__tests__/smoke.test.ts pnpm-lock.yaml
git commit -m "test(resident): add jest-expo harness"
```

---

## Task 2: Spacing & radius tokens

**Files:**
- Modify: `apps/resident-app/src/theme/spacing.ts`
- Test: `apps/resident-app/src/theme/spacing.test.ts`

- [ ] **Step 1: Write the failing test**

`spacing.test.ts`:
```ts
import { spacing, radius } from './spacing';

describe('spacing tokens', () => {
  it('follows the 8dp grid per Brief §6', () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.sm).toBe(8);
    expect(spacing.md).toBe(12);
    expect(spacing.lg).toBe(16);
    expect(spacing.xl).toBe(24);
    expect(spacing['2xl']).toBe(32);
  });
  it('keeps extended keys used by existing screens', () => {
    expect(spacing['3xl']).toBeGreaterThan(0);
    expect(spacing['5xl']).toBeGreaterThan(0);
  });
  it('radius matches Brief §6 with legacy pill alias', () => {
    expect(radius.sm).toBe(8);
    expect(radius.md).toBe(12);
    expect(radius.lg).toBe(16);
    expect(radius.full).toBe(9999);
    expect(radius.pill).toBe(20);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter resident-app test spacing`
Expected: FAIL (`spacing.xl` is 20, `radius.lg` is 14).

- [ ] **Step 3: Implement**

Replace `spacing.ts` with:
```ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
  '5xl': 56,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 20, // legacy alias
  full: 9999,
} as const;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter resident-app test spacing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/resident-app/src/theme/spacing.ts apps/resident-app/src/theme/spacing.test.ts
git commit -m "feat(resident): Dwaar spacing/radius tokens"
```

---

## Task 3: Colour tokens + back-compat aliases

**Files:**
- Modify: `apps/resident-app/src/theme/colors.ts`
- Test: `apps/resident-app/src/theme/colors.test.ts`

- [ ] **Step 1: Write the failing test**

`colors.test.ts`:
```ts
import { colors } from './colors';

describe('Dwaar colour tokens (Brief §3)', () => {
  it('defines brand colours', () => {
    expect(colors.brandPrimary).toBe('#1B3A4B');
    expect(colors.teal).toBe('#00BFA6');
    expect(colors.mist).toBe('#E8F4F8');
    expect(colors.actionPrimary).toBe('#F59E0B');
    expect(colors.actionHover).toBe('#D97706');
  });
  it('defines status signal + tint + on-tint text', () => {
    expect(colors.success).toBe('#2ECC71');
    expect(colors.tintSuccess).toBe('#EAFAF1');
    expect(colors.textSuccess).toBe('#1A7A44');
    expect(colors.error).toBe('#E84C3D');
    expect(colors.warning).toBe('#F6C90E');
    expect(colors.info).toBe('#3498DB');
  });
  it('defines text + surface tokens', () => {
    expect(colors.textPrimary).toBe('#1B3A4B');
    expect(colors.textSecondary).toBe('#557A8F');
    expect(colors.textTertiary).toBe('#8DAFC0');
    expect(colors.textInverse).toBe('#FFFFFF');
    expect(colors.surface).toBe('#FFFFFF');
  });
  it('keeps every legacy alias existing screens reference', () => {
    for (const key of [
      'bgPrimary', 'bgSecondary', 'danger', 'dangerBg', 'infoBg', 'successBg',
      'warningBg', 'warningBorder', 'textMuted', 'white', 'surfaceBorder',
    ] as const) {
      expect(colors[key]).toBeDefined();
    }
    for (const g of ['gradientBg', 'gradientPrimary', 'gradientAccent', 'gradientSuccess', 'gradientDanger'] as const) {
      expect(Array.isArray(colors[g])).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter resident-app test colors`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `colors.ts` with:
```ts
// Dwaar AI light palette — Brief §3. Resident app = light mode.
const palette = {
  // Brand
  brandPrimary: '#1B3A4B',
  oceanDark: '#0D2535',
  teal: '#00BFA6',
  mist: '#E8F4F8',
  // Action
  actionPrimary: '#F59E0B',
  actionHover: '#D97706',
  // Status signal
  success: '#2ECC71',
  error: '#E84C3D',
  warning: '#F6C90E',
  info: '#3498DB',
  // Status tint backgrounds
  tintSuccess: '#EAFAF1',
  tintError: '#FDEDEC',
  tintWarning: '#FEFDE7',
  tintInfo: '#EBF5FB',
  // Status on-tint text
  textSuccess: '#1A7A44',
  textError: '#922B21',
  textWarning: '#7D6608',
  textInfo: '#1B5276',
  // Typography
  textPrimary: '#1B3A4B',
  textSecondary: '#557A8F',
  textTertiary: '#8DAFC0',
  textInverse: '#FFFFFF',
  // Surfaces
  surface: '#FFFFFF',
  surfaceBorder: 'rgba(27,58,75,0.15)',
  inputBorder: 'rgba(27,58,75,0.20)',
  notifBadge: '#E84C3D',
  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

// Back-compat aliases for dark-era screens (removed as each screen is rebuilt).
export const colors = {
  ...palette,
  bgPrimary: palette.mist,
  bgSecondary: palette.mist,
  surfaceHover: palette.mist,
  textMuted: palette.textTertiary,
  danger: palette.error,
  dangerBg: palette.tintError,
  dangerBorder: palette.tintError,
  successBg: palette.tintSuccess,
  successBorder: palette.tintSuccess,
  warningBg: palette.tintWarning,
  warningBorder: palette.tintWarning,
  infoBg: palette.tintInfo,
  gradientBg: [palette.mist, palette.mist] as const,
  gradientPrimary: [palette.brandPrimary, palette.brandPrimary] as const,
  gradientAccent: [palette.actionPrimary, palette.actionPrimary] as const,
  gradientSuccess: [palette.success, palette.success] as const,
  gradientDanger: [palette.error, palette.error] as const,
  gradientWarning: [palette.warning, palette.warning] as const,
} as const;
```

- [ ] **Step 4: Run to verify it passes + existing code still type-checks**

Run: `pnpm --filter resident-app test colors`
Expected: PASS.
Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors (all existing `colors.*` references resolve via aliases).

- [ ] **Step 5: Commit**

```bash
git add apps/resident-app/src/theme/colors.ts apps/resident-app/src/theme/colors.test.ts
git commit -m "feat(resident): Dwaar light colour tokens + back-compat aliases"
```

---

## Task 4: Typography tokens + `font()`

**Files:**
- Create: `apps/resident-app/src/theme/typography.ts`
- Test: `apps/resident-app/src/theme/typography.test.ts`

- [ ] **Step 1: Write the failing test**

`typography.test.ts`:
```ts
import { font, type } from './typography';

describe('typography', () => {
  it('maps weights to DM Sans families', () => {
    expect(font(400).fontFamily).toBe('DMSans_400Regular');
    expect(font(500).fontFamily).toBe('DMSans_500Medium');
    expect(font(700).fontFamily).toBe('DMSans_700Bold');
  });
  it('exposes the Brief §5 scale', () => {
    expect(type.h1.fontSize).toBe(22);
    expect(type.h2.fontSize).toBe(18);
    expect(type.body.fontSize).toBe(14);
    expect(type.caption.fontSize).toBe(11);
    expect(type.h1.fontFamily).toBe('DMSans_500Medium');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter resident-app test typography`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`typography.ts`:
```ts
import { TextStyle } from 'react-native';
import { colors } from './colors';

export type FontWeight = 400 | 500 | 700;

const FAMILY: Record<FontWeight, string> = {
  400: 'DMSans_400Regular',
  500: 'DMSans_500Medium',
  700: 'DMSans_700Bold',
};

export function font(weight: FontWeight = 400): { fontFamily: string } {
  return { fontFamily: FAMILY[weight] };
}

export const type = {
  display: { ...font(500), fontSize: 28, color: colors.textPrimary },
  h1: { ...font(500), fontSize: 22, color: colors.textPrimary },
  h2: { ...font(500), fontSize: 18, color: colors.textPrimary },
  h3: { ...font(500), fontSize: 15, color: colors.textPrimary },
  body: { ...font(400), fontSize: 14, color: colors.textPrimary },
  bodySecondary: { ...font(400), fontSize: 13, color: colors.textSecondary },
  caption: { ...font(500), fontSize: 11, color: colors.textSecondary },
  micro: { ...font(400), fontSize: 11, color: colors.textTertiary },
} satisfies Record<string, TextStyle>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter resident-app test typography`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/resident-app/src/theme/typography.ts apps/resident-app/src/theme/typography.test.ts
git commit -m "feat(resident): DM Sans typography tokens + font() helper"
```

---

## Task 5: Fonts + root loader + SafeAreaProvider

**Files:**
- Create: `apps/resident-app/src/lib/fonts.ts`
- Modify: `apps/resident-app/app/index.tsx` (font gate + SafeAreaProvider in `Page`)

- [ ] **Step 1: Install font packages**

Run (from repo root):
```bash
pnpm --filter resident-app exec npx expo install expo-font
pnpm --filter resident-app add @expo-google-fonts/dm-sans @expo-google-fonts/noto-sans-devanagari @expo-google-fonts/noto-sans-kannada
```
(`react-native-safe-area-context` is already a dependency.)

- [ ] **Step 2: Create the font loader**

`src/lib/fonts.ts`:
```ts
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari';
import { NotoSansKannada_400Regular } from '@expo-google-fonts/noto-sans-kannada';

export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    NotoSansDevanagari_400Regular,
    NotoSansKannada_400Regular,
  });
  return loaded;
}
```

- [ ] **Step 3: Gate the root on fonts + wrap in SafeAreaProvider**

In `app/index.tsx`, add imports near the top:
```tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAppFonts } from '../src/lib/fonts';
```
Then update the `Page` component so it loads fonts and provides safe-area context. Replace the existing `Page` function body's start (the loading guard) with:
```tsx
export default function Page() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const showRegister = useAuthStore((s) => s.showRegister);
  const rehydrate = useAuthStore((s) => s.rehydrate);
  const fontsLoaded = useAppFonts();

  useEffect(() => { rehydrate(); }, []);

  if (!fontsLoaded || isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.mist }}>
        <ActivityIndicator size="large" color={colors.teal} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      {!isAuthenticated
        ? (showRegister ? <RegisterScreen /> : <LoginScreen />)
        : <ResidentApp />}
    </SafeAreaProvider>
  );
}
```
(Keep the existing `View`, `ActivityIndicator` imports — add `View` to the `react-native` import if missing. Remove the now-unused `LinearGradient` loading block.)

- [ ] **Step 4: Verify type-check + manual launch**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors.
Run: `pnpm --filter resident-app start` → open web. Expected: loader shows briefly, then the app renders (still the old tabs until Task 16) with no font errors in the console.

- [ ] **Step 5: Commit**

```bash
git add apps/resident-app/src/lib/fonts.ts apps/resident-app/app/index.tsx apps/resident-app/package.json pnpm-lock.yaml
git commit -m "feat(resident): load DM Sans/Noto fonts + SafeAreaProvider at root"
```

---

## Task 6: `Button` component

**Files:**
- Create: `apps/resident-app/src/components/ui/Button.tsx`
- Test: `apps/resident-app/src/components/ui/Button.test.tsx`

- [ ] **Step 1: Write the failing test**

`Button.test.tsx`:
```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import Button from './Button';

describe('Button', () => {
  it('renders its title and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button title="Open Gate" onPress={onPress} />);
    fireEvent.press(getByText('Open Gate'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button title="Pay" onPress={onPress} disabled />);
    fireEvent.press(getByText('Pay'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter resident-app test Button`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`Button.tsx`:
```tsx
import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { font } from '../../theme/typography';

type Variant = 'primary' | 'ghost' | 'destructive';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export default function Button({
  title, onPress, variant = 'primary', icon, loading = false, disabled = false, style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const fg = variant === 'ghost' ? colors.teal : colors.textInverse;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'destructive' && styles.destructive,
        pressed && !isDisabled && styles.pressed,
        pressed && !isDisabled && variant === 'primary' && styles.primaryPressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          {icon && <MaterialCommunityIcons name={icon} size={20} color={fg} style={styles.icon} />}
          <Text style={[styles.label, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48, minWidth: 120, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center',
  },
  primary: { backgroundColor: colors.actionPrimary },
  ghost: { backgroundColor: colors.transparent, borderWidth: 1, borderColor: colors.teal },
  destructive: { backgroundColor: colors.error },
  pressed: { transform: [{ scale: 0.97 }] },
  primaryPressed: { backgroundColor: colors.actionHover },
  disabled: { opacity: 0.4 },
  content: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: spacing.sm },
  label: { ...font(500), fontSize: 14 },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter resident-app test Button`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/resident-app/src/components/ui/Button.tsx apps/resident-app/src/components/ui/Button.test.tsx
git commit -m "feat(resident): Button (primary/ghost/destructive)"
```

---

## Task 7: `Card` component

**Files:**
- Create: `apps/resident-app/src/components/ui/Card.tsx`

- [ ] **Step 1: Implement**

`Card.tsx`:
```tsx
import React from 'react';
import { View, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'hero';
  accent?: string;          // optional left-border status accent colour
  style?: ViewStyle;
  onPress?: () => void;
}

export default function Card({ children, variant = 'default', accent, style, onPress }: CardProps) {
  const content = (
    <View
      style={[
        styles.base,
        variant === 'hero' ? styles.hero : styles.default,
        accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
        {content}
      </Pressable>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, padding: spacing.lg },
  default: { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.surfaceBorder },
  hero: { backgroundColor: colors.brandPrimary },
});
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/resident-app/src/components/ui/Card.tsx
git commit -m "feat(resident): Card (default/hero + status accent)"
```

---

## Task 8: `StatusBadge` component

**Files:**
- Create: `apps/resident-app/src/components/ui/StatusBadge.tsx`
- Test: `apps/resident-app/src/components/ui/StatusBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

`StatusBadge.test.tsx`:
```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the preset label', () => {
    const { getByText } = render(<StatusBadge preset="granted" />);
    expect(getByText('Granted')).toBeTruthy();
  });
  it('allows a custom label', () => {
    const { getByText } = render(<StatusBadge preset="pending" label="Waiting" />);
    expect(getByText('Waiting')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter resident-app test StatusBadge`
Expected: FAIL.

- [ ] **Step 3: Implement**

`StatusBadge.tsx`:
```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { font } from '../../theme/typography';

export type BadgePreset = 'granted' | 'denied' | 'pending' | 'verified' | 'info';

const PRESETS: Record<BadgePreset, { label: string; bg: string; fg: string; accent?: string }> = {
  granted:  { label: 'Granted',  bg: colors.tintSuccess, fg: colors.textSuccess, accent: colors.success },
  denied:   { label: 'Denied',   bg: colors.tintError,   fg: colors.textError },
  pending:  { label: 'Pending',  bg: colors.tintWarning, fg: colors.textWarning },
  verified: { label: 'Verified', bg: colors.teal,        fg: colors.textInverse },
  info:     { label: 'Info',     bg: colors.tintInfo,    fg: colors.textInfo },
};

interface Props {
  preset: BadgePreset;
  label?: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ preset, label, size = 'md' }: Props) {
  const cfg = PRESETS[preset];
  const sm = size === 'sm';
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: cfg.bg },
        cfg.accent ? { borderLeftWidth: 3, borderLeftColor: cfg.accent } : null,
        sm && styles.badgeSm,
      ]}
    >
      <Text style={[styles.text, { color: cfg.fg }, sm && styles.textSm]}>{label ?? cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  badgeSm: { paddingHorizontal: 6, paddingVertical: 2 },
  text: { ...font(500), fontSize: 11 },
  textSm: { fontSize: 10 },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter resident-app test StatusBadge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/resident-app/src/components/ui/StatusBadge.tsx apps/resident-app/src/components/ui/StatusBadge.test.tsx
git commit -m "feat(resident): StatusBadge presets"
```

---

## Task 9: `Input` component

**Files:**
- Create: `apps/resident-app/src/components/ui/Input.tsx`

- [ ] **Step 1: Implement**

`Input.tsx`:
```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { font } from '../../theme/typography';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export default function Input({ label, error, style, onFocus, onBlur, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        placeholderTextColor={colors.textTertiary}
        {...rest}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[
          styles.input,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          style,
        ]}
      />
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  label: { ...font(500), fontSize: 11, color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    ...font(400), fontSize: 14, color: colors.textPrimary,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48,
  },
  inputFocused: { borderColor: colors.teal, borderWidth: 1.5 },
  inputError: { borderColor: colors.error, borderWidth: 1.5 },
  errorText: { ...font(400), fontSize: 11, color: colors.textError, marginTop: spacing.xs },
});
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter resident-app exec tsc --noEmit` → no errors.
```bash
git add apps/resident-app/src/components/ui/Input.tsx
git commit -m "feat(resident): Input with teal focus + error state"
```

---

## Task 10: `SectionHeader` component

**Files:**
- Create: `apps/resident-app/src/components/ui/SectionHeader.tsx`

- [ ] **Step 1: Implement**

`SectionHeader.tsx`:
```tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { type } from '../../theme/typography';

interface Props {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function SectionHeader({ title, actionLabel, onAction }: Props) {
  return (
    <View style={styles.row}>
      <Text style={type.h2}>{title}</Text>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  action: { ...type.caption, color: colors.teal },
});
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter resident-app exec tsc --noEmit` → no errors.
```bash
git add apps/resident-app/src/components/ui/SectionHeader.tsx
git commit -m "feat(resident): SectionHeader"
```

---

## Task 11: `Avatar` component

**Files:**
- Create: `apps/resident-app/src/components/ui/Avatar.tsx`

- [ ] **Step 1: Implement**

`Avatar.tsx`:
```tsx
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { font } from '../../theme/typography';

const SIZES = { sm: 32, md: 44, lg: 64 } as const;

interface Props {
  name?: string;
  uri?: string;
  size?: keyof typeof SIZES;
}

function initials(name?: string): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
}

export default function Avatar({ name, uri, size = 'md' }: Props) {
  const d = SIZES[size];
  const base = { width: d, height: d, borderRadius: d / 2 };
  if (uri) return <Image source={{ uri }} style={base} />;
  return (
    <View style={[base, styles.fallback]}>
      <Text style={[styles.initials, { fontSize: d * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  initials: { ...font(700), color: colors.brandPrimary },
});
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter resident-app exec tsc --noEmit` → no errors.
```bash
git add apps/resident-app/src/components/ui/Avatar.tsx
git commit -m "feat(resident): Avatar (image/initials)"
```

---

## Task 12: `AppBar` component

**Files:**
- Create: `apps/resident-app/src/components/ui/AppBar.tsx`

- [ ] **Step 1: Implement**

`AppBar.tsx`:
```tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { font } from '../../theme/typography';

interface Props {
  title: string;
  onBack?: () => void;
  bellCount?: number;
  onBell?: () => void;
}

export default function AppBar({ title, onBack, bellCount, onBell }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} style={styles.side}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textInverse} />
        </Pressable>
      ) : (
        <View style={styles.side} />
      )}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {onBell ? (
        <Pressable onPress={onBell} hitSlop={8} style={styles.side}>
          <MaterialCommunityIcons name="bell-outline" size={22} color={colors.textInverse} />
          {!!bellCount && bellCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{bellCount > 9 ? '9+' : bellCount}</Text>
            </View>
          )}
        </Pressable>
      ) : (
        <View style={styles.side} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  side: { width: 40, height: 28, alignItems: 'center', justifyContent: 'center' },
  title: { ...font(500), fontSize: 22, color: colors.textInverse, flex: 1, textAlign: 'center' },
  badge: {
    position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.notifBadge, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { ...font(700), fontSize: 9, color: colors.textInverse },
});
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter resident-app exec tsc --noEmit` → no errors.
```bash
git add apps/resident-app/src/components/ui/AppBar.tsx
git commit -m "feat(resident): AppBar (Deep Ocean, back + bell badge)"
```

---

## Task 13: Restyle `PlateText` to IND plate format

**Files:**
- Modify: `apps/resident-app/src/components/PlateText.tsx`

- [ ] **Step 1: Replace the file**

`PlateText.tsx`:
```tsx
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { radius, spacing } from '../theme/spacing';

interface Props {
  plate: string;
  size?: 'sm' | 'md';
}

// IND yellow number-plate look (Brief: vehicles show plates in IND plate format).
export default function PlateText({ plate, size = 'md' }: Props) {
  const sm = size === 'sm';
  return (
    <View style={[styles.plate, sm && styles.plateSm]}>
      <Text style={[styles.text, sm && styles.textSm]}>{plate.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    backgroundColor: '#F4C430', borderRadius: radius.sm, borderWidth: 1, borderColor: '#1B1B1B',
    paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start',
  },
  plateSm: { paddingHorizontal: 6 },
  text: {
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
    fontSize: 15, fontWeight: '700', letterSpacing: 1, color: '#1B1B1B',
  },
  textSm: { fontSize: 12 },
});
```
(This is the one place a literal hex is allowed — the statutory plate yellow/black are not brand tokens.)

- [ ] **Step 2: Type-check**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors. (If a current consumer passes different props, note it — Vehicles is rebuilt in sub-project 2; for now ensure callers compile.)

- [ ] **Step 3: Commit**

```bash
git add apps/resident-app/src/components/PlateText.tsx
git commit -m "feat(resident): IND number-plate styled PlateText"
```

---

## Task 14: UI barrel export

**Files:**
- Create: `apps/resident-app/src/components/ui/index.ts`

- [ ] **Step 1: Implement**

`index.ts`:
```ts
export { default as Button } from './Button';
export { default as Card } from './Card';
export { default as StatusBadge } from './StatusBadge';
export { default as Input } from './Input';
export { default as SectionHeader } from './SectionHeader';
export { default as Avatar } from './Avatar';
export { default as AppBar } from './AppBar';
export type { BadgePreset } from './StatusBadge';
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter resident-app exec tsc --noEmit` → no errors.
```bash
git add apps/resident-app/src/components/ui/index.ts
git commit -m "chore(resident): ui barrel export"
```

---

## Task 15: `TabPlaceholder` component

**Files:**
- Create: `apps/resident-app/src/components/TabPlaceholder.tsx`

- [ ] **Step 1: Implement**

`TabPlaceholder.tsx`:
```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar } from './ui';

interface Props {
  name: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

export default function TabPlaceholder({ name, icon }: Props) {
  return (
    <View style={styles.container}>
      <AppBar title={name} />
      <View style={styles.center}>
        <MaterialCommunityIcons name={icon} size={48} color={colors.brandPrimary} />
        <Text style={[type.h2, styles.title]}>{name}</Text>
        <Text style={type.bodySecondary}>Coming in this redesign</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  title: { marginTop: spacing.lg },
});
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter resident-app exec tsc --noEmit` → no errors.
```bash
git add apps/resident-app/src/components/TabPlaceholder.tsx
git commit -m "feat(resident): branded TabPlaceholder"
```

---

## Task 16: Rewrite the navigation shell

**Files:**
- Modify: `apps/resident-app/app/index.tsx`

- [ ] **Step 1: Replace tab definitions, TabBar, and content routing**

Update the `TabKey` type, `tabs` array, `TabBar`, and `ResidentApp` content switch. Final shape:

```tsx
type TabKey = 'home' | 'myunit' | 'community' | 'events' | 'profile';

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: 'home-variant' },
  { key: 'myunit', label: 'My Unit', icon: 'home-city' },
  { key: 'community', label: 'Community', icon: 'forum' },
  { key: 'events', label: 'Events', icon: 'calendar-star' },
  { key: 'profile', label: 'Profile', icon: 'account' },
];

function TabBar({ active, onSelect }: { active: TabKey; onSelect: (key: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[tabStyles.bar, { paddingBottom: insets.bottom || spacing.sm }]}>
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <TouchableOpacity key={tab.key} style={tabStyles.tab} onPress={() => onSelect(tab.key)} activeOpacity={0.7}>
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={22}
              color={isActive ? colors.brandPrimary : colors.textTertiary}
            />
            <Text style={[tabStyles.label, isActive && tabStyles.labelActive]}>{tab.label}</Text>
            {isActive && <View style={tabStyles.dot} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
```

Replace the `ResidentApp` content block with placeholders (gallery wired in Task 17):
```tsx
<View style={{ flex: 1, backgroundColor: colors.mist }}>
  {tab === 'home' && <TabPlaceholder name="Home" icon="home-variant" />}
  {tab === 'myunit' && <TabPlaceholder name="My Unit" icon="home-city" />}
  {tab === 'community' && <TabPlaceholder name="Community" icon="forum" />}
  {tab === 'events' && <TabPlaceholder name="Events" icon="calendar-star" />}
  {tab === 'profile' && <TabPlaceholder name="Profile" icon="account" />}
</View>
```

Add imports: `import { useSafeAreaInsets } from 'react-native-safe-area-context';` and `import TabPlaceholder from '../src/components/TabPlaceholder';`. Update `handleNavigate` to accept the new keys. Keep `approvalOverlay` + notifications wiring intact. Remove now-unused screen imports (HomeScreen, VehiclesScreen, etc.) and the `LinearGradient` import if no longer referenced.

- [ ] **Step 2: Replace `tabStyles`**

```tsx
const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.surfaceBorder,
    paddingTop: spacing.sm,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: spacing.xs, gap: 2 },
  label: { ...font(500), fontSize: 10, color: colors.textTertiary },
  labelActive: { color: colors.brandPrimary },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.actionPrimary, marginTop: 2 },
});
```
Add `import { font } from '../src/theme/typography';`.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual launch**

Run: `pnpm --filter resident-app start` → open web/Android.
Expected: 5-tab bar (Home · My Unit · Community · Events · Profile); active tab shows Deep Ocean icon+label with an amber dot; tapping switches placeholders; each placeholder shows a Deep Ocean AppBar. No crashes.

- [ ] **Step 5: Commit**

```bash
git add apps/resident-app/app/index.tsx
git commit -m "feat(resident): 5-tab Dwaar nav shell with placeholders"
```

---

## Task 17: Dev component gallery

**Files:**
- Create: `apps/resident-app/src/screens/ComponentGallery.tsx`
- Modify: `apps/resident-app/app/index.tsx` (render gallery for Profile tab in `__DEV__`)

- [ ] **Step 1: Implement the gallery**

`ComponentGallery.tsx`:
```tsx
import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Button, Card, StatusBadge, Input, SectionHeader, Avatar } from '../components/ui';
import PlateText from '../components/PlateText';

export default function ComponentGallery() {
  const [val, setVal] = useState('');
  return (
    <View style={styles.container}>
      <AppBar title="Components" bellCount={3} onBell={() => {}} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <SectionHeader title="Typography" />
        <Text style={type.display}>Display 28</Text>
        <Text style={type.h1}>Heading 1</Text>
        <Text style={type.h2}>Heading 2</Text>
        <Text style={type.body}>Body regular 14</Text>
        <Text style={type.bodySecondary}>Body secondary 13</Text>
        <Text style={type.caption}>CAPTION 11</Text>

        <SectionHeader title="Buttons" />
        <View style={styles.gap}>
          <Button title="Open Gate" icon="gate" onPress={() => {}} />
          <Button title="Pre-approve" variant="ghost" onPress={() => {}} />
          <Button title="Deny" variant="destructive" onPress={() => {}} />
          <Button title="Loading" loading onPress={() => {}} />
          <Button title="Disabled" disabled onPress={() => {}} />
        </View>

        <SectionHeader title="Status badges" />
        <View style={styles.row}>
          <StatusBadge preset="granted" />
          <StatusBadge preset="denied" />
          <StatusBadge preset="pending" label="Waiting" />
          <StatusBadge preset="verified" />
          <StatusBadge preset="info" />
        </View>

        <SectionHeader title="Cards" />
        <Card style={styles.gap}><Text style={type.h3}>Default card</Text><Text style={type.bodySecondary}>White surface, hairline border.</Text></Card>
        <Card variant="hero" style={styles.gap}><Text style={[type.h3, { color: colors.textInverse }]}>Hero card</Text><Text style={{ color: colors.textInverse }}>Deep Ocean surface.</Text></Card>
        <Card accent={colors.success}><Text style={type.h3}>Accent card</Text></Card>

        <SectionHeader title="Input" />
        <Input label="Visitor name" placeholder="e.g. Rahul" value={val} onChangeText={setVal} />
        <View style={{ height: spacing.md }} />
        <Input label="With error" placeholder="Phone" error="Enter a valid number" />

        <SectionHeader title="Avatar + Plate" />
        <View style={styles.row}>
          <Avatar name="Prabakaran R" size="lg" />
          <Avatar name="Asha" size="md" />
          <PlateText plate="KA01AB1234" />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing['3xl'] },
  gap: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
});
```

- [ ] **Step 2: Wire it for the Profile tab in dev**

In `app/index.tsx`, add `import ComponentGallery from '../src/screens/ComponentGallery';` and change the profile line:
```tsx
{tab === 'profile' && (__DEV__ ? <ComponentGallery /> : <TabPlaceholder name="Profile" icon="account" />)}
```

- [ ] **Step 3: Type-check + manual check**

Run: `pnpm --filter resident-app exec tsc --noEmit` → no errors.
Run: `pnpm --filter resident-app start` → tap **Profile**. Expected: the gallery renders every component against Mist; amber buttons, teal ghost border, tinted badges, Deep Ocean hero/AppBar, teal focus ring on the input, IND plate, all in DM Sans.

- [ ] **Step 4: Commit**

```bash
git add apps/resident-app/src/screens/ComponentGallery.tsx apps/resident-app/app/index.tsx
git commit -m "feat(resident): dev component gallery on Profile tab"
```

---

## Task 18: Final verification

- [ ] **Step 1: Full test suite**

Run: `pnpm --filter resident-app test`
Expected: all suites PASS (smoke, spacing, colors, typography, Button, StatusBadge).

- [ ] **Step 2: Type gate**

Run: `pnpm --filter resident-app exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual acceptance checklist** (run `pnpm --filter resident-app start`)
  - Loader (teal spinner on Mist) shows, then app renders — no font-load console errors.
  - Bottom nav shows the 5 Dwaar tabs in order; active tab = Deep Ocean + amber dot; inactive = tertiary grey.
  - Switching tabs shows each branded placeholder with a Deep Ocean AppBar.
  - Profile (dev) shows the component gallery matching the Brief.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(resident): foundation verification pass" || echo "nothing to commit"
```

---

## Self-review (author notes)

- **Spec coverage:** §3 tokens → Tasks 2–4; §4 fonts → Task 5; §5 components → Tasks 6–14; §6 nav shell → Tasks 16; placeholders → Task 15/16; gallery + acceptance (§7) → Tasks 17–18. Back-compat alias requirement → Task 3 (verified by `tsc`).
- **Out of scope honoured:** no backend, no per-tab feature screens, no icon/splash art, no i18n content.
- **Type consistency:** `font(w)` returns `{ fontFamily }` everywhere; `StatusBadge` uses `preset`/`label`; `Card` uses `variant`/`accent`; barrel re-exports match component default exports.
- **Known interim state:** old dark screens remain in the repo (compiling via aliases) but are unrouted; they are deleted/replaced in sub-projects 1–5.
