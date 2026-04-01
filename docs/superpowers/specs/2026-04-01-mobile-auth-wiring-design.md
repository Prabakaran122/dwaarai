# Mobile Auth Wiring Design

Connect Guard App and Resident App to real auth endpoints, replacing dev auto-login with actual API calls and adding token persistence.

## Context

Both apps have real login screens and API client functions already built, but `app/index.tsx` in each bypasses them with hardcoded dev tokens. The API gateway has working auth endpoints (guard-login, resident-otp, resident-verify) that are tested and functional.

## Changes

### Guard App

**`app/index.tsx`** — Replace dev auto-login with real login:
- Username + password form
- Call `/auth/guard-login` via API client
- Store token and user via auth store
- Show error messages on failure

**`src/api/client.ts`** — Fix endpoint URL:
- `/auth/login` → `/auth/guard-login`

**`src/store/authStore.ts`** — Add AsyncStorage persistence:
- `login()`: save `{token, user}` to AsyncStorage
- `logout()`: clear AsyncStorage
- `rehydrate()`: read from AsyncStorage, decode JWT, check `exp` claim, restore auth state if valid
- `isLoading`: boolean for rehydration check

**Entry point** — Show loading state while `rehydrate()` runs on app launch.

### Resident App

**`app/index.tsx`** — Replace dev auto-login with real OTP flow:
- Step 1: Phone input → `POST /auth/resident-otp`
- Step 2: OTP input → `POST /auth/resident-verify` → receive token + user
- Store via auth store
- Error handling for invalid/expired OTP, unregistered phone

**`src/api/client.ts`** — Fix endpoint URLs:
- `/auth/otp/request` → `/auth/resident-otp`
- `/auth/otp/verify` → `/auth/resident-verify`

**`src/store/authStore.ts`** — Same AsyncStorage persistence as Guard App:
- Persist on login, clear on logout
- `rehydrate()` with JWT expiry check
- `isLoading` state

**`App.tsx`** — Loading state while rehydrating.

## Decisions

- Keep dev fallback credentials (`guard1`/`guard123`) in the API — useful until Cognito
- Align client endpoint URLs to match actual API routes (not vice versa)
- JWT expiry check on rehydration: decode token and compare `exp` to current time; if expired, clear stored token and show login
- No refresh token logic — 24h tokens are sufficient for MVP
- No biometric or Cognito integration at this stage

## Out of Scope

- Refresh tokens
- Biometric authentication
- AWS Cognito integration
- Token refresh on 401 response (can be added later)
