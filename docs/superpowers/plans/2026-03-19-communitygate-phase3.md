# CommunityGate Phase 3 — Frontend Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build all 3 frontend applications — Guard app (React Native/Android tablet), Resident app (React Native/iOS+Android), and Admin portal (Next.js 14).

**Architecture:** React Native apps use Expo with TypeScript, Zustand for state, axios+zod for typed API client. Admin portal uses Next.js 14 App Router with server components.

**Tech Stack:** React Native (Expo), Next.js 14, TypeScript, Zustand, axios, zod, Tailwind CSS (admin portal)

---

### Task 1: Guard App (React Native — Android tablet)

**Screens:** Queue, Approve, OTPVerify, Incidents

The guard app runs on a tablet at the gate. It shows a live queue of incoming vehicles, lets guards approve/deny unknown vehicles, verify visitor OTPs, and log incidents.

**Files:**
- `apps/guard-app/package.json`
- `apps/guard-app/app.json` (Expo config)
- `apps/guard-app/tsconfig.json`
- `apps/guard-app/App.tsx`
- `apps/guard-app/src/api/client.ts` — typed API client
- `apps/guard-app/src/store/authStore.ts` — Zustand auth state
- `apps/guard-app/src/store/queueStore.ts` — vehicle queue state
- `apps/guard-app/src/screens/LoginScreen.tsx`
- `apps/guard-app/src/screens/QueueScreen.tsx` — live vehicle queue
- `apps/guard-app/src/screens/ApproveScreen.tsx` — approve/deny vehicle
- `apps/guard-app/src/screens/OTPVerifyScreen.tsx` — verify visitor OTP
- `apps/guard-app/src/screens/IncidentScreen.tsx` — log incidents
- `apps/guard-app/src/components/VehicleCard.tsx`
- `apps/guard-app/src/components/StatusBadge.tsx`

### Task 2: Resident App (React Native — iOS + Android)

**Screens:** Login, Home, Vehicles, Passes, Notifications

The resident app lets residents manage their vehicles, create visitor passes, view entry history, and receive push notifications.

**Files:**
- `apps/resident-app/package.json`
- `apps/resident-app/app.json`
- `apps/resident-app/tsconfig.json`
- `apps/resident-app/App.tsx`
- `apps/resident-app/src/api/client.ts` — typed API client (axios + zod)
- `apps/resident-app/src/store/authStore.ts`
- `apps/resident-app/src/store/vehicleStore.ts`
- `apps/resident-app/src/screens/LoginScreen.tsx` — phone OTP login
- `apps/resident-app/src/screens/HomeScreen.tsx` — dashboard
- `apps/resident-app/src/screens/VehiclesScreen.tsx` — manage vehicles
- `apps/resident-app/src/screens/PassesScreen.tsx` — create/manage visitor passes
- `apps/resident-app/src/screens/NotificationsScreen.tsx` — entry alerts
- `apps/resident-app/src/components/VehicleCard.tsx`
- `apps/resident-app/src/components/PassCard.tsx`

### Task 3: Admin Portal (Next.js 14 App Router)

**Pages:** Dashboard, Units, Vehicles (bulk import), Gates, Events, Reports

The admin portal is a web dashboard for community managers.

**Files:**
- `apps/admin-portal/package.json`
- `apps/admin-portal/next.config.js`
- `apps/admin-portal/tsconfig.json`
- `apps/admin-portal/tailwind.config.ts`
- `apps/admin-portal/postcss.config.js`
- `apps/admin-portal/app/layout.tsx` — root layout with sidebar nav
- `apps/admin-portal/app/page.tsx` — dashboard
- `apps/admin-portal/app/vehicles/page.tsx` — vehicle list + bulk import
- `apps/admin-portal/app/gates/page.tsx` — gate status + manual control
- `apps/admin-portal/app/events/page.tsx` — event log
- `apps/admin-portal/app/reports/page.tsx` — daily reports
- `apps/admin-portal/app/units/page.tsx` — unit management
- `apps/admin-portal/components/Sidebar.tsx`
- `apps/admin-portal/components/DataTable.tsx`
- `apps/admin-portal/components/StatusBadge.tsx`
- `apps/admin-portal/lib/api.ts` — API client

### Task 4: Final Verification

- Update CLAUDE.md (mark Steps 15-17 done)
- Verify all existing tests still pass
- Commit
