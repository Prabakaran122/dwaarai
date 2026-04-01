# Multi-Community SaaS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-community SaaS support — admin accounts with roles, super admin API for managing communities and admins, admin portal login, and community-scoped views.

**Architecture:** New `admins` table with bcrypt passwords and super_admin/community_admin roles. New admin-login auth endpoint. New `/admin/*` API routes for community and admin CRUD (super_admin only). Admin portal gets a login screen, auth context for JWT management, communities page, community admins page, and dynamic community scoping. Existing routes accept both super_admin and community_admin roles where they previously accepted admin.

**Tech Stack:** Node.js/Express (API), bcryptjs (passwords), Next.js 14 + Tailwind (portal), PostgreSQL, JWT

---

## File Structure

### API Gateway (`services/api-gateway/`)
- **Create:** `migrations/007_admins.sql` — admins table + communities alter + seed
- **Create:** `src/routes/admin.js` — super admin CRUD routes
- **Modify:** `src/routes/auth.js` — add admin-login endpoint
- **Modify:** `src/middleware/auth.js` — update role checking
- **Modify:** `src/index.js` — register admin routes
- **Modify:** `package.json` — add bcryptjs

### Admin Portal (`apps/admin-portal/`)
- **Create:** `lib/auth.tsx` — auth context provider
- **Create:** `app/login/page.tsx` — admin login screen
- **Create:** `app/communities/page.tsx` — super admin communities view
- **Create:** `app/community-admins/page.tsx` — manage admin accounts
- **Modify:** `lib/api.ts` — use dynamic token from auth context
- **Modify:** `app/layout.tsx` — wrap with auth provider, conditional sidebar
- **Modify:** `components/Sidebar.tsx` — role-based nav items
- **Modify:** `app/page.tsx` — convert dashboard to client component

---

### Task 1: Install bcryptjs and create migration

**Files:**
- Modify: `services/api-gateway/package.json`
- Create: `services/api-gateway/migrations/007_admins.sql`

- [ ] **Step 1: Install bcryptjs**

```bash
cd services/api-gateway && pnpm add bcryptjs
```

- [ ] **Step 2: Create migration file**

Create `services/api-gateway/migrations/007_admins.sql`:

```sql
-- Admins table for portal authentication
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'community_admin')),
  community_id UUID REFERENCES communities(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admins_username ON admins(username);

-- Add fields to communities table
ALTER TABLE communities ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE communities ADD COLUMN IF NOT EXISTS contact_name VARCHAR(200);
ALTER TABLE communities ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(15);

-- Seed super admin (password: admin123)
-- bcrypt hash generated with: bcryptjs.hashSync('admin123', 10)
INSERT INTO admins (id, name, username, password_hash, role, community_id)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  'Super Admin',
  'superadmin',
  '$2a$10$8K1p/a0dL1LXMIgoEDFMoOk7pVfRHMXr0EY4pECQFW5.mNGQOgKW6',
  'super_admin',
  NULL
) ON CONFLICT (username) DO NOTHING;
```

Note: The bcrypt hash `$2a$10$8K1p/a0dL1LXMIgoEDFMoOk7pVfRHMXr0EY4pECQFW5.mNGQOgKW6` must be generated at runtime. Add a step to generate it.

- [ ] **Step 3: Generate the correct bcrypt hash and update the migration**

Run this to get the hash:
```bash
cd services/api-gateway && node -e "import('bcryptjs').then(b => console.log(b.hashSync('admin123', 10)))"
```

Replace the hash in the migration file with the output.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/package.json pnpm-lock.yaml services/api-gateway/migrations/007_admins.sql
git commit -m "feat: add admins table migration and bcryptjs dependency"
```

---

### Task 2: Add admin-login endpoint

**Files:**
- Modify: `services/api-gateway/src/routes/auth.js`

- [ ] **Step 1: Add admin-login route**

At the top of `services/api-gateway/src/routes/auth.js`, add the bcryptjs import:

```javascript
import bcrypt from 'bcryptjs';
```

Add the admin login schema after the existing schemas (after line 38):

```javascript
const adminLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});
```

Add the admin-login route before the `export default router` line:

```javascript
// -- POST /auth/admin-login -------------------------------------------------

