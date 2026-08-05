# Basera Community Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Community tab of the Basera resident app against the backend delivered by `docs/superpowers/plans/2026-08-04-community-backend.md` — a filterable unified feed, an issue thread with an immutable status timeline and role-gated RWA controls, and a poll composer.

**Architecture:** Rebuilds `CommunityScreen` to read the new `posts` array instead of the deprecated grouped keys, and adds two sub-screens plus an extended compose sheet. Navigation follows the app's existing pattern exactly: **local `useState` swaps, not routes** — this app has one expo-router entry (`app/index.tsx`) doing hand-rolled tab switching, and detail views are rendered by early-return with plain props (see `NoticeBoardScreen` → `ThreadView`). One backend task first, because committee status currently only reaches the client inside a login-time JWT.

**Tech Stack:** React Native 0.76 / Expo SDK 52, TypeScript, zustand 5, axios, jest + `jest-expo` + `@testing-library/react-native`. Backend is Node 20 ESM + vitest.

**Spec:** `docs/superpowers/specs/2026-08-04-basera-community-module-design.md`

## Global Constraints

- **Navigation is local state, never routes.** Do not add files under `app/`. Do not add React Navigation stacks. A detail view is `const [x, setX] = useState(...)` plus `if (x) return <Detail ... onBack={...} />`, exactly like `CommunityScreen`'s `noticesOpen` and `NoticeBoardScreen`'s `selected`.
- **Params are React props.** Pass whole objects down; there are no route params.
- **`import { type } from '../theme/typography'`** — the typography export is literally named `type`, shadowing the TS keyword. Never write `import type { X }` in a file that also imports it; use `import { type as t }` only if you must, otherwise put type-only imports on a separate `import type` line placed *before* it and keep the identifier `type` for styles. Existing screens already do this; copy their import block.
- **Theme tokens already match the BRD.** `colors.brandPrimary` `#1B3A4B` is Deep Ocean, `colors.actionPrimary` `#F59E0B` is Amber. Do not add new colors; `src/theme/colors.test.ts` pins these values.
- **Permissions are presentation only.** Hiding a control never authorises anything — the server enforces every rule. Never assume a hidden control means the API cannot be called.
- **Tests:** `pnpm --filter resident-app test` (jest, currently 91 passing across 40 suites) and `pnpm --filter resident-app typecheck` (`tsc --noEmit`). Backend task also runs `pnpm --filter api-gateway test` (currently 411 passing).
- **`jest.config.js` sets `maxWorkers: 2`** deliberately — async `waitFor()` tests time out non-deterministically above that. Do not change it.
- Mock the API with `jest.mock('../api/client')` (auto-mock, no factory) and reset zustand between tests with `useCommunityStore.setState({...})`, matching `communityStore.test.ts`.
- **Do not touch the deprecated grouped feed keys** on the server. `announcements`/`issues`/`polls` stay until every installed app is on these screens.

---

### Task 1: Fresh committee capability from the server

The client currently learns committee status **only** from `is_committee` baked into the JWT at login (`services/api-gateway/src/routes/auth.js:234`). A resident appointed via the new Admin Portal screen keeps a stale token and would never see the RWA controls until they log out and back in. There is also no `committee_role` anywhere on the client, so the BRD's "Rajan Kumar · Secretary" byline is unrenderable. Both are fixed server-side, computed fresh per request, following the `canManage` convention `assemblePolls` already uses for polls.

**Files:**
- Modify: `services/api-gateway/src/routes/community-feed.js` (the `success(res, {...})` call at the end)
- Modify: `services/api-gateway/src/routes/issues.js` (`GET /issues/:id` response)
- Test: `services/api-gateway/src/__tests__/community-capability.test.js`

**Interfaces:**
- Consumes: `isCommittee`, `roleLabel` from `../lib/committee.js`; `isAdminUser` from `../middleware/auth.js`.
- Produces: `GET /community/feed` response gains `me: { isCommittee: boolean, committeeRole: string | null }`; `GET /issues/:id` response gains `canChangeStatus: boolean`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db/pool.js', () => ({
  default: { query: vi.fn(), connect: vi.fn(), on: vi.fn() },
}));
vi.mock('../../src/lib/fcm.js', () => ({
  sendNotification: vi.fn(), sendToMultiple: vi.fn().mockResolvedValue({ successCount: 0 }),
  sendVisitorAlert: vi.fn(), sendApprovalRequest: vi.fn(),
}));
vi.mock('../../src/websocket.js', () => ({ broadcast: vi.fn(), initWebSocket: vi.fn(), getIO: vi.fn() }));

const { default: app } = await import('../index.js');
const { generateTestToken } = await import('../middleware/auth.js');
const { queryOne, queryRows } = await import('../db/queries.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  return () => server.close();
});
beforeEach(() => {
  queryOne.mockReset(); queryRows.mockReset();
  queryOne.mockResolvedValue(null); queryRows.mockResolvedValue([]);
});

const resident = generateTestToken({ sub: 'r1', role: 'resident', community_id: 'c1', unit_id: 'u1', name: 'Asha' });

async function get(path, token) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}

describe('committee capability is computed fresh, not read from the token', () => {
  it('reports a committee member from the database, not the JWT', async () => {
    // feed: announcements, issues, discussions, then fetchPolls' callerBlock queryOne,
    // then the `me` lookup. See community-feed.js's call-order note.
    queryOne
      .mockResolvedValueOnce({ block_id: null })
      .mockResolvedValueOnce({ committee_role: 'secretary' });
    const { status, json } = await get('/api/v1/community/feed', resident);
    expect(status).toBe(200);
    expect(json.data.me).toEqual({ isCommittee: true, committeeRole: 'Secretary' });
  });

  it('reports a plain resident as not committee', async () => {
    queryOne
      .mockResolvedValueOnce({ block_id: null })
      .mockResolvedValueOnce({ committee_role: null });
    const { json } = await get('/api/v1/community/feed', resident);
    expect(json.data.me).toEqual({ isCommittee: false, committeeRole: null });
  });

  it('still returns the deprecated grouped keys alongside me', async () => {
    queryOne.mockResolvedValueOnce({ block_id: null }).mockResolvedValueOnce(null);
    const { json } = await get('/api/v1/community/feed', resident);
    expect(json.data).toHaveProperty('announcements');
    expect(json.data).toHaveProperty('issues');
    expect(json.data).toHaveProperty('polls');
    expect(json.data).toHaveProperty('posts');
  });

  it('exposes canChangeStatus on an issue thread for a committee member', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'i1', title: 'Lift', body: 'stuck', category: 'maintenance', status: 'open', author_name: 'Asha', author_unit: 'A-704', reference: 'IQ-2026-001', assignee_name: null, resolved_at: null, created_at: new Date().toISOString() })
      .mockResolvedValueOnce({ total: 0, mine: 0 })
      .mockResolvedValueOnce({ committee_role: 'president' });
    const { json } = await get('/api/v1/issues/i1', resident);
    expect(json.data.canChangeStatus).toBe(true);
  });

  it('exposes canChangeStatus false for a plain resident', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'i1', title: 'Lift', body: 'stuck', category: 'maintenance', status: 'open', author_name: 'Asha', author_unit: 'A-704', reference: 'IQ-2026-001', assignee_name: null, resolved_at: null, created_at: new Date().toISOString() })
      .mockResolvedValueOnce({ total: 0, mine: 0 })
      .mockResolvedValueOnce({ committee_role: null });
    const { json } = await get('/api/v1/issues/i1', resident);
    expect(json.data.canChangeStatus).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter api-gateway test community-capability`
Expected: FAIL — `json.data.me` is `undefined`.

- [ ] **Step 3: Add a shared resolver**

Add to `services/api-gateway/src/lib/committee.js`:

```js
/**
 * The caller's committee standing, read fresh from the database.
 *
 * Residents carry `is_committee` inside a JWT minted at login, so a resident
 * appointed (or removed) afterwards would keep the old answer until they log
 * in again. Every client-facing capability flag is therefore computed per
 * request from `residents.committee_role`, never from the token.
 */
export async function resolveCaller(queryOne, user) {
  if (!user || user.role === 'guard') return { isCommittee: false, committeeRole: null };
  const row = await queryOne(
    `SELECT committee_role FROM residents
      WHERE id = $1 AND community_id = $2 AND is_active = true`,
    [user.sub, user.community_id]
  );
  const label = roleLabel(row?.committee_role);
  return { isCommittee: isCommittee(row), committeeRole: label || null };
}
```

- [ ] **Step 4: Return `me` from the feed**

In `services/api-gateway/src/routes/community-feed.js`, import `resolveCaller` from `../lib/committee.js` and `queryOne` (already imported). After the `Promise.allSettled` block and before `return success(...)`, add:

```js
  // Computed after the feed sections so it cannot shift their positional
  // query order (community.test.js and community-feed.test.js both assert it).
  const me = await resolveCaller(queryOne, req.user);
```

and add `me,` to the `success(res, { ... })` object, above the deprecated keys.

- [ ] **Step 5: Return `canChangeStatus` from the issue thread**

In `services/api-gateway/src/routes/issues.js`, add `resolveCaller` to the existing `../lib/committee.js` import (the file already imports `canChangeStatus, canPostIssue, isCommittee, roleLabel` there, and already imports `isAdminUser` from `../middleware/auth.js` — do not add a second import line for either). Then, inside `GET /issues/:id`, after the `Promise.all` destructure add:

```js
    // Portal admins may also change status (see PUT /issues/:id/status), so the
    // flag must admit them too or the portal's own thread view would hide the
    // control it is allowed to use.
    const caller = isAdminUser(req.user)
      ? { isCommittee: true }
      : await resolveCaller(queryOne, req.user);
