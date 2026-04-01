# Multi-Community SaaS Support — Sub-project 1

Role system, super admin API, admin portal login, and community selector to turn CommunityGate from a single-community MVP into a multi-tenant SaaS platform.

## Context

The database schema already has `community_id` on every table and all API queries filter by it. This project adds the management layer: roles, admin accounts, community CRUD, and a portal login flow so multiple communities can be managed from one deployment.

## Roles

| Role | Scope | Access |
|------|-------|--------|
| `super_admin` | Platform-wide | CRUD communities, manage community admins, view all data |
| `community_admin` | One community | Manage gates, vehicles, units, residents, events, reports for their community |
| `guard` | One community + gate | Gate operations (unchanged) |
| `resident` | One community + unit | Resident app (unchanged) |

## Database Changes

### New table: `admins`

```sql
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'community_admin')),
  community_id UUID REFERENCES communities(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

- `community_id` is NULL for super_admin, required for community_admin
- Passwords hashed with bcrypt
- Seed: `superadmin / admin123` as the initial super_admin account

### Alter `communities` table

```sql
ALTER TABLE communities ADD COLUMN address TEXT;
ALTER TABLE communities ADD COLUMN contact_name VARCHAR(200);
ALTER TABLE communities ADD COLUMN contact_phone VARCHAR(15);
```

## Auth Changes

### New endpoint: `POST /api/v1/auth/admin-login`

Request: `{ "username": string, "password": string }`

Response:
```json
{
  "token": "JWT",
  "user": {
    "id": "uuid",
    "name": "string",
    "role": "super_admin | community_admin",
    "communityId": "uuid | null"
  }
}
```

JWT payload:
```json
{
  "sub": "admin-uuid",
  "role": "super_admin | community_admin",
  "community_id": "uuid | null",
  "name": "Admin Name"
}
```

- Uses bcrypt to verify password against `admins.password_hash`
- Rate limited: 5 attempts/minute per IP (same as guard login)
- Token expiry: 24h

### Middleware update

Update `authenticateJWT(roles)` to accept `super_admin` and `community_admin` in addition to existing roles. Existing routes that check for `admin` role should accept both `super_admin` and `community_admin`.

## Super Admin API

New file: `src/routes/admin.js`

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/admin/communities` | super_admin | List all communities with aggregate stats |
| POST | `/admin/communities` | super_admin | Create community (name, address, contact_name, contact_phone) |
| PUT | `/admin/communities/:id` | super_admin | Update community details |
| GET | `/admin/communities/:id` | super_admin | Get community with full stats |
| GET | `/admin/community-admins` | super_admin | List all community admins |
| POST | `/admin/community-admins` | super_admin | Create admin (name, username, password, community_id) |
| DELETE | `/admin/community-admins/:id` | super_admin | Deactivate admin (set is_active=false) |

### Community stats query

```sql
SELECT c.*,
  (SELECT count(*) FROM gates WHERE community_id = c.id) as gate_count,
  (SELECT count(*) FROM units WHERE community_id = c.id) as unit_count,
  (SELECT count(*) FROM residents WHERE community_id = c.id AND is_active = true) as resident_count,
  (SELECT count(*) FROM vehicles WHERE community_id = c.id AND is_active = true) as vehicle_count
FROM communities c ORDER BY c.name;
```

## Admin Portal Changes

### New: Login screen (`/login`)

- Username/password form with Gradient Glow styling
- Calls `POST /api/v1/auth/admin-login`
- Stores JWT in localStorage
- All API calls use stored JWT (replace static `NEXT_PUBLIC_ADMIN_TOKEN`)
- Logout clears localStorage and redirects to `/login`
- Unauthenticated access redirects to `/login`

### New: Auth context

- React context providing `user`, `token`, `login()`, `logout()`, `isAuthenticated`
- Wraps the app in layout.tsx
- Reads/writes localStorage for persistence

### New: Communities page (`/communities`) — super_admin only

- Grid of community cards: name, address, gate count, unit count, resident count
- "Add Community" button → modal form
- Click card → sets `selectedCommunityId` in localStorage → redirects to `/`

### New: Community Admins page (`/community-admins`) — super_admin only

- Table of admin accounts: name, username, community, role, status
- "Add Admin" button → modal form (name, username, password, community selector)
- Deactivate button per row

### Modified: Sidebar

- Super admin: shows "Communities" and "Admins" links at top, then standard nav (when viewing a community)
- Community admin: shows standard nav only (dashboard, vehicles, gates, etc.)
- When super admin is viewing a community: header shows "Viewing: {name}" with "Back to Communities" link

### Modified: API client (`lib/api.ts`)

- Replace static `NEXT_PUBLIC_ADMIN_TOKEN` with token from auth context/localStorage
- For super admin viewing a community: override `community_id` by passing it as a query param or custom header
- For community admin: `community_id` comes from JWT automatically

### Modified: Existing pages

- All existing pages work unchanged for community_admin (JWT has community_id)
- For super_admin viewing a community: API calls pass the selected community_id
- Dashboard (server component) needs to become a client component to read auth state

## Dependencies

- `bcryptjs` — password hashing (pure JS, no native deps)

## Seed Data

```sql
INSERT INTO admins (id, name, username, password_hash, role, community_id)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  'Super Admin',
  'superadmin',
  '$2a$10$...', -- bcrypt hash of 'admin123'
  'super_admin',
  NULL
);
```

## Out of Scope

- Self-service community signup (sub-project 2)
- Bulk import wizard (sub-project 2)
- Device token generation UI (sub-project 2)
- Cognito integration (separate task)
- Billing/subscription
