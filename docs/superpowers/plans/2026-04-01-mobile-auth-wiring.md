# Mobile Auth Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Guard App and Resident App to real auth endpoints, replacing dev auto-login with actual API calls and adding AsyncStorage token persistence.

**Architecture:** Both apps already have real login screens (`src/screens/LoginScreen.tsx`) and API client functions. The `app/index.tsx` files bypass them with hardcoded dev tokens. We fix the API client endpoint URLs, update `app/index.tsx` to call real endpoints, add AsyncStorage persistence to Zustand auth stores, and add a loading state for token rehydration on app launch.

**Tech Stack:** React Native / Expo 52, Zustand, Axios, AsyncStorage, JWT (decode-only on client)

---

## File Structure

### Guard App (`apps/guard-app/`)
- **Modify:** `src/api/client.ts` — fix endpoint URL `/auth/login` → `/auth/guard-login`
- **Modify:** `src/store/authStore.ts` — add AsyncStorage persistence + rehydrate + isLoading
- **Modify:** `app/index.tsx` — replace dev auto-login with real API call + add loading state

### Resident App (`apps/resident-app/`)
- **Modify:** `src/api/client.ts` — fix endpoint URLs `/auth/otp/request` → `/auth/resident-otp`, `/auth/otp/verify` → `/auth/resident-verify`
- **Modify:** `src/store/authStore.ts` — add AsyncStorage persistence + rehydrate + isLoading
- **Modify:** `app/index.tsx` — replace dev auto-login with real OTP API calls + add loading state

---

### Task 1: Install AsyncStorage in both apps

**Files:**
- Modify: `apps/guard-app/package.json`
- Modify: `apps/resident-app/package.json`

- [ ] **Step 1: Install AsyncStorage in Guard App**

```bash
cd apps/guard-app && npx expo install @react-native-async-storage/async-storage
```

- [ ] **Step 2: Install AsyncStorage in Resident App**

```bash
cd apps/resident-app && npx expo install @react-native-async-storage/async-storage
```

- [ ] **Step 3: Commit**

```bash
git add apps/guard-app/package.json apps/guard-app/package-lock.json apps/resident-app/package.json apps/resident-app/package-lock.json
git commit -m "chore: add AsyncStorage to guard and resident apps"
```

---

### Task 2: Fix Guard App API client endpoint

**Files:**
- Modify: `apps/guard-app/src/api/client.ts:27-28`

- [ ] **Step 1: Fix the guard login endpoint URL**

In `apps/guard-app/src/api/client.ts`, change line 27-28 from:

```typescript
export const login = (username: string, password: string) =>
  api.post('/auth/login', { username, password });
```

to:

```typescript
export const login = (username: string, password: string) =>
  api.post('/auth/guard-login', { username, password });
```

- [ ] **Step 2: Add a clearAuthToken export for logout cleanup**

In the same file, after the `setAuthToken` function (line 18-20), add:

```typescript
export function clearAuthToken() {
  delete api.defaults.headers.common['Authorization'];
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/guard-app/src/api/client.ts
git commit -m "fix(guard-app): correct auth endpoint URL and add clearAuthToken"
```

---

### Task 3: Add AsyncStorage persistence to Guard App auth store

**Files:**
- Modify: `apps/guard-app/src/store/authStore.ts`

- [ ] **Step 1: Rewrite authStore.ts with persistence and rehydration**

Replace the full contents of `apps/guard-app/src/store/authStore.ts` with:

```typescript
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken, clearAuthToken } from '../api/client';

const AUTH_STORAGE_KEY = 'communitygate_guard_auth';

interface AuthUser {
  name: string;
  role: string;
  gateId: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  rehydrate: () => Promise<void>;
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: (token, user) => {
    setAuthToken(token);
    set({ token, user, isAuthenticated: true });
    AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, user })).catch(() => {});
  },

  logout: () => {
    clearAuthToken();
    set({ token: null, user: null, isAuthenticated: false });
    AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
  },

  rehydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const { token, user } = JSON.parse(raw);
        if (token && !isTokenExpired(token)) {
          setAuthToken(token);
          set({ token, user, isAuthenticated: true, isLoading: false });
          return;
        }
        // Token expired — clear storage
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {
      // Corrupted storage — clear it
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
    }
    set({ isLoading: false });
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add apps/guard-app/src/store/authStore.ts
git commit -m "feat(guard-app): add AsyncStorage token persistence with JWT expiry check"
```

---

### Task 4: Update Guard App entry point with real auth and loading state

**Files:**
- Modify: `apps/guard-app/app/index.tsx`

- [ ] **Step 1: Replace the LoginScreen in app/index.tsx with real API login**

In `apps/guard-app/app/index.tsx`, replace the `LoginScreen` function (lines 17-67) with:

```typescript
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
```

- [ ] **Step 2: Add error style to loginStyles**

In the `loginStyles` StyleSheet, add:

```typescript
error: { color: '#ef4444', fontSize: 14, marginBottom: 16, textAlign: 'center' },
```

- [ ] **Step 3: Add the import for apiLogin and useEffect**

Update the imports at the top of the file:

```typescript
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
```

- [ ] **Step 4: Update the Root Page component to handle loading state**

Replace the `Page` component at the bottom (lines 156-159) with:

```typescript
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
```

- [ ] **Step 5: Commit**

