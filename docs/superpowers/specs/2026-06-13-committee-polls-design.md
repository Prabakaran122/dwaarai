# Dwaar AI — Committee Polls upgrade

**Date:** 2026-06-13
**Branch:** `redesign/dwaar-light`
**Status:** Approved (user chose: polls = committee-only; + closing, one-vote-per-unit, audience targeting)

## Problem
Currently any resident can create polls (`POST /polls` allows `['resident','admin']`), voting is one-per-**resident**, polls never close, and there's no audience targeting. The resident app has **no committee concept** — residents are role `resident` (only `is_primary`/`type`); admins use the Admin Portal. The brief wants polls run by the committee.

## Decisions
- **D1 — Committee = a flagged resident.** Add `residents.is_committee`. A committee member logs into the resident app normally and carries `is_committee` in their JWT; they see poll-creation + management. Set by an admin (DB/endpoint); no in-app self-promotion.
- **D2 — Poll creation = committee or admin only.** `POST /polls` and management endpoints require `is_committee || isAdmin`. Ordinary residents only vote. The compose sheet's **Poll** tab is hidden for non-committee residents.
- **D3 — One vote per UNIT** (not per resident). `poll_votes` uniqueness becomes `(poll_id, unit_id)`; `resident_id` kept for audit ("who cast the unit's vote").
- **D4 — Closing/expiry.** A poll may have a `closes_at` (optional, set at creation). It is effectively **closed** when `status='closed'` OR `closes_at < now`. Committee can close early via `POST /polls/:id/close`. Closed polls reject votes (409) and show results.
- **D5 — Audience targeting.** A poll may target one **block** (`polls.target_block_id`, null = whole community). `GET /polls`/feed only show a poll to residents whose unit's block matches the target (or untargeted). Committee picks the audience from the community's blocks at creation.

## Backend (api-gateway)
- **Migration `029_committee_polls.sql`:**
  - `ALTER TABLE residents ADD COLUMN is_committee BOOLEAN NOT NULL DEFAULT FALSE;`
  - `ALTER TABLE polls ADD COLUMN target_block_id UUID REFERENCES blocks(id);`
  - `poll_votes`: add `unit_id UUID`; drop the per-resident PK; `CREATE UNIQUE INDEX uniq_poll_unit ON poll_votes(poll_id, unit_id);` (keep `resident_id` column for audit).
- **Auth (`routes/auth.js`):** include `is_committee` in the resident JWT (resident-verify + register paths) and return it in the login response payload (`isCommittee`). Selected from `residents.is_committee`.
- **`routes/polls.js`:**
  - `POST /polls` → require `req.user.is_committee || isAdmin`. Accept optional `closesAt` (ISO) + `targetBlockId` (uuid in this community, else 400). Insert with these.
  - `POST /polls/:id/vote` → resolve caller `unit_id`; insert `(poll_id, option_id, resident_id, unit_id)`; unit-unique violation → 409 "This unit has already voted"; reject if poll effectively closed (status closed OR closes_at past) → 409.
  - `POST /polls/:id/close` → committee/admin only; set `status='closed'`; 404 if not in community; returns `{ id, status }`.
  - `GET /polls` + `assemblePolls`: filter audience — only polls where `target_block_id IS NULL OR target_block_id = (caller's unit block)`; compute effective `status` (closed if past `closes_at`); add `targetBlockId`, `closesAt`, `canManage` (caller is committee/admin). `myOptionId` reflects the unit's vote.
- **`routes/blocks.js` (new):** `GET /blocks` (resident JWT) → `[{ id, name }]` for the caller's community (for the audience picker). Verify the `blocks` table columns first.

## Frontend (resident app)
- **authStore:** add `isCommittee: boolean` to `AuthUser`; map it from the login response.
- **client.ts:** `closePoll(id)`, `getBlocks()`; extend `createPoll` to accept `{ closesAt?, targetBlockId? }`.
- **communityStore Poll type:** add `closesAt`, `targetBlockId`, `canManage`.
- **ComposeSheet:** show the **Poll** tab only when `user.isCommittee` (residents see Issue/Discussion only). Poll form (committee) gains: optional close date (date+time text, IST), and an audience selector (All / a block from `getBlocks()`).
- **PollCard:** show a "closes <date>" / "closed" indicator; if `canManage` and open, a **Close poll** action (→ `closePoll`); show "Targeted: <block>" when targeted; one-vote-per-unit messaging ("Your unit voted").
- **CommunityScreen:** wire close handler (refetch after).

## Testing
- Backend (vitest): POST /polls 403 for a plain resident, 201 for committee; vote records unit + 409 on a second unit vote + 409 on closed poll; close endpoint 403 for resident / 200 for committee; GET filters by block audience; effective-closed by `closes_at`. blocks list.
- Frontend (jest): ComposeSheet hides Poll tab for non-committee, shows for committee; PollCard shows Close for canManage + closed state; createPoll passes closesAt/targetBlockId.

## Out of scope / notes
- No in-app committee management UI (admin sets `is_committee`; I'll flag a seed resident for testing). Per-unit voting means a household gets one vote (intended). Audience is single-block (not multi-select) in v1.