```

and add `canChangeStatus: Boolean(caller.isCommittee),` to the `success(res, {...})` object.

- [ ] **Step 6: Run both suites**

Run: `pnpm --filter api-gateway test`
Expected: PASS — the new file plus no regressions (411 passing before this task).

- [ ] **Step 7: Commit**

```bash
git add services/api-gateway/src/lib/committee.js services/api-gateway/src/routes/community-feed.js services/api-gateway/src/routes/issues.js services/api-gateway/src/__tests__/community-capability.test.js
git commit -m "feat(api): expose fresh committee capability to the resident app"
```

---

### Task 2: API client — the endpoints the new screens need

**Files:**
- Modify: `apps/resident-app/src/api/client.ts` (append beside the existing community exports, around line 216-223)
- Test: `apps/resident-app/src/api/client.test.ts`

**Interfaces:**
- Consumes: the module-level `api` axios instance already defined at `client.ts:14`.
- Produces:
  - `getCommunityFeed()` — unchanged signature, now also returns `posts` and `me`
  - `getIssue(id: string)`
  - `replyToIssue(id: string, body: string)`
  - `changeIssueStatus(id: string, status: string, assigneeName?: string)`
  - `uploadIssuePhotos(id: string, uris: string[])`
  - `createPoll(data: CreatePollBody)` — widened
  - `createAnnouncement(data: { title: string; body: string; priority?: 'normal' | 'urgent' })`
  - `createDiscussion(data: { title: string; body: string })`

- [ ] **Step 1: Write the failing test**

```ts
import * as api from './client';
import instance from './client';

jest.mock('axios', () => {
  const post = jest.fn(() => Promise.resolve({ data: {} }));
  const get = jest.fn(() => Promise.resolve({ data: {} }));
  const put = jest.fn(() => Promise.resolve({ data: {} }));
  return {
    __esModule: true,
    default: {
      create: () => ({
        get, post, put, delete: jest.fn(),
        defaults: { headers: { common: {} } },
        interceptors: { response: { use: jest.fn() }, request: { use: jest.fn() } },
      }),
    },
  };
});