router.post('/auth/admin-login', loginLimiter, async (req, res) => {
  try {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { username, password } = parsed.data;

    const admin = await queryOne(
      'SELECT id, name, username, password_hash, role, community_id FROM admins WHERE username = $1 AND is_active = true',
      [username]
    );

    if (!admin) {
      return error(res, 'Invalid credentials', 401);
    }

    const passwordValid = await bcrypt.compare(password, admin.password_hash);
    if (!passwordValid) {
      return error(res, 'Invalid credentials', 401);
    }

    const token = signToken({
      sub: admin.id,
      role: admin.role,
      community_id: admin.community_id || null,
      name: admin.name,
    });

    return success(res, {
      token,
      user: {
        id: admin.id,
        name: admin.name,
        role: admin.role,
        communityId: admin.community_id || null,
      },
    });
  } catch (err) {
    console.error('POST /auth/admin-login error:', err);
    return error(res, 'Internal server error', 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/routes/auth.js
git commit -m "feat: add admin-login endpoint with bcrypt password verification"
```

---

### Task 3: Update auth middleware for new roles

**Files:**
- Modify: `services/api-gateway/src/middleware/auth.js`

- [ ] **Step 1: Update authenticateJWT to handle admin roles**

In `services/api-gateway/src/middleware/auth.js`, replace the `authenticateJWT` function (lines 9-27) with:

```javascript
export function authenticateJWT(roles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return error(res, 'Missing or invalid Authorization header', 401);
    }
    try {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;

      // Role checking: 'admin' role accepts both super_admin and community_admin
      if (roles.length) {
        const userRole = decoded.role;
        const hasRole = roles.some(r =>
          r === userRole ||
          (r === 'admin' && (userRole === 'super_admin' || userRole === 'community_admin'))
        );
        if (!hasRole) {
          return error(res, 'Insufficient permissions', 403);
        }
      }

      // For super_admin viewing a specific community, allow override via header
      if (decoded.role === 'super_admin' && req.headers['x-community-id']) {
        decoded.community_id = req.headers['x-community-id'];
      }

      next();
    } catch (err) {
      return error(res, 'Invalid or expired token', 401);
    }
  };
}
```

Key changes:
- `roles` containing `'admin'` now matches both `super_admin` and `community_admin`
- Super admin can pass `X-Community-Id` header to scope requests to a specific community
- Existing routes using `authenticateJWT(['admin'])` work for both admin types without changes

- [ ] **Step 2: Commit**

```bash
git add services/api-gateway/src/middleware/auth.js
git commit -m "feat: update auth middleware to support super_admin and community_admin roles"
```

---

### Task 4: Create super admin API routes

**Files:**
- Create: `services/api-gateway/src/routes/admin.js`
- Modify: `services/api-gateway/src/index.js`

- [ ] **Step 1: Create admin routes file**

Create `services/api-gateway/src/routes/admin.js`:

```javascript
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const superOnly = authenticateJWT(['super_admin']);

// -- Zod schemas --------------------------------------------------------------

const createCommunitySchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  contact_name: z.string().max(200).optional(),
  contact_phone: z.string().max(15).optional(),
});

const updateCommunitySchema = createCommunitySchema.partial();

const createAdminSchema = z.object({
  name: z.string().min(1).max(200),
  username: z.string().min(3).max(100),
  password: z.string().min(6).max(200),
  role: z.enum(['community_admin']),
  community_id: z.string().uuid(),
});

// -- GET /admin/communities ---------------------------------------------------