```bash
git add apps/guard-app/app/index.tsx
git commit -m "feat(guard-app): wire login to real API with token persistence"
```

---

### Task 5: Fix Resident App API client endpoints

**Files:**
- Modify: `apps/resident-app/src/api/client.ts:23-27`

- [ ] **Step 1: Fix the OTP endpoint URLs**

In `apps/resident-app/src/api/client.ts`, change lines 23-27 from:

```typescript
export const requestOTP = (phone: string) =>
  api.post('/auth/otp/request', { phone });

export const verifyOTP = (phone: string, otp: string) =>
  api.post('/auth/otp/verify', { phone, otp });
```

to:

```typescript
export const requestOTP = (phone: string) =>
  api.post('/auth/resident-otp', { phone });

export const verifyOTP = (phone: string, otp: string) =>
  api.post('/auth/resident-verify', { phone, otp });
```

- [ ] **Step 2: Add a clearAuthToken export for logout cleanup**

After the `setAuthToken` function (line 18-20), add:

```typescript
export function clearAuthToken() {
  delete api.defaults.headers.common['Authorization'];
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/resident-app/src/api/client.ts
git commit -m "fix(resident-app): correct auth endpoint URLs and add clearAuthToken"
```

---

### Task 6: Add AsyncStorage persistence to Resident App auth store

**Files:**
- Modify: `apps/resident-app/src/store/authStore.ts`

- [ ] **Step 1: Rewrite authStore.ts with persistence and rehydration**

Replace the full contents of `apps/resident-app/src/store/authStore.ts` with:

```typescript
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken, clearAuthToken } from '../api/client';

const AUTH_STORAGE_KEY = 'communitygate_resident_auth';

interface AuthUser {
  id: string;
  name: string;
  phone: string;
  unitNumber: string;
}

type OTPStep = 'phone' | 'otp';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  otpStep: OTPStep;
  phone: string;
  setPhone: (phone: string) => void;
  setOtpStep: (step: OTPStep) => void;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  rehydrate: () => Promise<void>;
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  otpStep: 'phone',
  phone: '',

  setPhone: (phone) => set({ phone }),
  setOtpStep: (otpStep) => set({ otpStep }),

  login: (token, user) => {
    setAuthToken(token);
    set({ token, user, isAuthenticated: true, otpStep: 'phone' });
    AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, user })).catch(() => {});
  },

  logout: () => {
    clearAuthToken();
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      otpStep: 'phone',
      phone: '',
    });
    AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
  },

  rehydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const { token, user } = JSON.parse(raw);
        if (token && !isTokenExpired(token)) {
          setAuthToken(token);
          set({ token, user, isAuthenticated: true, isLoading: false });
          return;
        }
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
    }
    set({ isLoading: false });
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add apps/resident-app/src/store/authStore.ts
git commit -m "feat(resident-app): add AsyncStorage token persistence with JWT expiry check"
```

---

### Task 7: Update Resident App entry point with real OTP auth and loading state

**Files:**
- Modify: `apps/resident-app/app/index.tsx`

- [ ] **Step 1: Replace the LoginScreen in app/index.tsx with real OTP flow**

In `apps/resident-app/app/index.tsx`, replace the `LoginScreen` function (lines 14-55) with:

```typescript
function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpStep, setOtpStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const login = useAuthStore((s) => s.login);

  const handleRequestOTP = async () => {
    if (!phone.trim() || phone.length < 10) return;
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
```

- [ ] **Step 2: Add error and phoneLabel styles to loginStyles**

In the `loginStyles` StyleSheet, add:

```typescript
error: { color: '#ef4444', fontSize: 14, marginBottom: 16, textAlign: 'center' },
phoneLabel: { fontSize: 14, color: '#94a3b8', marginBottom: 16 },
backLink: { color: '#60a5fa', marginTop: 16, fontSize: 14 },
```

- [ ] **Step 3: Update the imports**

Replace the imports at the top of the file with:

```typescript
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
```

- [ ] **Step 4: Update the Root Page component to handle loading state**

Replace the `Page` component at the bottom (lines 204-207) with:

```typescript
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
```

- [ ] **Step 5: Commit**

```bash
git add apps/resident-app/app/index.tsx
git commit -m "feat(resident-app): wire login to real OTP API with token persistence"
```

---

### Task 8: Manual smoke test

- [ ] **Step 1: Start Docker services**

```bash
docker compose up -d
```

- [ ] **Step 2: Test Guard App login**

```bash
cd apps/guard-app && npx expo start --web --port 8081
```

Open http://localhost:8081. Login with `guard1` / `guard123`. Verify:
- Login succeeds, queue view appears
- Refresh page — should stay logged in (token rehydrated from AsyncStorage)
- Click Logout — should return to login screen
- Refresh page — should show login (token cleared)

- [ ] **Step 3: Test Resident App login**

```bash
cd apps/resident-app && npx expo start --web --port 8082
```

Open http://localhost:8082. Enter a phone number from the residents table. Check API gateway logs for `[DEV] OTP for <phone>: <otp>`. Enter the OTP. Verify:
- Login succeeds, home tab appears with resident name
- Refresh page — should stay logged in
- Click Logout — should return to login
- Refresh page — should show login

- [ ] **Step 4: Test expired token handling**

Wait for token to expire (or temporarily change `TOKEN_EXPIRY` to `'10s'` in the API). Refresh the app — should show login screen (expired token cleared automatically).