describe('community api surface', () => {
  it('fetches one issue thread', () => {
    api.getIssue('i1');
    expect((instance.get as jest.Mock)).toHaveBeenCalledWith('/issues/i1');
  });

  it('posts a reply', () => {
    api.replyToIssue('i1', 'On it');
    expect((instance.post as jest.Mock)).toHaveBeenCalledWith('/issues/i1/replies', { body: 'On it' });
  });

  it('changes status with an optional assignee', () => {
    api.changeIssueStatus('i1', 'in_progress', 'Ramesh');
    expect((instance.put as jest.Mock)).toHaveBeenCalledWith('/issues/i1/status', {
      status: 'in_progress', assignee_name: 'Ramesh',
    });
  });

  it('omits assignee_name when not given', () => {
    api.changeIssueStatus('i1', 'resolved');
    expect((instance.put as jest.Mock)).toHaveBeenCalledWith('/issues/i1/status', { status: 'resolved' });
  });

  it('sends photos as multipart under the field name the server expects', () => {
    api.uploadIssuePhotos('i1', ['file:///a.jpg', 'file:///b.jpg']);
    const [url, form, config] = (instance.post as jest.Mock).mock.calls.at(-1)!;
    expect(url).toBe('/issues/i1/photos');
    expect(form).toBeInstanceOf(FormData);
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
  });

  it('creates an announcement with a priority', () => {
    api.createAnnouncement({ title: 'AGM', body: 'Sunday', priority: 'urgent' });
    expect((instance.post as jest.Mock)).toHaveBeenCalledWith('/notices', {
      title: 'AGM', body: 'Sunday', category: 'official', priority: 'urgent',
    });
  });

  it('creates a discussion under the discussion category', () => {
    api.createDiscussion({ title: 'Lift noise', body: 'Anyone else?' });
    expect((instance.post as jest.Mock)).toHaveBeenCalledWith('/notices', {
      title: 'Lift noise', body: 'Anyone else?', category: 'discussion',
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/api/client.test.ts`
Expected: FAIL — `api.getIssue is not a function`.

- [ ] **Step 3: Implement**

Append to `apps/resident-app/src/api/client.ts`, next to the existing community exports:

```ts
export type PostType = 'announcement' | 'issue' | 'poll' | 'discussion';
export type PollAudience = 'all' | 'owners' | 'block';

export interface CreatePollBody {
  topic?: string;
  question: string;
  options: string[];
  closesAt?: string;
  audience?: PollAudience;
  targetBlockId?: string | null;
  oneVotePerUnit?: boolean;
  isAnonymous?: boolean;
  showLiveResults?: boolean;
}

export const getIssue = (id: string) => api.get(`/issues/${id}`);

export const replyToIssue = (id: string, body: string) =>
  api.post(`/issues/${id}/replies`, { body });

export const changeIssueStatus = (id: string, status: string, assigneeName?: string) =>
  api.put(`/issues/${id}/status`, assigneeName ? { status, assignee_name: assigneeName } : { status });

// The server's multer field is `photos` and it caps the request at 5 files
// (MAX_ISSUE_PHOTOS in services/api-gateway/src/routes/issues.js).
export const uploadIssuePhotos = (id: string, uris: string[]) => {
  const form = new FormData();
  uris.forEach((uri, i) => {
    form.append('photos', {
      uri,
      name: `photo-${i}.jpg`,
      type: 'image/jpeg',
    } as unknown as Blob);
  });
  return api.post(`/issues/${id}/photos`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const createAnnouncement = (data: { title: string; body: string; priority?: 'normal' | 'urgent' }) =>
  api.post('/notices', { ...data, category: 'official' });

export const createDiscussion = (data: { title: string; body: string }) =>
  api.post('/notices', { ...data, category: 'discussion' });
```

Then **replace** the existing `createPoll` export with the widened one:

```ts
export const createPoll = (data: CreatePollBody) => api.post('/polls', data);
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter resident-app exec jest src/api/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: PASS, 91 existing tests still green.

- [ ] **Step 6: Commit**

```bash
git add apps/resident-app/src/api/client.ts apps/resident-app/src/api/client.test.ts
git commit -m "feat(app): api client for issue threads, photos and the widened poll body"
```

---

### Task 3: communityStore — posts, filters, optimistic upvote

Replaces the grouped-feed state with the unified `posts` array while keeping the store's existing zustand shape and testing style.

**Files:**
- Modify: `apps/resident-app/src/store/communityStore.ts`
- Modify: `apps/resident-app/src/store/communityStore.test.ts`

**Interfaces:**
- Consumes: `api.getCommunityFeed`, `api.upvoteIssue`, `api.votePoll` from Task 2's client.
- Produces, exported from `communityStore.ts`:
  - types `PostType`, `FeedPost`, `AnnouncementPost`, `IssuePost`, `PollPost`, `DiscussionPost`, `Me`
  - `useCommunityStore` with `{ posts, me, loading, error, filter, fetch, setFilter, visiblePosts, toggleUpvote, castVote }`
  - `Issue`, `Poll`, `PollOption`, `Announcement` stay exported unchanged — `IssueCard`, `PollCard` and `AnnouncementCard` import them.

- [ ] **Step 1: Write the failing test**

Replace the body of `communityStore.test.ts` with:

```ts
import { useCommunityStore } from './communityStore';
import * as api from '../api/client';

jest.mock('../api/client');

const post = (id: string, type: string, iso: string, extra: object = {}) =>
  ({ id, type, createdAt: iso, ...extra });

const sample = {
  posts: [
    post('a1', 'announcement', '2026-08-01T09:00:00Z', { title: 'Water cut', body: 'Tuesday', authorName: 'RWA' }),
    post('i1', 'issue', '2026-08-03T09:00:00Z', { title: 'Lift broken', body: 'Stuck', category: 'maintenance', status: 'open', authorName: 'Asha', authorUnit: 'A-704', upvoteCount: 3, myUpvoted: false }),
    post('p1', 'poll', '2026-08-02T09:00:00Z', { question: 'Gym hours?', status: 'open', options: [{ id: 'o1', label: '6am', votes: 2 }], totalVotes: 2, myOptionId: null, canManage: false }),
    post('d1', 'discussion', '2026-07-30T09:00:00Z', { title: 'Parking', body: 'Thoughts?', authorName: 'Ravi' }),
  ],
  me: { isCommittee: false, committeeRole: null },
  announcements: [], issues: [], polls: [],
};

beforeEach(() => {
  useCommunityStore.setState({ posts: [], me: null, loading: false, error: false, filter: 'all' });
  jest.clearAllMocks();
});

describe('communityStore', () => {
  it('loads posts and the caller capability', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    expect(useCommunityStore.getState().posts).toHaveLength(4);
    expect(useCommunityStore.getState().me).toEqual({ isCommittee: false, committeeRole: null });
    expect(useCommunityStore.getState().error).toBe(false);
  });

  it('flags an error without discarding what it already had', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    (api.getCommunityFeed as jest.Mock).mockRejectedValue(new Error('offline'));
    await useCommunityStore.getState().fetch();
    expect(useCommunityStore.getState().error).toBe(true);
    expect(useCommunityStore.getState().posts).toHaveLength(4);
  });

  it('filters by type without refetching', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    useCommunityStore.getState().setFilter('issue');
    expect(useCommunityStore.getState().visiblePosts().map((p) => p.id)).toEqual(['i1']);
    expect(api.getCommunityFeed).toHaveBeenCalledTimes(1);
  });

  it('applies an upvote immediately and keeps it when the server agrees', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    (api.upvoteIssue as jest.Mock).mockResolvedValue({ data: { data: { upvoted: true } } });

    await useCommunityStore.getState().toggleUpvote('i1');

    const issue: any = useCommunityStore.getState().posts.find((p) => p.id === 'i1');
    expect(issue.myUpvoted).toBe(true);
    expect(issue.upvoteCount).toBe(4);
  });

  it('reverts the upvote when the server rejects it', async () => {
    (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: sample } });
    await useCommunityStore.getState().fetch();
    (api.upvoteIssue as jest.Mock).mockRejectedValue(new Error('500'));

    await useCommunityStore.getState().toggleUpvote('i1');

    const issue: any = useCommunityStore.getState().posts.find((p) => p.id === 'i1');
    expect(issue.myUpvoted).toBe(false);
    expect(issue.upvoteCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/store/communityStore.test.ts`
Expected: FAIL — `setFilter is not a function`.

- [ ] **Step 3: Implement**

Rewrite `apps/resident-app/src/store/communityStore.ts`:

```ts
import { create } from 'zustand';
import * as api from '../api/client';

export interface Announcement { id: string; title: string; body: string; authorName: string; createdAt: string; }
export interface Issue { id: string; title: string; body: string; category: string; status: string; authorName: string; authorUnit: string | null; upvoteCount: number; myUpvoted: boolean; createdAt: string; }
export interface PollOption { id: string; label: string; votes: number | null; }
export interface Poll { id: string; topic?: string | null; question: string; status: string; closesAt: string | null; targetBlockId: string | null; canManage: boolean; authorName: string; createdAt: string; totalVotes: number | null; myOptionId: string | null; showLiveResults?: boolean; isAnonymous?: boolean; options: PollOption[]; }
export interface Discussion { id: string; title: string; body: string; authorName: string; createdAt: string; }

export type PostType = 'announcement' | 'issue' | 'poll' | 'discussion';
export type FeedFilter = 'all' | PostType;

export type AnnouncementPost = Announcement & { type: 'announcement' };
export type IssuePost = Issue & { type: 'issue' };
export type PollPost = Poll & { type: 'poll' };
export type DiscussionPost = Discussion & { type: 'discussion' };
export type FeedPost = AnnouncementPost | IssuePost | PollPost | DiscussionPost;

export interface Me { isCommittee: boolean; committeeRole: string | null; }

interface CommunityState {
  posts: FeedPost[];
  me: Me | null;
  loading: boolean;
  error: boolean;
  filter: FeedFilter;
  fetch: () => Promise<void>;
  setFilter: (filter: FeedFilter) => void;
  visiblePosts: () => FeedPost[];
  toggleUpvote: (issueId: string) => Promise<void>;
  castVote: (pollId: string, optionId: string) => Promise<void>;
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  posts: [],
  me: null,
  loading: false,
  error: false,
  filter: 'all',

  fetch: async () => {
    set({ loading: true, error: false });
    try {
      const res = await api.getCommunityFeed();
      const data = res.data.data;
      set({ posts: (data.posts ?? []) as FeedPost[], me: data.me ?? null });
    } catch {
      // Keep whatever is already on screen — a failed refresh should not blank
      // the feed someone is reading.
      set({ error: true });
    } finally {
      set({ loading: false });
    }
  },

  setFilter: (filter) => set({ filter }),

  // Filtering is client-side over data already held (BRD F-05), so switching a
  // tab is instant and costs no request. The server's ?type= filter exists for
  // callers that do not hold the feed.
  visiblePosts: () => {
    const { posts, filter } = get();
    return filter === 'all' ? posts : posts.filter((p) => p.type === filter);
  },

  toggleUpvote: async (issueId) => {
    const before = get().posts;
    const target = before.find((p) => p.id === issueId && p.type === 'issue') as IssuePost | undefined;
    if (!target) return;
    const next = !target.myUpvoted;

    set({
      posts: before.map((p) =>
        p.id === issueId && p.type === 'issue'
          ? { ...p, myUpvoted: next, upvoteCount: p.upvoteCount + (next ? 1 : -1) }
          : p
      ),
    });

    try {
      await api.upvoteIssue(issueId);
    } catch {
      // Put back exactly what was there, rather than applying an inverse delta —
      // a concurrent refresh could otherwise leave the count permanently wrong.
      set({ posts: before });
    }
  },

  castVote: async (pollId, optionId) => {
    try {
      await api.votePoll(pollId, optionId);
      await get().fetch();
    } catch {
      set({ error: true });
    }
  },
}));
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter resident-app exec jest src/store/communityStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Keep PollCard compiling**

Widening `PollOption.votes` and `Poll.totalVotes` to `number | null` breaks `PollCard.tsx`, which treats both as numbers. Apply the **minimal** narrowing now so the tree stays green — `option.votes ?? 0` and `poll.totalVotes ?? 0` at each use site. Do not change any rendering behaviour here; Task 11 replaces this with the real hidden-results handling.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: typecheck PASSES. `CommunityScreen.test.tsx` FAILS — it asserts the grouped shape and the screen still reads `feed.issues`. That single failure is expected and Task 4 fixes it. Every other suite must pass. **Do not modify `CommunityScreen` in this task**; note the failure and continue.

- [ ] **Step 7: Commit**

```bash
git add apps/resident-app/src/store/communityStore.ts apps/resident-app/src/store/communityStore.test.ts apps/resident-app/src/components/PollCard.tsx
git commit -m "feat(app): unified post feed in the community store with optimistic upvote"
```

---

### Task 4: CommunityScreen — Deep Ocean bar, filter tabs, unified feed

**Files:**
- Modify: `apps/resident-app/src/screens/CommunityScreen.tsx` (full rewrite)
- Create: `apps/resident-app/src/components/FilterTabs.tsx`
- Create: `apps/resident-app/src/components/DiscussionCard.tsx`
- Modify: `apps/resident-app/src/screens/CommunityScreen.test.tsx`
- Test: `apps/resident-app/src/components/FilterTabs.test.tsx`

**Interfaces:**
- Consumes: `useCommunityStore` (Task 3), `IssueCard`, `PollCard`, `AnnouncementCard`, `ComposeSheet`, `NoticeBoardScreen`.
- Produces: `FilterTabs` with props `{ value: FeedFilter; onChange: (f: FeedFilter) => void }`; `DiscussionCard` with props `{ discussion: Discussion; onPress?: () => void }`; `CommunityScreen` accepting an optional `initialIssueId?: string` prop (Task 11 uses it for deep links).

- [ ] **Step 1: Write the failing FilterTabs test**

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import FilterTabs from './FilterTabs';

describe('FilterTabs', () => {
  it('renders every filter the BRD names', () => {
    const { getByText } = render(<FilterTabs value="all" onChange={() => {}} />);
    ['All', 'Issues', 'Polls', 'Discussions', 'Notices'].forEach((label) => {
      expect(getByText(label)).toBeTruthy();
    });
  });

  it('reports the selected filter by its post type', () => {
    const onChange = jest.fn();
    const { getByText } = render(<FilterTabs value="all" onChange={onChange} />);
    fireEvent.press(getByText('Polls'));
    expect(onChange).toHaveBeenCalledWith('poll');
  });

  it('marks the active tab with the amber underline', () => {
    const { getByTestId } = render(<FilterTabs value="issue" onChange={() => {}} />);
    expect(getByTestId('filter-underline-issue')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/components/FilterTabs.test.tsx`
Expected: FAIL — cannot resolve `./FilterTabs`.

- [ ] **Step 3: Implement FilterTabs**

```tsx
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import type { FeedFilter } from '../store/communityStore';

const TABS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'issue', label: 'Issues' },
  { key: 'poll', label: 'Polls' },
  { key: 'discussion', label: 'Discussions' },
  { key: 'announcement', label: 'Notices' },
];

export default function FilterTabs({ value, onChange }: { value: FeedFilter; onChange: (f: FeedFilter) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={styles.tab}>
            <Text style={[type.caption, active ? styles.labelActive : styles.label]}>{tab.label}</Text>
            {active && <View testID={`filter-underline-${tab.key}`} style={styles.underline} />}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  tab: { paddingVertical: spacing.sm, alignItems: 'center' },
  label: { color: colors.textTertiary },
  labelActive: { color: colors.brandPrimary },
  underline: { marginTop: spacing.xs, height: 2, width: '100%', minWidth: 24, backgroundColor: colors.actionPrimary, borderRadius: 2 },
});
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm --filter resident-app exec jest src/components/FilterTabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Implement DiscussionCard**

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { Card } from './ui';
import type { Discussion } from '../store/communityStore';

export default function DiscussionCard({ discussion, onPress }: { discussion: Discussion; onPress?: () => void }) {
  return (
    <Card onPress={onPress}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="forum-outline" size={16} color={colors.textSecondary} />
        <Text style={type.caption}>Discussion</Text>
      </View>
      <Text style={type.h3}>{discussion.title}</Text>
      <Text style={type.bodySecondary} numberOfLines={3}>{discussion.body}</Text>
      <Text style={type.micro}>{discussion.authorName}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
});
```

- [ ] **Step 6: Rewrite the CommunityScreen test**

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CommunityScreen from './CommunityScreen';
import * as api from '../api/client';
import { useCommunityStore } from '../store/communityStore';

jest.mock('../api/client');

const feed = {
  posts: [
    { id: 'a1', type: 'announcement', title: 'Water cut', body: 'Tuesday', authorName: 'RWA', createdAt: '2026-08-01T09:00:00Z' },
    { id: 'i1', type: 'issue', title: 'Lift broken', body: 'Stuck', category: 'maintenance', status: 'open', authorName: 'Asha', authorUnit: 'A-704', upvoteCount: 3, myUpvoted: false, createdAt: '2026-08-03T09:00:00Z' },
    { id: 'd1', type: 'discussion', title: 'Parking talk', body: 'Thoughts?', authorName: 'Ravi', createdAt: '2026-07-30T09:00:00Z' },
  ],
  me: { isCommittee: false, committeeRole: null },
  announcements: [], issues: [], polls: [],
};

beforeEach(() => {
  useCommunityStore.setState({ posts: [], me: null, loading: false, error: false, filter: 'all' });
  jest.clearAllMocks();
  (api.getCommunityFeed as jest.Mock).mockResolvedValue({ data: { data: feed } });
  (api.upvoteIssue as jest.Mock).mockResolvedValue({ data: { data: { upvoted: true } } });
});

describe('CommunityScreen', () => {
  it('renders the unified feed with the announcement pinned first', async () => {
    const { getByText } = render(<CommunityScreen />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    expect(getByText('Water cut')).toBeTruthy();
    expect(getByText('Parking talk')).toBeTruthy();
  });

  it('upvotes an issue through the store', async () => {
    const { getByText } = render(<CommunityScreen />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    fireEvent.press(getByText(/Same issue/));
    await waitFor(() => expect(api.upvoteIssue).toHaveBeenCalledWith('i1'));
  });

  it('filters the feed to one type without refetching', async () => {
    const { getByText, queryByText } = render(<CommunityScreen />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    fireEvent.press(getByText('Discussions'));
    await waitFor(() => expect(queryByText('Lift broken')).toBeNull());
    expect(getByText('Parking talk')).toBeTruthy();
    expect(api.getCommunityFeed).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7: Rewrite CommunityScreen**

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card } from '../components/ui';
import AnnouncementCard from '../components/AnnouncementCard';
import IssueCard from '../components/IssueCard';
import PollCard from '../components/PollCard';
import DiscussionCard from '../components/DiscussionCard';
import FilterTabs from '../components/FilterTabs';
import ComposeSheet from './ComposeSheet';
import IssueDetailScreen from './IssueDetailScreen';
import NoticeBoardScreen from './NoticeBoardScreen';
import { useCommunityStore } from '../store/communityStore';
import type { FeedPost } from '../store/communityStore';

export default function CommunityScreen({ initialIssueId }: { initialIssueId?: string } = {}) {
  const { me, error, filter, fetch, setFilter, visiblePosts, toggleUpvote, castVote } = useCommunityStore();
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [openIssueId, setOpenIssueId] = useState<string | null>(initialIssueId ?? null);

  const load = useCallback(async () => { await fetch(); }, [fetch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (initialIssueId) setOpenIssueId(initialIssueId); }, [initialIssueId]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Detail views replace the tab content in place — this app has no navigation
  // stack (see the plan's Global Constraints and NoticeBoardScreen).
  if (openIssueId) {
    return <IssueDetailScreen issueId={openIssueId} onBack={() => { setOpenIssueId(null); load(); }} />;
  }
  if (noticesOpen) return <NoticeBoardScreen onClose={() => setNoticesOpen(false)} />;

  const posts = visiblePosts();

  const renderPost = (post: FeedPost) => {
    switch (post.type) {
      case 'announcement':
        return <AnnouncementCard announcement={post} />;
      case 'issue':
        return <IssueCard issue={post} onUpvote={toggleUpvote} onPress={() => setOpenIssueId(post.id)} />;
      case 'poll':
        return <PollCard poll={post} onVote={castVote} />;
      case 'discussion':
        return <DiscussionCard discussion={post} onPress={() => setNoticesOpen(true)} />;
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <AppBar title="Community" />
      <FilterTabs value={filter} onChange={setFilter} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        <Pressable style={styles.compose} onPress={() => setComposeOpen(true)}>
          <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.textSecondary} />
          <Text style={type.bodySecondary}>Share something with your community…</Text>
        </Pressable>

        {posts.length === 0 ? (
          <Card>
            <Text style={type.bodySecondary}>
              {error ? 'Could not load. Pull to refresh.' : 'Nothing here yet'}
            </Text>
          </Card>
        ) : (
          posts.map((post) => <View key={`${post.type}-${post.id}`} style={styles.item}>{renderPost(post)}</View>)
        )}
      </ScrollView>

      <ComposeSheet
        visible={composeOpen}
        isCommittee={Boolean(me?.isCommittee)}
        onClose={() => setComposeOpen(false)}
        onPosted={() => { setComposeOpen(false); load(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  item: { marginTop: spacing.sm },
  compose: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.surfaceBorder, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
```

- [ ] **Step 8: Add the `onPress` prop to IssueCard**

In `apps/resident-app/src/components/IssueCard.tsx`, widen the props to `{ issue: Issue; onUpvote: (id: string) => void; onPress?: () => void }` and pass `onPress` to the root `Card`. Do not change the upvote pill's text — `"Same issue · {upvoteCount}"` is asserted by tests.

- [ ] **Step 9: Create a placeholder IssueDetailScreen so this task compiles**

`CommunityScreen` above imports `IssueDetailScreen`, which Task 5 builds. Create the stub now — without it this task cannot typecheck:

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { AppBar } from '../components/ui';

export default function IssueDetailScreen({ issueId, onBack }: { issueId: string; onBack: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      <AppBar title="Issue" onBack={onBack} />
      <Text>{issueId}</Text>
    </View>
  );
}
```

Task 5 replaces this file wholesale. Do not write tests against the stub.

- [ ] **Step 10: Run the suite**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: PASS — `CommunityScreen.test.tsx` green again, `IssueCard.test.tsx` and `PollCard.test.tsx` still green.

- [ ] **Step 11: Commit**

```bash
git add apps/resident-app/src/screens/CommunityScreen.tsx apps/resident-app/src/screens/CommunityScreen.test.tsx apps/resident-app/src/components/FilterTabs.tsx apps/resident-app/src/components/FilterTabs.test.tsx apps/resident-app/src/components/DiscussionCard.tsx apps/resident-app/src/components/IssueCard.tsx apps/resident-app/src/screens/IssueDetailScreen.tsx
git commit -m "feat(app): unified community feed with type filters"
```

---

### Task 5: IssueDetailScreen — timeline, replies, impact counter

**Files:**
- Create: `apps/resident-app/src/screens/IssueDetailScreen.tsx`
- Create: `apps/resident-app/src/components/StatusTimeline.tsx`
- Test: `apps/resident-app/src/screens/IssueDetailScreen.test.tsx`
- Test: `apps/resident-app/src/components/StatusTimeline.test.tsx`

**Interfaces:**
- Consumes: `api.getIssue`, `api.replyToIssue` (Task 2).
- Produces: `IssueDetailScreen` with props `{ issueId: string; onBack: () => void }`; `StatusTimeline` with props `{ entries: TimelineEntry[] }` and exported `interface TimelineEntry { from_status: string | null; to_status: string | null; changed_by_name: string | null; changed_by_role: string | null; kind: string; detail: string | null; created_at: string }`.

- [ ] **Step 1: Write the failing StatusTimeline test**

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import StatusTimeline from './StatusTimeline';

const entries = [
  { from_status: null, to_status: 'open', changed_by_name: 'Asha', changed_by_role: null, kind: 'status_change', detail: 'Issue reported', created_at: '2026-08-01T09:00:00Z' },
  { from_status: null, to_status: null, changed_by_name: null, changed_by_role: null, kind: 'system', detail: '24 residents affected — community upvote threshold crossed', created_at: '2026-08-02T09:00:00Z' },
  { from_status: 'open', to_status: 'in_progress', changed_by_name: 'Rajan Kumar', changed_by_role: 'Secretary', kind: 'status_change', detail: null, created_at: '2026-08-03T09:00:00Z' },
];

describe('StatusTimeline', () => {
  it('renders an entry per event, oldest first', () => {
    const { getByText } = render(<StatusTimeline entries={entries} />);
    expect(getByText('Issue reported')).toBeTruthy();
    expect(getByText(/24 residents affected/)).toBeTruthy();
  });

  it('labels the actor with their role at the time', () => {
    const { getByText } = render(<StatusTimeline entries={entries} />);
    expect(getByText('Rajan Kumar · Secretary')).toBeTruthy();
  });

  it('shows a system entry with no actor name', () => {
    const { queryByText } = render(<StatusTimeline entries={[entries[1]]} />);
    expect(queryByText(/·/)).toBeNull();
  });

  it('renders nothing but stays mounted for an empty timeline', () => {
    const { toJSON } = render(<StatusTimeline entries={[]} />);
    expect(toJSON()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/components/StatusTimeline.test.tsx`
Expected: FAIL — cannot resolve `./StatusTimeline`.

- [ ] **Step 3: Implement StatusTimeline**

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';

export interface TimelineEntry {
  from_status: string | null;
  to_status: string | null;
  changed_by_name: string | null;
  changed_by_role: string | null;
  kind: string;
  detail: string | null;
  created_at: string;
}

const LABEL: Record<string, string> = {
  open: 'Reported',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

function line(entry: TimelineEntry): string {
  if (entry.detail) return entry.detail;
  return LABEL[entry.to_status ?? ''] ?? 'Updated';
}

// An audit record shows who someone WAS at the time, so the name and role come
// straight off the row — never re-joined against who they are now.
function actor(entry: TimelineEntry): string | null {
  if (!entry.changed_by_name) return null;
  return entry.changed_by_role
    ? `${entry.changed_by_name} · ${entry.changed_by_role}`
    : entry.changed_by_name;
}

export default function StatusTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <View style={styles.wrap}>
      {entries.map((entry, i) => {
        const who = actor(entry);
        return (
          <View key={`${entry.created_at}-${i}`} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, entry.kind === 'system' && styles.dotSystem]} />
              {i < entries.length - 1 && <View style={styles.stem} />}
            </View>
            <View style={styles.body}>
              <Text style={type.h3}>{line(entry)}</Text>
              {who && <Text style={type.micro}>{who}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  row: { flexDirection: 'row', gap: spacing.md },
  rail: { alignItems: 'center', width: 16 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary, marginTop: 4 },
  dotSystem: { backgroundColor: colors.actionPrimary },
  stem: { flex: 1, width: 2, backgroundColor: colors.surfaceBorder, marginVertical: 2 },
  body: { flex: 1, paddingBottom: spacing.lg, gap: 2 },
});
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm --filter resident-app exec jest src/components/StatusTimeline.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing IssueDetailScreen test**

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import IssueDetailScreen from './IssueDetailScreen';
import * as api from '../api/client';

jest.mock('../api/client');

const thread = {
  issue: {
    id: 'i1', title: 'Lift broken', body: 'Stuck on 7', category: 'maintenance', status: 'open',
    authorName: 'Asha', authorUnit: 'A-704', reference: 'IQ-2026-007',
    assigneeName: null, resolvedAt: null, upvoteCount: 24, myUpvoted: false,
    createdAt: '2026-08-01T09:00:00Z',
  },
  photos: [],
  timeline: [
    { from_status: null, to_status: 'open', changed_by_name: 'Asha', changed_by_role: null, kind: 'status_change', detail: 'Issue reported', created_at: '2026-08-01T09:00:00Z' },
  ],
  replies: [
    { id: 'rep1', author_name: 'Rajan Kumar', author_unit: 'B-201', author_role: 'Secretary', body: 'Technician booked', is_official: true, created_at: '2026-08-02T09:00:00Z' },
    { id: 'rep2', author_name: 'Ravi', author_unit: 'C-101', author_role: null, body: 'Same here', is_official: false, created_at: '2026-08-02T10:00:00Z' },
  ],
  upvoteCount: 24,
  myUpvoted: false,
  canChangeStatus: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.getIssue as jest.Mock).mockResolvedValue({ data: { data: thread } });
  (api.replyToIssue as jest.Mock).mockResolvedValue({ data: { data: { id: 'rep3', author_name: 'Asha', author_unit: 'A-704', author_role: null, body: 'Thanks', is_official: false, created_at: '2026-08-03T09:00:00Z' } } });
});

describe('IssueDetailScreen', () => {
  it('shows the reference and the impact counter', async () => {
    const { getByText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText('IQ-2026-007')).toBeTruthy());
    expect(getByText(/24 residents affected/)).toBeTruthy();
  });

  it('marks a committee reply as an official response and a resident reply not', async () => {
    const { getByText, queryAllByText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText('Technician booked')).toBeTruthy());
    expect(getByText('Official response')).toBeTruthy();
    expect(queryAllByText('Official response')).toHaveLength(1);
  });

  it('hides the RWA action bar when the caller cannot change status', async () => {
    const { getByText, queryByText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    expect(queryByText('Mark in progress')).toBeNull();
    expect(queryByText('Mark resolved')).toBeNull();
  });

  it('posts a reply and appends it', async () => {
    const { getByText, getByPlaceholderText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText('Lift broken')).toBeTruthy());
    fireEvent.changeText(getByPlaceholderText('Write a reply…'), 'Thanks');
    fireEvent.press(getByText('Send'));
    await waitFor(() => expect(api.replyToIssue).toHaveBeenCalledWith('i1', 'Thanks'));
    await waitFor(() => expect(getByText('Thanks')).toBeTruthy());
  });

  it('surfaces a load failure instead of rendering an empty thread', async () => {
    (api.getIssue as jest.Mock).mockRejectedValue(new Error('offline'));
    const { getByText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText(/Could not load/)).toBeTruthy());
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/screens/IssueDetailScreen.test.tsx`
Expected: FAIL — cannot resolve `./IssueDetailScreen`.

- [ ] **Step 7: Implement IssueDetailScreen**

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card } from '../components/ui';
import StatusTimeline from '../components/StatusTimeline';
import type { TimelineEntry } from '../components/StatusTimeline';
import RwaActionBar from '../components/RwaActionBar';
import * as api from '../api/client';
import { uploadUrl } from '../api/client';

interface Reply {
  id: string;
  author_name: string;
  author_unit: string | null;
  author_role: string | null;
  body: string;
  is_official: boolean;
  created_at: string;
}

interface Thread {
  issue: {
    id: string; title: string; body: string; category: string; status: string;
    authorName: string; authorUnit: string | null; reference: string | null;
    assigneeName: string | null; resolvedAt: string | null;
    upvoteCount: number; myUpvoted: boolean; createdAt: string;
  };
  photos: { id: string; path: string; position: number }[];
  timeline: TimelineEntry[];
  replies: Reply[];
  upvoteCount: number;
  myUpvoted: boolean;
  canChangeStatus: boolean;
}

export default function IssueDetailScreen({ issueId, onBack }: { issueId: string; onBack: () => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await api.getIssue(issueId);
      setThread(res.data.data as Thread);
    } catch {
      setFailed(true);
    }
  }, [issueId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await api.replyToIssue(issueId, body);
      const reply = res.data.data as Reply;
      setThread((t) => (t ? { ...t, replies: [...t.replies, reply] } : t));
      setDraft('');
    } catch {
      // Leave the draft in the box so the text is not lost.
    } finally {
      setSending(false);
    }
  };

  if (failed) {
    return (
      <View style={styles.container}>
        <AppBar title="Issue" onBack={onBack} />
        <View style={styles.centre}><Text style={type.bodySecondary}>Could not load this issue. Go back and try again.</Text></View>
      </View>
    );
  }

  if (!thread) {
    return (
      <View style={styles.container}>
        <AppBar title="Issue" onBack={onBack} />
        <View style={styles.centre}><ActivityIndicator color={colors.teal} /></View>
      </View>
    );
  }

  const { issue, photos, timeline, replies, upvoteCount, canChangeStatus } = thread;

  return (
    <View style={styles.container}>
      <AppBar title={issue.reference ?? 'Issue'} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          {issue.reference && <Text style={type.caption}>{issue.reference}</Text>}
          <Text style={type.h2}>{issue.title}</Text>
          <Text style={type.body}>{issue.body}</Text>
          <Text style={type.micro}>
            {issue.authorName}{issue.authorUnit ? ` · ${issue.authorUnit}` : ''} · {issue.category}
          </Text>
        </Card>

        {photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {photos.map((p) => (
              <Image key={p.id} source={{ uri: uploadUrl(p.path) }} style={styles.photo} />
            ))}
          </ScrollView>
        )}

        <Card style={styles.block}>
          <Text style={type.h3}>{upvoteCount} residents affected</Text>
        </Card>

        <Card style={styles.block}>
          <Text style={type.h3}>Status</Text>
          <View style={styles.timeline}><StatusTimeline entries={timeline} /></View>
        </Card>

        {canChangeStatus && (
          <RwaActionBar
            status={issue.status}
            onChange={async (next) => { await api.changeIssueStatus(issueId, next); await load(); }}
          />
        )}

        <View style={styles.block}>
          <Text style={type.h3}>Replies</Text>
          {replies.map((r) => (
            <View
              key={r.id}
              style={[styles.reply, r.is_official ? styles.replyOfficial : styles.replyPlain]}
            >
              {r.is_official && <Text style={styles.officialTag}>Official response</Text>}
              <Text style={type.micro}>
                {r.author_name}{r.author_role ? ` · ${r.author_role}` : r.author_unit ? ` · ${r.author_unit}` : ''}
              </Text>
              <Text style={type.body}>{r.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Write a reply…"
          placeholderTextColor={colors.textTertiary}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable onPress={send} style={styles.send}>
          <Text style={styles.sendLabel}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  scroll: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.sm },
  block: { marginTop: spacing.sm },
  timeline: { marginTop: spacing.md },
  photos: { gap: spacing.sm, paddingVertical: spacing.sm },
  photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceBorder },
  reply: { borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, gap: 2 },
  replyPlain: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  replyOfficial: { backgroundColor: colors.tintSuccess, borderWidth: 1, borderColor: colors.success },
  officialTag: { ...type.caption, color: colors.textSuccess },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
  input: { flex: 1, maxHeight: 96, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...type.body },
  send: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.actionPrimary },
  sendLabel: { ...type.caption, color: colors.textInverse },
});
```

- [ ] **Step 8: Create a placeholder RwaActionBar so the screen compiles**

Task 6 builds it properly. For now create `apps/resident-app/src/components/RwaActionBar.tsx`:

```tsx
import React from 'react';
import { View } from 'react-native';

export default function RwaActionBar(_props: { status: string; onChange: (next: string) => void | Promise<void> }) {
  return <View />;
}
```

- [ ] **Step 9: Run the tests**

Run: `pnpm --filter resident-app exec jest src/screens/IssueDetailScreen.test.tsx`
Expected: PASS — including the RWA-absent test, which passes trivially at this point and is re-asserted for real in Task 6.

- [ ] **Step 10: Run the suite and typecheck**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/resident-app/src/screens/IssueDetailScreen.tsx apps/resident-app/src/screens/IssueDetailScreen.test.tsx apps/resident-app/src/components/StatusTimeline.tsx apps/resident-app/src/components/StatusTimeline.test.tsx apps/resident-app/src/components/RwaActionBar.tsx
git commit -m "feat(app): issue thread with status timeline and official replies"
```

---

### Task 6: The RWA action bar

**Files:**
- Modify: `apps/resident-app/src/components/RwaActionBar.tsx` (replace the placeholder)
- Test: `apps/resident-app/src/components/RwaActionBar.test.tsx`
- Modify: `apps/resident-app/src/screens/IssueDetailScreen.test.tsx` (add the committee case)

**Interfaces:**
- Consumes: nothing.
- Produces: `RwaActionBar` with props `{ status: string; onChange: (next: string) => void | Promise<void> }`.

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import RwaActionBar from './RwaActionBar';

describe('RwaActionBar', () => {
  it('offers only the next forward step from open', () => {
    const { getByText, queryByText } = render(<RwaActionBar status="open" onChange={() => {}} />);
    expect(getByText('Mark in progress')).toBeTruthy();
    expect(queryByText('Mark resolved')).toBeNull();
  });

  it('offers resolve once the issue is in progress', () => {
    const { getByText, queryByText } = render(<RwaActionBar status="in_progress" onChange={() => {}} />);
    expect(getByText('Mark resolved')).toBeTruthy();
    expect(queryByText('Mark in progress')).toBeNull();
  });

  it('offers nothing once resolved — transitions are forward-only', () => {
    const { queryByText } = render(<RwaActionBar status="resolved" onChange={() => {}} />);
    expect(queryByText(/^Mark /)).toBeNull();
  });

  it('reports the target status, not a label', () => {
    const onChange = jest.fn();
    const { getByText } = render(<RwaActionBar status="open" onChange={onChange} />);
    fireEvent.press(getByText('Mark in progress'));
    expect(onChange).toHaveBeenCalledWith('in_progress');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/components/RwaActionBar.test.tsx`
Expected: FAIL — the placeholder renders nothing, so `getByText('Mark in progress')` throws.

- [ ] **Step 3: Implement**

```tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';

// Mirrors the server's forward-only rule (open -> in_progress -> resolved).
// Offering a backwards step would just produce a 422; a resolved issue that
// recurs is a new issue, so the original's audit trail stays true.
const NEXT: Record<string, { status: string; label: string } | undefined> = {
  open: { status: 'in_progress', label: 'Mark in progress' },
  in_progress: { status: 'resolved', label: 'Mark resolved' },
};

export default function RwaActionBar({
  status,
  onChange,
}: {
  status: string;
  onChange: (next: string) => void | Promise<void>;
}) {
  const next = NEXT[status];
  if (!next) return <View />;
  return (
    <View style={styles.bar}>
      <Text style={type.caption}>RWA actions</Text>
      <Pressable style={styles.button} onPress={() => onChange(next.status)}>
        <Text style={styles.label}>{next.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, gap: spacing.sm },
  button: { paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center' },
  label: { ...type.h3, color: colors.textInverse },
});
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm --filter resident-app exec jest src/components/RwaActionBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the committee case to the screen test**

Append inside `describe('IssueDetailScreen', ...)` in `IssueDetailScreen.test.tsx`:

```tsx
  it('shows the RWA action bar and changes status when the caller is committee', async () => {
    (api.getIssue as jest.Mock).mockResolvedValue({
      data: { data: { ...thread, canChangeStatus: true } },
    });
    (api.changeIssueStatus as jest.Mock).mockResolvedValue({ data: { data: { status: 'in_progress' } } });

    const { getByText } = render(<IssueDetailScreen issueId="i1" onBack={() => {}} />);
    await waitFor(() => expect(getByText('Mark in progress')).toBeTruthy());
    fireEvent.press(getByText('Mark in progress'));
    await waitFor(() => expect(api.changeIssueStatus).toHaveBeenCalledWith('i1', 'in_progress'));
  });
```

- [ ] **Step 6: Run the suite and typecheck**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: PASS. The "hides the RWA action bar" test from Task 5 now proves something real.

- [ ] **Step 7: Commit**

```bash
git add apps/resident-app/src/components/RwaActionBar.tsx apps/resident-app/src/components/RwaActionBar.test.tsx apps/resident-app/src/screens/IssueDetailScreen.test.tsx
git commit -m "feat(app): role-gated RWA action bar with forward-only transitions"
```

---

### Task 7: PollCreateScreen

**Files:**
- Create: `apps/resident-app/src/screens/PollCreateScreen.tsx`
- Test: `apps/resident-app/src/screens/PollCreateScreen.test.tsx`

**Interfaces:**
- Consumes: `api.createPoll`, `api.getBlocks`, type `CreatePollBody` (Task 2).
- Produces: `PollCreateScreen` with props `{ onCancel: () => void; onCreated: () => void }`; exported pure `canSubmitPoll(draft): boolean`.

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import PollCreateScreen, { canSubmitPoll } from './PollCreateScreen';
import * as api from '../api/client';

jest.mock('../api/client');

beforeEach(() => {
  jest.clearAllMocks();
  (api.getBlocks as jest.Mock).mockResolvedValue({ data: { data: [{ id: 'b1', name: 'Block A' }] } });
  (api.createPoll as jest.Mock).mockResolvedValue({ data: { data: { id: 'p1' } } });
});

describe('canSubmitPoll', () => {
  const base = { question: 'Gym hours?', options: ['6am', '7am'], audience: 'all' as const, targetBlockId: null };

  it('accepts two filled options and a question', () => {
    expect(canSubmitPoll(base)).toBe(true);
  });

  it('rejects a blank question', () => {
    expect(canSubmitPoll({ ...base, question: '   ' })).toBe(false);
  });

  it('rejects fewer than two filled options', () => {
    expect(canSubmitPoll({ ...base, options: ['6am', '  '] })).toBe(false);
  });

  it('rejects more than six options', () => {
    expect(canSubmitPoll({ ...base, options: ['1', '2', '3', '4', '5', '6', '7'] })).toBe(false);
  });

  it('rejects a block-audience poll with no block chosen', () => {
    expect(canSubmitPoll({ ...base, audience: 'block', targetBlockId: null })).toBe(false);
    expect(canSubmitPoll({ ...base, audience: 'block', targetBlockId: 'b1' })).toBe(true);
  });
});

describe('PollCreateScreen', () => {
  it('keeps the submit button inert until the draft is valid', async () => {
    const onCreated = jest.fn();
    const { getByText, getByPlaceholderText } = render(
      <PollCreateScreen onCancel={() => {}} onCreated={onCreated} />
    );
    fireEvent.press(getByText('Create poll'));
    expect(api.createPoll).not.toHaveBeenCalled();

    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Gym hours?');
    fireEvent.changeText(getByPlaceholderText('Option 1'), '6am');
    fireEvent.changeText(getByPlaceholderText('Option 2'), '7am');
    fireEvent.press(getByText('Create poll'));

    await waitFor(() => expect(api.createPoll).toHaveBeenCalled());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('sends the BRD rule toggles and audience', async () => {
    const { getByText, getByPlaceholderText } = render(
      <PollCreateScreen onCancel={() => {}} onCreated={() => {}} />
    );
    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Gym hours?');
    fireEvent.changeText(getByPlaceholderText('Option 1'), '6am');
    fireEvent.changeText(getByPlaceholderText('Option 2'), '7am');
    fireEvent.press(getByText('Owners only'));
    fireEvent.press(getByText('Create poll'));

    await waitFor(() => expect(api.createPoll).toHaveBeenCalled());
    const body = (api.createPoll as jest.Mock).mock.calls[0][0];
    expect(body.question).toBe('Gym hours?');
    expect(body.options).toEqual(['6am', '7am']);
    expect(body.audience).toBe('owners');
    expect(body.oneVotePerUnit).toBe(true);
    expect(body.isAnonymous).toBe(false);
    expect(body.showLiveResults).toBe(true);
  });

  it('adds and removes option rows within the 2-6 bounds', () => {
    const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(
      <PollCreateScreen onCancel={() => {}} onCreated={() => {}} />
    );
    fireEvent.press(getByText('Add option'));
    expect(getByPlaceholderText('Option 3')).toBeTruthy();
    fireEvent.press(getByText('Add option'));
    fireEvent.press(getByText('Add option'));
    fireEvent.press(getByText('Add option'));
    expect(getByPlaceholderText('Option 6')).toBeTruthy();
    fireEvent.press(getByText('Add option'));
    expect(queryByPlaceholderText('Option 7')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/screens/PollCreateScreen.test.tsx`
Expected: FAIL — cannot resolve `./PollCreateScreen`.

- [ ] **Step 3: Implement**

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Switch } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Card, Button } from '../components/ui';
import * as api from '../api/client';
import type { PollAudience } from '../api/client';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

interface Draft {
  question: string;
  options: string[];
  audience: PollAudience;
  targetBlockId: string | null;
}

/**
 * Mirrors the server's creation rules so the button is inert rather than
 * producing a 400. The server still validates — this is presentation.
 * A block-audience poll with no block would be votable by nobody, which is
 * why the server rejects it and why the button stays disabled here.
 */
export function canSubmitPoll(draft: Draft): boolean {
  const filled = draft.options.map((o) => o.trim()).filter(Boolean);
  if (!draft.question.trim()) return false;
  if (filled.length < MIN_OPTIONS || draft.options.length > MAX_OPTIONS) return false;
  if (filled.length !== draft.options.length) return false;
  if (draft.audience === 'block' && !draft.targetBlockId) return false;
  return true;
}

const AUDIENCES: { key: PollAudience; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'owners', label: 'Owners only' },
  { key: 'block', label: 'One block' },
];

export default function PollCreateScreen({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [topic, setTopic] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [audience, setAudience] = useState<PollAudience>('all');
  const [targetBlockId, setTargetBlockId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<{ id: string; name: string }[]>([]);
  const [oneVotePerUnit, setOneVotePerUnit] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showLiveResults, setShowLiveResults] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getBlocks()
      .then((res) => setBlocks(res.data.data ?? []))
      .catch(() => setBlocks([]));
  }, []);

  const draft: Draft = { question, options, audience, targetBlockId };
  const valid = canSubmitPoll(draft);

  const setOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));

  const addOption = () =>
    setOptions((prev) => (prev.length >= MAX_OPTIONS ? prev : [...prev, '']));

  const removeOption = (i: number) =>
    setOptions((prev) => (prev.length <= MIN_OPTIONS ? prev : prev.filter((_, idx) => idx !== i)));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.createPoll({
        topic: topic.trim() || undefined,
        question: question.trim(),
        options: options.map((o) => o.trim()),
        audience,
        targetBlockId: audience === 'block' ? targetBlockId : null,
        oneVotePerUnit,
        isAnonymous,
        showLiveResults,
      });
      onCreated();
    } catch {
      // Keep the draft on screen so nothing typed is lost.
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <AppBar title="Create poll" onBack={onCancel} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <Text style={type.caption}>Topic (optional)</Text>
          <TextInput style={styles.input} placeholder="e.g. Amenities" placeholderTextColor={colors.textTertiary} value={topic} onChangeText={setTopic} />
          <Text style={type.caption}>Question</Text>
          <TextInput style={styles.input} placeholder="Ask a question" placeholderTextColor={colors.textTertiary} value={question} onChangeText={setQuestion} />
        </Card>

        <Card style={styles.block}>
          <Text style={type.caption}>Options</Text>
          {options.map((value, i) => (
            <View key={i} style={styles.optionRow}>
              <TextInput
                style={[styles.input, styles.optionInput]}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={colors.textTertiary}
                value={value}
                onChangeText={(t) => setOption(i, t)}
              />
              {options.length > MIN_OPTIONS && (
                <Pressable onPress={() => removeOption(i)}><Text style={type.micro}>Remove</Text></Pressable>
              )}
            </View>
          ))}
          {options.length < MAX_OPTIONS && (
            <Pressable onPress={addOption}><Text style={styles.addOption}>Add option</Text></Pressable>
          )}
        </Card>

        <Card style={styles.block}>
          <Text style={type.caption}>Who can vote</Text>
          <View style={styles.chips}>
            {AUDIENCES.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => setAudience(a.key)}
                style={[styles.chip, audience === a.key && styles.chipActive]}
              >
                <Text style={audience === a.key ? styles.chipLabelActive : styles.chipLabel}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
          {audience === 'block' && (
            <View style={styles.chips}>
              {blocks.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => setTargetBlockId(b.id)}
                  style={[styles.chip, targetBlockId === b.id && styles.chipActive]}
                >
                  <Text style={targetBlockId === b.id ? styles.chipLabelActive : styles.chipLabel}>{b.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        <Card style={styles.block}>
          <View style={styles.toggle}>
            <Text style={type.body}>One vote per flat</Text>
            <Switch value={oneVotePerUnit} onValueChange={setOneVotePerUnit} />
          </View>
          <View style={styles.toggle}>
            <Text style={type.body}>Anonymous</Text>
            <Switch value={isAnonymous} onValueChange={setIsAnonymous} />
          </View>
          <View style={styles.toggle}>
            <Text style={type.body}>Show results live</Text>
            <Switch value={showLiveResults} onValueChange={setShowLiveResults} />
          </View>
        </Card>

        <View style={styles.block}>
          <Button title="Create poll" onPress={submit} disabled={!valid || busy} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, paddingBottom: spacing['4xl'] },
  block: { marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginVertical: spacing.xs, ...type.body },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionInput: { flex: 1 },
  addOption: { ...type.caption, color: colors.actionPrimary, marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.inputBorder },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipLabel: { ...type.caption, color: colors.textSecondary },
  chipLabelActive: { ...type.caption, color: colors.textInverse },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter resident-app exec jest src/screens/PollCreateScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirm `Button` supports `disabled`**

Read `apps/resident-app/src/components/ui/Button.tsx`. If it has no `disabled` prop, add one that both dims the button and short-circuits `onPress`, and add a case to `Button.test.tsx` asserting a disabled press does not fire `onPress`. If it already supports it, change nothing.

- [ ] **Step 6: Run the suite and typecheck**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/resident-app/src/screens/PollCreateScreen.tsx apps/resident-app/src/screens/PollCreateScreen.test.tsx apps/resident-app/src/components/ui/Button.tsx apps/resident-app/src/components/ui/Button.test.tsx
git commit -m "feat(app): poll composer with audience, rules and validation"
```

---

### Task 8: ComposeSheet — the BRD type selector

**Files:**
- Modify: `apps/resident-app/src/screens/ComposeSheet.tsx`
- Test: `apps/resident-app/src/screens/ComposeSheet.test.tsx`

**Interfaces:**
- Consumes: `api.createIssue`, `api.createDiscussion`, `api.createAnnouncement` (Task 2); `PollCreateScreen` (Task 7).
- Produces: `ComposeSheet` props become `{ visible: boolean; isCommittee: boolean; onClose: () => void; onPosted: () => void }` — `isCommittee` is now passed in from the store's fresh `me`, replacing the stale `useAuthStore` token read.

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ComposeSheet from './ComposeSheet';
import * as api from '../api/client';

jest.mock('../api/client');

beforeEach(() => {
  jest.clearAllMocks();
  (api.getBlocks as jest.Mock).mockResolvedValue({ data: { data: [] } });
  (api.createIssue as jest.Mock).mockResolvedValue({ data: { data: { id: 'i1' } } });
  (api.createDiscussion as jest.Mock).mockResolvedValue({ data: { data: { id: 'n1' } } });
  (api.createAnnouncement as jest.Mock).mockResolvedValue({ data: { data: { id: 'n2' } } });
});

describe('ComposeSheet type selector', () => {
  it('offers a plain resident everything except Announce', () => {
    const { getByText, queryByText } = render(
      <ComposeSheet visible isCommittee={false} onClose={() => {}} onPosted={() => {}} />
    );
    expect(getByText('Report issue')).toBeTruthy();
    expect(getByText('Start discussion')).toBeTruthy();
    expect(queryByText('Announce')).toBeNull();
  });

  it('offers a committee member Announce as well', () => {
    const { getByText } = render(
      <ComposeSheet visible isCommittee onClose={() => {}} onPosted={() => {}} />
    );
    expect(getByText('Announce')).toBeTruthy();
    expect(getByText('Create poll')).toBeTruthy();
  });

  it('posts a discussion under the discussion category', async () => {
    const onPosted = jest.fn();
    const { getByText, getByPlaceholderText } = render(
      <ComposeSheet visible isCommittee={false} onClose={() => {}} onPosted={onPosted} />
    );
    fireEvent.press(getByText('Start discussion'));
    fireEvent.changeText(getByPlaceholderText('Title'), 'Parking');
    fireEvent.changeText(getByPlaceholderText('Write something…'), 'Thoughts?');
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.createDiscussion).toHaveBeenCalledWith({ title: 'Parking', body: 'Thoughts?' }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
  });

  it('posts an announcement with the chosen priority', async () => {
    const { getByText, getByPlaceholderText } = render(
      <ComposeSheet visible isCommittee onClose={() => {}} onPosted={() => {}} />
    );
    fireEvent.press(getByText('Announce'));
    fireEvent.changeText(getByPlaceholderText('Title'), 'AGM');
    fireEvent.changeText(getByPlaceholderText('Write something…'), 'Sunday 11am');
    fireEvent.press(getByText('Urgent'));
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.createAnnouncement).toHaveBeenCalledWith({
      title: 'AGM', body: 'Sunday 11am', priority: 'urgent',
    }));
  });

  it('reports an issue with its category', async () => {
    const { getByText, getByPlaceholderText } = render(
      <ComposeSheet visible isCommittee={false} onClose={() => {}} onPosted={() => {}} />
    );
    fireEvent.press(getByText('Report issue'));
    fireEvent.changeText(getByPlaceholderText('Title'), 'Lift broken');
    fireEvent.changeText(getByPlaceholderText('Write something…'), 'Stuck on 7');
    fireEvent.press(getByText('security'));
    fireEvent.press(getByText('Post'));
    await waitFor(() => expect(api.createIssue).toHaveBeenCalledWith({
      title: 'Lift broken', body: 'Stuck on 7', category: 'security',
    }));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/screens/ComposeSheet.test.tsx`
Expected: FAIL — no `Report issue` / `Announce` selector exists yet.

- [ ] **Step 3: Rework ComposeSheet**

Read the current file first — keep its `Modal`, `Input`/`Button` usage and styling. Then change these things:

1. Replace the props with `{ visible, isCommittee, onClose, onPosted }` and **delete the `useAuthStore` import** — committee status now arrives as a prop from the store's fresh `me`, so a resident appointed after login sees the right options without re-logging in.
2. Replace the internal `Tab` union and `TABS` array with:

```tsx
type Kind = 'issue' | 'poll' | 'discussion' | 'announcement';

const KINDS: { key: Kind; label: string; committeeOnly: boolean }[] = [
  { key: 'issue', label: 'Report issue', committeeOnly: false },
  { key: 'poll', label: 'Create poll', committeeOnly: true },
  { key: 'discussion', label: 'Start discussion', committeeOnly: false },
  { key: 'announcement', label: 'Announce', committeeOnly: true },
];

const ISSUE_CATS = ['maintenance', 'security', 'amenities', 'general'] as const;
const PRIORITIES = [
  { key: 'normal', label: 'Normal' },
  { key: 'urgent', label: 'Urgent' },
] as const;
```

   and render `KINDS.filter((k) => isCommittee || !k.committeeOnly)` as the selector row.

3. When `kind === 'poll'`, render `<PollCreateScreen onCancel={() => setKind('issue')} onCreated={() => { reset(); onPosted(); }} />` in place of the form — poll creation is committee-only on the server, so this option only appears for committee members.
4. Keep the title input's placeholder `Title` and the body input's placeholder `Write something…`.
5. Branch `submit()`:

```tsx
    if (kind === 'issue') {
      await api.createIssue({ title: title.trim(), body: body.trim(), category });
    } else if (kind === 'discussion') {
      await api.createDiscussion({ title: title.trim(), body: body.trim() });
    } else if (kind === 'announcement') {
      await api.createAnnouncement({ title: title.trim(), body: body.trim(), priority });
    }
```

   with `const [priority, setPriority] = useState<'normal' | 'urgent'>('normal')`, rendering the `PRIORITIES` chips only when `kind === 'announcement'` and the `ISSUE_CATS` chips only when `kind === 'issue'`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter resident-app exec jest src/screens/ComposeSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the suite and typecheck**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: PASS. `CommunityScreen.test.tsx` still passes because Task 4 already passes `isCommittee` down.

- [ ] **Step 6: Commit**

```bash
git add apps/resident-app/src/screens/ComposeSheet.tsx apps/resident-app/src/screens/ComposeSheet.test.tsx
git commit -m "feat(app): compose sheet type selector with committee-only announce"
```

---

### Task 9: Photo attachments with client-side compression

**Files:**
- Modify: `apps/resident-app/package.json` (two Expo deps)
- Create: `apps/resident-app/src/lib/photos.ts`
- Test: `apps/resident-app/src/lib/photos.test.ts`
- Modify: `apps/resident-app/src/screens/ComposeSheet.tsx` (attach photos when reporting an issue)

**Interfaces:**
- Consumes: `api.uploadIssuePhotos` (Task 2).
- Produces: `pickIssuePhotos(existingCount: number): Promise<string[]>` and `compressForUpload(uri: string): Promise<string>` from `src/lib/photos.ts`; exported `MAX_ISSUE_PHOTOS = 5` and `TARGET_WIDTH = 1200`.

- [ ] **Step 1: Install the native deps the Expo way**

```bash
cd apps/resident-app && npx expo install expo-image-picker expo-image-manipulator
```

**Do not hand-edit `package.json` version ranges.** `expo install` picks the versions matching SDK 52. These are native modules: a version mismatch builds fine on EAS and then crashes on launch, which is exactly how v0.1.0 shipped broken.

- [ ] **Step 2: Verify the native dep graph before writing any code**

```bash
cd apps/resident-app && npx expo-doctor
```

Expected: no findings about `expo-image-picker` or `expo-image-manipulator`. If it reports a missing peer or a version mismatch, run `npx expo install --fix` and re-run until clean. **A green EAS build does not mean the APK runs** — `expo-doctor` is the check that catches this class of failure.

- [ ] **Step 3: Write the failing test**

```ts
import { pickIssuePhotos, compressForUpload, MAX_ISSUE_PHOTOS, TARGET_WIDTH } from './photos';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

jest.mock('expo-image-picker');
jest.mock('expo-image-manipulator');

beforeEach(() => {
  jest.clearAllMocks();
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///raw1.jpg' }, { uri: 'file:///raw2.jpg' }],
  });
  (ImageManipulator.manipulateAsync as jest.Mock).mockImplementation((uri: string) =>
    Promise.resolve({ uri: `${uri}.small` })
  );
});

describe('compressForUpload', () => {
  it('resizes to the 1200px target before upload', async () => {
    const out = await compressForUpload('file:///raw1.jpg');
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      'file:///raw1.jpg',
      [{ resize: { width: TARGET_WIDTH } }],
      expect.objectContaining({ compress: expect.any(Number) })
    );
    expect(out).toBe('file:///raw1.jpg.small');
  });

  it('falls back to the original when compression fails, rather than losing the photo', async () => {
    (ImageManipulator.manipulateAsync as jest.Mock).mockRejectedValue(new Error('nope'));
    await expect(compressForUpload('file:///raw1.jpg')).resolves.toBe('file:///raw1.jpg');
  });
});

describe('pickIssuePhotos', () => {
  it('compresses everything it picks', async () => {
    const uris = await pickIssuePhotos(0);
    expect(uris).toEqual(['file:///raw1.jpg.small', 'file:///raw2.jpg.small']);
  });

  it('never picks past the five-photo cap', async () => {
    await pickIssuePhotos(3);
    const opts = (ImagePicker.launchImageLibraryAsync as jest.Mock).mock.calls[0][0];
    expect(opts.selectionLimit).toBe(2);
  });

  it('returns nothing when the cap is already reached, without opening the picker', async () => {
    const uris = await pickIssuePhotos(MAX_ISSUE_PHOTOS);
    expect(uris).toEqual([]);
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns nothing when permission is refused', async () => {
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    const uris = await pickIssuePhotos(0);
    expect(uris).toEqual([]);
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns nothing when the user cancels', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: [] });
    const uris = await pickIssuePhotos(0);
    expect(uris).toEqual([]);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/lib/photos.test.ts`
Expected: FAIL — cannot resolve `./photos`.

- [ ] **Step 5: Implement**

```ts
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

// The server caps an issue at five photos and 10MB each
// (MAX_ISSUE_PHOTOS in services/api-gateway/src/routes/issues.js). Compressing
// to 1200px keeps a phone photo well under that and keeps uploads usable on a
// weak connection.
export const MAX_ISSUE_PHOTOS = 5;
export const TARGET_WIDTH = 1200;

export async function compressForUpload(uri: string): Promise<string> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: TARGET_WIDTH } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch {
    // Uploading the original is better than silently dropping the evidence the
    // resident took the trouble to attach.
    return uri;
  }
}

export async function pickIssuePhotos(existingCount: number): Promise<string[]> {
  const remaining = MAX_ISSUE_PHOTOS - existingCount;
  if (remaining <= 0) return [];

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    quality: 1,
  });
  if (result.canceled) return [];

  return Promise.all(result.assets.map((asset) => compressForUpload(asset.uri)));
}
```

- [ ] **Step 6: Run the test**

Run: `pnpm --filter resident-app exec jest src/lib/photos.test.ts`
Expected: PASS.

- [ ] **Step 7: Attach photos when reporting an issue**

In `ComposeSheet.tsx`, when `kind === 'issue'`, add an "Add photos" pressable calling `pickIssuePhotos(photos.length)` into a local `photos: string[]` state, render the count (`{photos.length}/5 photos`), and after `api.createIssue` resolves:

```tsx
      const created = await api.createIssue({ title: title.trim(), body: body.trim(), category });
      if (photos.length) {
        try {
          await api.uploadIssuePhotos(created.data.data.id, photos);
        } catch {
          // The issue is already filed — a failed photo upload must not lose it.
        }
      }
```

Add a test to `ComposeSheet.test.tsx` asserting that when `pickIssuePhotos` yields two URIs, `api.uploadIssuePhotos` is called with the new issue's id and both URIs, and that a rejected `uploadIssuePhotos` still fires `onPosted`.

- [ ] **Step 8: Run the suite and typecheck**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/resident-app/package.json apps/resident-app/src/lib/photos.ts apps/resident-app/src/lib/photos.test.ts apps/resident-app/src/screens/ComposeSheet.tsx apps/resident-app/src/screens/ComposeSheet.test.tsx pnpm-lock.yaml
git commit -m "feat(app): issue photo attachments compressed to 1200px before upload"
```

---

### Task 10: Open the issue thread from a resolve notification

The backend sends a resolve push carrying `{ type: 'issue_resolved', issueId, reference }` (see `notifyIssueResolved` in `services/api-gateway/src/routes/issues.js`), but the app has no handler for it, so tapping the notification does nothing. This wires it to the same local-state mechanism the approval overlay already uses.

**Files:**
- Modify: `apps/resident-app/src/lib/notifications.ts`
- Modify: `apps/resident-app/app/index.tsx`
- Test: `apps/resident-app/src/lib/notifications.test.ts`

**Interfaces:**
- Consumes: `CommunityScreen`'s `initialIssueId` prop (Task 4).
- Produces: `setupNotificationListeners` gains a second optional callback parameter `onIssueResolved?: (issueId: string) => void`.

- [ ] **Step 1: Write the failing test**

```ts
import { routeNotificationData } from './notifications';

describe('routeNotificationData', () => {
  it('routes a resolved-issue push to the issue handler', () => {
    const onApproval = jest.fn();
    const onIssue = jest.fn();
    routeNotificationData({ type: 'issue_resolved', issueId: 'i1', reference: 'IQ-2026-007' }, onApproval, onIssue);
    expect(onIssue).toHaveBeenCalledWith('i1');
    expect(onApproval).not.toHaveBeenCalled();
  });

  it('leaves the existing approval route untouched', () => {
    const onApproval = jest.fn();
    const onIssue = jest.fn();
    routeNotificationData({ approvalId: 'ap1', foo: 'bar' }, onApproval, onIssue);
    expect(onApproval).toHaveBeenCalledWith('ap1', { approvalId: 'ap1', foo: 'bar' });
    expect(onIssue).not.toHaveBeenCalled();
  });

  it('ignores a push it does not recognise', () => {
    const onApproval = jest.fn();
    const onIssue = jest.fn();
    routeNotificationData({ type: 'something_else' }, onApproval, onIssue);
    expect(onApproval).not.toHaveBeenCalled();
    expect(onIssue).not.toHaveBeenCalled();
  });

  it('ignores a resolved-issue push with no issueId', () => {
    const onIssue = jest.fn();
    routeNotificationData({ type: 'issue_resolved' }, jest.fn(), onIssue);
    expect(onIssue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/lib/notifications.test.ts`
Expected: FAIL — `routeNotificationData` is not exported.

- [ ] **Step 3: Implement the router and use it**

Read `src/lib/notifications.ts` first. Add:

```ts
/**
 * Decide what a tapped push should open. Split out as a pure function so the
 * routing is testable without standing up expo-notifications.
 */
export function routeNotificationData(
  data: Record<string, unknown> | undefined,
  onApproval: (approvalId: string, data: Record<string, unknown>) => void,
  onIssueResolved?: (issueId: string) => void
): void {
  if (!data) return;
  if (data.type === 'issue_resolved') {
    if (typeof data.issueId === 'string' && data.issueId) onIssueResolved?.(data.issueId);
    return;
  }
  if (typeof data.approvalId === 'string' && data.approvalId) {
    onApproval(data.approvalId, data);
  }
}
```

Then widen `setupNotificationListeners(onApproval, onIssueResolved?)` so its existing response listener delegates to `routeNotificationData(response.notification.request.content.data, onApproval, onIssueResolved)` instead of reading `approvalId` inline.

- [ ] **Step 4: Wire it into the app shell**

In `apps/resident-app/app/index.tsx`, add `const [pendingIssueId, setPendingIssueId] = useState<string | null>(null);`, pass a second callback to `setupNotificationListeners` that does `setTab('community'); setPendingIssueId(issueId);`, and render `<CommunityScreen initialIssueId={pendingIssueId ?? undefined} />`. Clear it when the tab changes so re-entering the tab later does not reopen the thread:

```tsx
  const selectTab = (key: TabKey) => { setPendingIssueId(null); setTab(key); };
```

and pass `selectTab` to `<TabBar onSelect={...} />` in place of `setTab`.

- [ ] **Step 5: Run the suite and typecheck**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/resident-app/src/lib/notifications.ts apps/resident-app/src/lib/notifications.test.ts apps/resident-app/app/index.tsx
git commit -m "feat(app): open the issue thread from a resolve notification"
```

---

### Task 11: Poll cards show live results and respect hidden results

`PollCard` predates the poll rules. The server now returns `null` for `votes` and `totalVotes` while a poll hides its results, and the card currently renders those as `0`, which reads as "nobody voted" rather than "results are hidden".

**Files:**
- Modify: `apps/resident-app/src/components/PollCard.tsx`
- Modify: `apps/resident-app/src/components/PollCard.test.tsx`

**Interfaces:**
- Consumes: `Poll`, `PollOption` from `communityStore` (Task 3), where `votes` and `totalVotes` are now `number | null`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `PollCard.test.tsx`:

```tsx
  it('says results are hidden rather than showing zero when the poll hides them', () => {
    const poll: any = {
      id: 'p1', question: 'Gym hours?', status: 'open', closesAt: null, targetBlockId: null,
      canManage: false, authorName: 'RWA', createdAt: '2026-08-01T09:00:00Z',
      totalVotes: null, myOptionId: 'o1', showLiveResults: false,
      options: [{ id: 'o1', label: '6am', votes: null }, { id: 'o2', label: '7am', votes: null }],
    };
    const { getByText, queryByText } = render(<PollCard poll={poll} onVote={() => {}} />);
    expect(getByText(/Results hidden until the poll closes/)).toBeTruthy();
    expect(queryByText('0%')).toBeNull();
  });

  it('shows percentages once results are visible', () => {
    const poll: any = {
      id: 'p2', question: 'Gym hours?', status: 'open', closesAt: null, targetBlockId: null,
      canManage: false, authorName: 'RWA', createdAt: '2026-08-01T09:00:00Z',
      totalVotes: 4, myOptionId: 'o1', showLiveResults: true,
      options: [{ id: 'o1', label: '6am', votes: 3 }, { id: 'o2', label: '7am', votes: 1 }],
    };
    const { getByText } = render(<PollCard poll={poll} onVote={() => {}} />);
    expect(getByText('75%')).toBeTruthy();
    expect(getByText('25%')).toBeTruthy();
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter resident-app exec jest src/components/PollCard.test.tsx`
Expected: FAIL — no "Results hidden" copy exists.

- [ ] **Step 3: Implement**

In `PollCard.tsx`, compute `const resultsHidden = poll.totalVotes === null;` and:
- when `resultsHidden` and the caller has voted, render `<Text style={type.micro}>Results hidden until the poll closes</Text>` instead of the result bars;
- when results are visible, compute each percentage as `Math.round(((option.votes ?? 0) / (poll.totalVotes || 1)) * 100)` and render `{pct}%`;
- keep the existing vote-option rendering unchanged for a caller who has not voted.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter resident-app exec jest src/components/PollCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run everything**

Run: `pnpm --filter resident-app typecheck && pnpm --filter resident-app test && pnpm --filter api-gateway test`
Expected: PASS across both packages.

- [ ] **Step 6: Commit**

```bash
git add apps/resident-app/src/components/PollCard.tsx apps/resident-app/src/components/PollCard.test.tsx
git commit -m "feat(app): poll cards honour hidden results and render live percentages"
```

---

## Deferred

- **Trending topics (P2)** — needs a nightly job and text analysis; out of scope per the spec.
- **True 5-second push for status changes (F-03)** — the spec documents the approved deviation: optimistic local updates plus refresh on focus. Adding a socket lifecycle to the app is disproportionate for one requirement and remains unapproved.
- **Discussion threads open the notice board**, not a dedicated screen — `DiscussionCard` routes into the existing `NoticeBoardScreen`, which already renders a notice thread with replies. A dedicated discussion detail screen is only worth building if the notice board is retired.

## Open questions carried from the backend plan

Neither blocks this plan; both were raised when the backend shipped and are recorded here so the app is not built on a guess.

1. **Who may create a poll?** The server restricts creation to committee/admin. This plan matches that — `Create poll` is `committeeOnly: true` — so no resident sees a button that would 403. If the product decision is that any resident may create polls, the server changes first and then `KINDS` in Task 8 flips one flag.
2. **`closesAt` is optional server-side.** A poll created without one never auto-closes, so with `showLiveResults: false` its results stay hidden until someone closes it manually. Task 7 therefore does not require a closing date. If the decision is to make it mandatory, add it to `canSubmitPoll` and to the server's schema together.