router.get('/admin/communities', superOnly, async (req, res) => {
  try {
    const communities = await queryRows(`
      SELECT c.*,
        (SELECT count(*) FROM gates WHERE community_id = c.id AND is_active = true) as gate_count,
        (SELECT count(*) FROM units WHERE community_id = c.id) as unit_count,
        (SELECT count(*) FROM residents WHERE community_id = c.id AND is_active = true) as resident_count,
        (SELECT count(*) FROM vehicles WHERE community_id = c.id AND is_active = true) as vehicle_count
      FROM communities c
      WHERE c.is_active = true
      ORDER BY c.name
    `);
    return success(res, { communities });
  } catch (err) {
    console.error('GET /admin/communities error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/communities --------------------------------------------------

router.post('/admin/communities', superOnly, async (req, res) => {
  try {
    const parsed = createCommunitySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { name, address, contact_name, contact_phone } = parsed.data;
    const community = await queryOne(
      `INSERT INTO communities (name, address, contact_name, contact_phone)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, address || null, contact_name || null, contact_phone || null]
    );
    return success(res, { community }, 201);
  } catch (err) {
    console.error('POST /admin/communities error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /admin/communities/:id -----------------------------------------------

router.get('/admin/communities/:id', superOnly, async (req, res) => {
  try {
    const community = await queryOne(`
      SELECT c.*,
        (SELECT count(*) FROM gates WHERE community_id = c.id AND is_active = true) as gate_count,
        (SELECT count(*) FROM units WHERE community_id = c.id) as unit_count,
        (SELECT count(*) FROM residents WHERE community_id = c.id AND is_active = true) as resident_count,
        (SELECT count(*) FROM vehicles WHERE community_id = c.id AND is_active = true) as vehicle_count
      FROM communities c WHERE c.id = $1
    `, [req.params.id]);
    if (!community) return error(res, 'Community not found', 404);
    return success(res, { community });
  } catch (err) {
    console.error('GET /admin/communities/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /admin/communities/:id -----------------------------------------------

router.put('/admin/communities/:id', superOnly, async (req, res) => {
  try {
    const parsed = updateCommunitySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const fields = parsed.data;
    const sets = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) {
        sets.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }
    }
    if (sets.length === 0) return error(res, 'No fields to update', 400);
    values.push(req.params.id);
    const community = await queryOne(
      `UPDATE communities SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!community) return error(res, 'Community not found', 404);
    return success(res, { community });
  } catch (err) {
    console.error('PUT /admin/communities/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /admin/community-admins ----------------------------------------------

router.get('/admin/community-admins', superOnly, async (req, res) => {
  try {
    const admins = await queryRows(`
      SELECT a.id, a.name, a.username, a.role, a.community_id, a.is_active, a.created_at,
             c.name as community_name
      FROM admins a
      LEFT JOIN communities c ON a.community_id = c.id
      WHERE a.role = 'community_admin'
      ORDER BY a.name
    `);
    return success(res, { admins });
  } catch (err) {
    console.error('GET /admin/community-admins error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /admin/community-admins ---------------------------------------------

router.post('/admin/community-admins', superOnly, async (req, res) => {
  try {
    const parsed = createAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { name, username, password, role, community_id } = parsed.data;

    // Check username uniqueness
    const existing = await queryOne('SELECT id FROM admins WHERE username = $1', [username]);
    if (existing) return error(res, 'Username already exists', 409);

    // Verify community exists
    const community = await queryOne('SELECT id FROM communities WHERE id = $1', [community_id]);
    if (!community) return error(res, 'Community not found', 404);

    const password_hash = await bcrypt.hash(password, 10);
    const admin = await queryOne(
      `INSERT INTO admins (name, username, password_hash, role, community_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, username, role, community_id, is_active, created_at`,
      [name, username, password_hash, role, community_id]
    );
    return success(res, { admin }, 201);
  } catch (err) {
    console.error('POST /admin/community-admins error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /admin/community-admins/:id (deactivate) --------------------------

router.delete('/admin/community-admins/:id', superOnly, async (req, res) => {
  try {
    const admin = await queryOne(
      'UPDATE admins SET is_active = false WHERE id = $1 AND role = $2 RETURNING id, name',
      [req.params.id, 'community_admin']
    );
    if (!admin) return error(res, 'Admin not found', 404);
    return success(res, { deactivated: admin.id });
  } catch (err) {
    console.error('DELETE /admin/community-admins/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
```

- [ ] **Step 2: Register admin routes in index.js**

In `services/api-gateway/src/index.js`, add the import at the top:

```javascript
import adminRoutes from './routes/admin.js';
```

Add the route registration after the existing routes (after line 40):

```javascript
app.use('/api/v1', adminRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/src/routes/admin.js services/api-gateway/src/index.js
git commit -m "feat: add super admin API routes for communities and admin management"
```

---

### Task 5: Admin Portal — Auth context

**Files:**
- Create: `apps/admin-portal/lib/auth.tsx`
- Modify: `apps/admin-portal/lib/api.ts`

- [ ] **Step 1: Create auth context**

Create `apps/admin-portal/lib/auth.tsx`:

```tsx
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface AuthUser {
  id: string;
  name: string;
  role: 'super_admin' | 'community_admin';
  communityId: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  selectedCommunityId: string | null;
  selectedCommunityName: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  selectCommunity: (id: string | null, name: string | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [selectedCommunityName, setSelectedCommunityName] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('cg_admin_token');
    const storedUser = localStorage.getItem('cg_admin_user');
    const storedCommunityId = localStorage.getItem('cg_selected_community_id');
    const storedCommunityName = localStorage.getItem('cg_selected_community_name');
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        if (storedCommunityId) setSelectedCommunityId(storedCommunityId);
        if (storedCommunityName) setSelectedCommunityName(storedCommunityName);
      } catch {
        localStorage.removeItem('cg_admin_token');
        localStorage.removeItem('cg_admin_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('cg_admin_token', newToken);
    localStorage.setItem('cg_admin_user', JSON.stringify(newUser));
    // Community admins auto-select their community
    if (newUser.communityId) {
      setSelectedCommunityId(newUser.communityId);
      localStorage.setItem('cg_selected_community_id', newUser.communityId);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setSelectedCommunityId(null);
    setSelectedCommunityName(null);
    localStorage.removeItem('cg_admin_token');
    localStorage.removeItem('cg_admin_user');
    localStorage.removeItem('cg_selected_community_id');
    localStorage.removeItem('cg_selected_community_name');
  }, []);

  const selectCommunity = useCallback((id: string | null, name: string | null) => {
    setSelectedCommunityId(id);
    setSelectedCommunityName(name);
    if (id) {
      localStorage.setItem('cg_selected_community_id', id);
      localStorage.setItem('cg_selected_community_name', name || '');
    } else {
      localStorage.removeItem('cg_selected_community_id');
      localStorage.removeItem('cg_selected_community_name');
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, token, isAuthenticated: !!token, isLoading,
      selectedCommunityId, selectedCommunityName,
      login, logout, selectCommunity,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Update API client to use dynamic token**

Replace full contents of `apps/admin-portal/lib/api.ts`:

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('cg_admin_token') || '';
}

function getCommunityId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cg_selected_community_id');
}

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const communityId = getCommunityId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(communityId ? { 'X-Community-Id': communityId } : {}),
    ...(options.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    cache: 'no-store',
  });
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('cg_admin_token');
      localStorage.removeItem('cg_admin_user');
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}
```

Note: this also adds a 401 interceptor — if any API call returns 401, automatically clear the token and redirect to login.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-portal/lib/auth.tsx apps/admin-portal/lib/api.ts
git commit -m "feat(admin): add auth context and dynamic token management"
```

---

### Task 6: Admin Portal — Login page

**Files:**
- Create: `apps/admin-portal/app/login/page.tsx`

- [ ] **Step 1: Create login page**

Create `apps/admin-portal/app/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error?.message || 'Login failed');
        return;
      }
      login(data.data.token, data.data.user);
      router.push(data.data.user.role === 'super_admin' ? '/communities' : '/');
    } catch {
      setError('Connection failed. Check if the API is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen mesh-bg flex items-center justify-center">
      <div className="glass-panel gradient-border p-8 w-full max-w-md">
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-glow-primary flex items-center justify-center">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-slate-100 text-center mb-1">CommunityGate</h1>
        <p className="text-xs text-glow-purple text-center uppercase tracking-[0.2em] font-semibold mb-8">Admin Portal</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-status-danger-bg text-status-danger text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.15em] text-slate-500 font-bold mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-glow w-full px-4 py-3 text-sm"
              placeholder="Enter username"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.15em] text-slate-500 font-bold mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-glow w-full px-4 py-3 text-sm"
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !username.trim() || !password.trim()}
            className="w-full py-3 bg-glow-primary text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all duration-300 hover:shadow-lg hover:shadow-glow-blue/20"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/app/login/page.tsx
git commit -m "feat(admin): add login page with Gradient Glow styling"
```

---

### Task 7: Admin Portal — Update layout with auth provider and guards

**Files:**
- Modify: `apps/admin-portal/app/layout.tsx`
- Modify: `apps/admin-portal/components/Sidebar.tsx`

- [ ] **Step 1: Update layout.tsx**

Replace full contents of `apps/admin-portal/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import AuthGuard from '@/components/AuthGuard';
import './globals.css';

export const metadata: Metadata = {
  title: 'CommunityGate Admin Portal',
  description: 'Administration dashboard for CommunityGate access control system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-navy-900">
        <AuthProvider>
          <AuthGuard>{children}</AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create AuthGuard component**

Create `apps/admin-portal/components/AuthGuard.tsx`:

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import Sidebar from './Sidebar';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user, selectedCommunityName, selectCommunity } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== '/login') {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen mesh-bg flex items-center justify-center">
        <div className="text-slate-500 text-sm">Loading...</div>
      </div>
    );
  }

  // Login page — no sidebar
  if (pathname === '/login') {
    return <>{children}</>;
  }

  // Not authenticated — don't render anything (redirect happening)
  if (!isAuthenticated) return null;

  const isSuperAdmin = user?.role === 'super_admin';
  const isViewingCommunity = isSuperAdmin && selectedCommunityName;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        <header className="sticky top-0 z-10 glass-panel border-0 border-b border-surface-border px-6 py-3 flex items-center justify-between" style={{ borderRadius: 0 }}>
          <div className="flex items-center gap-3">
            {isViewingCommunity && (
              <>
                <button
                  onClick={() => { selectCommunity(null, null); router.push('/communities'); }}
                  className="text-xs text-glow-blue hover:text-glow-purple transition-colors"
                >
                  ← Communities
                </button>
                <span className="text-surface-border">|</span>
                <span className="text-sm font-semibold text-slate-300">{selectedCommunityName}</span>
              </>
            )}
            {!isViewingCommunity && (
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Administration</h2>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500">{user?.name}</div>
            <div className="w-8 h-8 rounded-lg bg-glow-primary flex items-center justify-center text-xs font-bold text-white">
              {user?.name?.charAt(0) || 'A'}
            </div>
          </div>
        </header>
        <main className="flex-1 p-6 mesh-bg overflow-auto">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update Sidebar with role-based nav**

Replace full contents of `apps/admin-portal/components/Sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const communityNav = [
  { href: '/', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1' },
  { href: '/vehicles', label: 'Vehicles', icon: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m16 0h1a1 1 0 001-1v-5a1 1 0 00-.3-.7l-3-3A1 1 0 0016.6 6H13' },
  { href: '/gates', label: 'Gates', icon: 'M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z' },
  { href: '/events', label: 'Events', icon: 'M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { href: '/reports', label: 'Reports', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { href: '/units', label: 'Units', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
];

const superAdminNav = [
  { href: '/communities', label: 'Communities', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { href: '/community-admins', label: 'Admins', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout, selectedCommunityId } = useAuth();

  if (!user || pathname === '/login') return null;

  const isSuperAdmin = user.role === 'super_admin';
  const showCommunityNav = !isSuperAdmin || selectedCommunityId;

  const navItems = [
    ...(isSuperAdmin ? superAdminNav : []),
    ...(showCommunityNav ? communityNav : []),
  ];

  return (
    <aside className="w-64 min-h-screen flex flex-col border-r border-surface-border" style={{ background: 'linear-gradient(180deg, #0c1222 0%, #0f0d2e 100%)' }}>
      <div className="p-6 border-b border-surface-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-glow-primary flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 tracking-tight">CommunityGate</h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-glow-purple font-semibold">
              {isSuperAdmin ? 'Super Admin' : 'Admin Portal'}
            </p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {isSuperAdmin && showCommunityNav && selectedCommunityId && (
          <div className="px-3 py-1.5 mb-2">
            <span className="text-[10px] uppercase tracking-[0.15em] text-slate-600 font-bold">Community</span>
          </div>
        )}
        {navItems.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                isActive
                  ? 'bg-glow-primary text-white shadow-lg shadow-glow-blue/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
              }`}
            >
              <svg className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-glow-blue'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
              </svg>
              {item.label}
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white animate-pulse-slow" />}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-surface-border space-y-3">
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-500 hover:text-status-danger hover:bg-surface-hover transition-all duration-300"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Logout
        </button>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
          <span className="text-[11px] text-slate-500">System Online</span>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/app/layout.tsx apps/admin-portal/components/AuthGuard.tsx apps/admin-portal/components/Sidebar.tsx
git commit -m "feat(admin): add auth guard, update layout and sidebar with role-based navigation"
```

---

### Task 8: Admin Portal — Communities page (super_admin)

**Files:**
- Create: `apps/admin-portal/app/communities/page.tsx`

- [ ] **Step 1: Create communities page**

Create `apps/admin-portal/app/communities/page.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Community {
  id: string;
  name: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  gate_count: number;
  unit_count: number;
  resident_count: number;
  vehicle_count: number;
}

export default function CommunitiesPage() {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const { selectCommunity } = useAuth();
  const router = useRouter();

  const fetchCommunities = async () => {
    try {
      const res = await apiFetch<{ data: { communities: Community[] } }>('/admin/communities');
      setCommunities(res.data?.communities || []);
    } catch { setCommunities([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCommunities(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await apiPost('/admin/communities', {
        name: name.trim(),
        address: address.trim() || undefined,
        contact_name: contactName.trim() || undefined,
        contact_phone: contactPhone.trim() || undefined,
      });
      setName(''); setAddress(''); setContactName(''); setContactPhone('');
      setShowForm(false);
      fetchCommunities();
    } catch (err) {
      alert('Failed to create community');
    }
  };

  const handleSelect = (c: Community) => {
    selectCommunity(c.id, c.name);
    router.push('/');
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-100">Communities</h1>
        <div className="text-center text-slate-500 py-12">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Communities</h1>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-bold bg-glow-primary text-white rounded-xl hover:shadow-lg hover:shadow-glow-blue/20 transition-all duration-300"
        >
          + Add Community
        </button>
      </div>

      {communities.length === 0 ? (
        <div className="glass-panel p-12 text-center text-slate-500">
          No communities yet. Create your first one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {communities.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSelect(c)}
              className="glass-panel glass-panel-hover p-6 text-left transition-all duration-300"
            >
              <h3 className="text-lg font-bold text-slate-100 mb-1">{c.name}</h3>
              {c.address && <p className="text-xs text-slate-500 mb-4">{c.address}</p>}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <div className="text-xl font-bold glow-text">{c.gate_count}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Gates</div>
                </div>
                <div>
                  <div className="text-xl font-bold glow-text">{c.unit_count}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Units</div>
                </div>
                <div>
                  <div className="text-xl font-bold glow-text">{c.resident_count}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Residents</div>
                </div>
                <div>
                  <div className="text-xl font-bold glow-text">{c.vehicle_count}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Vehicles</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-panel gradient-border p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-slate-100 mb-4">New Community</h2>
            <div className="space-y-3">
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Community name *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 text-sm text-slate-400 glass-panel hover:bg-surface-hover rounded-xl transition-all">Cancel</button>
              <button onClick={handleCreate} disabled={!name.trim()} className="flex-1 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-glow-blue/20">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/app/communities/page.tsx
git commit -m "feat(admin): add communities management page for super admin"
```

---

### Task 9: Admin Portal — Community Admins page

**Files:**
- Create: `apps/admin-portal/app/community-admins/page.tsx`

- [ ] **Step 1: Create community admins page**

Create `apps/admin-portal/app/community-admins/page.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { apiFetch, apiPost, apiDelete } from '@/lib/api';

interface Admin {
  id: string;
  name: string;
  username: string;
  role: string;
  community_id: string | null;
  community_name: string | null;
  is_active: boolean;
}

interface Community {
  id: string;
  name: string;
}

export default function CommunityAdminsPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [communityId, setCommunityId] = useState('');

  const fetchData = async () => {
    try {
      const [adminsRes, commRes] = await Promise.all([
        apiFetch<{ data: { admins: Admin[] } }>('/admin/community-admins'),
        apiFetch<{ data: { communities: Community[] } }>('/admin/communities'),
      ]);
      setAdmins(adminsRes.data?.admins || []);
      setCommunities(commRes.data?.communities || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || !username.trim() || !password.trim() || !communityId) return;
    try {
      await apiPost('/admin/community-admins', {
        name: name.trim(),
        username: username.trim(),
        password,
        role: 'community_admin',
        community_id: communityId,
      });
      setName(''); setUsername(''); setPassword(''); setCommunityId('');
      setShowForm(false);
      fetchData();
    } catch {
      alert('Failed to create admin. Username may already exist.');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this admin?')) return;
    try {
      await apiDelete(`/admin/community-admins/${id}`);
      fetchData();
    } catch { alert('Failed to deactivate admin'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Community Admins</h1>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-bold bg-glow-primary text-white rounded-xl hover:shadow-lg hover:shadow-glow-blue/20 transition-all duration-300"
        >
          + Add Admin
        </button>
      </div>

      <div className="glass-panel overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-border">
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Name</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Username</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Community</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Status</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-600">Loading...</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-600">No community admins yet</td></tr>
            ) : (
              admins.map((a) => (
                <tr key={a.id} className="border-b border-surface-border/50 hover:bg-surface-hover transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-300 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-400 font-mono">{a.username}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">{a.community_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider ${
                      a.is_active
                        ? 'text-status-success bg-status-success-bg'
                        : 'text-status-danger bg-status-danger-bg'
                    }`}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {a.is_active && (
                      <button
                        onClick={() => handleDeactivate(a.id)}
                        className="text-xs text-status-danger hover:text-red-300 transition-colors"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-panel gradient-border p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-slate-100 mb-4">New Community Admin</h2>
            <div className="space-y-3">
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Full name *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <input className="input-glow w-full px-4 py-3 text-sm" placeholder="Username *" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              <input className="input-glow w-full px-4 py-3 text-sm" type="password" placeholder="Password *" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <select
                className="input-glow w-full px-4 py-3 text-sm bg-transparent"
                value={communityId}
                onChange={(e) => setCommunityId(e.target.value)}
              >
                <option value="" className="bg-navy-800">Select community *</option>
                {communities.map((c) => (
                  <option key={c.id} value={c.id} className="bg-navy-800">{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 text-sm text-slate-400 glass-panel hover:bg-surface-hover rounded-xl transition-all">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || !username.trim() || !password.trim() || !communityId}
                className="flex-1 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-glow-blue/20"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/app/community-admins/page.tsx
git commit -m "feat(admin): add community admins management page"
```

---

### Task 10: Convert Dashboard to client component

**Files:**
- Modify: `apps/admin-portal/app/page.tsx`

- [ ] **Step 1: Convert dashboard from server to client component**

The dashboard (`app/page.tsx`) is currently a server component that calls `apiFetch` at render time. Since the token now comes from localStorage (client-side), it must become a client component.

Read the current file, then add `'use client';` at the top and convert the server-side data fetching into `useEffect` + `useState` pattern. Keep all the JSX and styling unchanged — only change how data is loaded.

The key changes:
- Add `'use client';` directive
- Add `useState` for stats, recentEvents, gates
- Add `useEffect` to call the same fetch functions on mount
- Add loading state
- Keep all JSX and Tailwind classes exactly as they are

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/app/page.tsx
git commit -m "feat(admin): convert dashboard to client component for dynamic auth"
```

---

### Task 11: Run migration and smoke test

- [ ] **Step 1: Run migration locally**

```bash
docker exec -i $(docker ps -q -f name=postgres) psql -U cguser -d communitygate < services/api-gateway/migrations/007_admins.sql
```

- [ ] **Step 2: Generate correct bcrypt hash**

```bash
cd services/api-gateway && node -e "import('bcryptjs').then(b => console.log(b.hashSync('admin123', 10)))"
```

Update the hash in the migration file if needed, then re-run the INSERT.

- [ ] **Step 3: Test admin-login API**

```bash
curl -X POST http://localhost:3000/api/v1/auth/admin-login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"admin123"}'
```

Expected: `{"success":true,"data":{"token":"...","user":{"id":"...","name":"Super Admin","role":"super_admin","communityId":null}}}`

- [ ] **Step 4: Test super admin API**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/admin-login -H "Content-Type: application/json" -d '{"username":"superadmin","password":"admin123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).data.token))")

curl -s http://localhost:3000/api/v1/admin/communities -H "Authorization: Bearer $TOKEN"
```

Expected: list of communities with stats

- [ ] **Step 5: Test admin portal login**

Open http://localhost:3100/login. Login with `superadmin` / `admin123`. Verify:
- Redirects to `/communities` page
- Shows community cards with stats
- Click community → goes to dashboard with "Back to Communities" link
- Sidebar shows "Communities" and "Admins" links
- Logout button works
