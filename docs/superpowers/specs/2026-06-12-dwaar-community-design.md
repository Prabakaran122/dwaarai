# Dwaar AI Resident App — Community Tab

**Date:** 2026-06-12
**Branch:** `redesign/dwaar-light`
**Status:** Approved (autonomous, "complete all resident features" goal)
**Sub-project:** 3 of 6 (Community)

## Background
Per `docs/design-sources/share-community.txt`: a structured community feed that is *not* a
WhatsApp clone. Differentiators: **Issues** with a "Same issue + upvote" signal and an
Open→In Progress→Resolved status (RWA-controlled); **Polls**; **Announcements** (committee,
priority); **Discussions**. The existing **notices** feature (mig 014: `category`
official|discussion, replies, `is_pinned`, admin-only official + push fan-out) already
covers announcements + discussion threads — reuse it. Issues and Polls are net-new.

## Decisions
- D1 — Reuse `/notices` for announcements (official, admin-only, pinned, push) and
  discussions (resident). No change to notices.
- D2 — **Issues**: residents create; "Same issue" = one upvote per resident (toggle); status
  is admin-only (residents see it). Categories: maintenance | security | amenities | general.
- D3 — **Polls**: residents create + vote (one vote/resident/poll, no change-vote in v1);
  community-wide audience (block targeting deferred). Options 2..6. Optional `closes_at`.
- D4 — A `GET /community/feed` aggregate returns pinned announcements + recent issues
  (with upvote_count, my_upvoted, status) + open polls (with options, counts, my_vote).
- D5 — Compose sheet offers Issue / Poll / Discussion to residents; Announce is admin-only
  (notices already enforces this; the app simply doesn't surface Announce to residents).

## Slices
- **3a — backend:** mig `027_community.sql` (issues, issue_upvotes, polls, poll_options,
  poll_votes); `routes/issues.js` (GET list w/ counts+my_upvoted+status, POST create,
  POST :id/upvote toggle, PUT :id/status admin-only); `routes/polls.js` (GET list w/
  options+counts+my_vote, POST create+options, POST :id/vote); `routes/community-feed.js`
  (`GET /community/feed`); client methods; vitest tests.
- **3b — frontend:** `communityStore` (feed), components `AnnouncementCard`, `IssueCard`
  (upvote button + status badge), `PollCard` (options w/ vote + result bars); `CommunityScreen`
  (feed + compose modal: Issue/Poll/Discussion); wire `community` tab; route from Home/My Unit
  deep-links already point here.

## Scoping / honesty
All routes resident-JWT, scoped to `req.user.community_id`. Issue status changes require
admin role (residents get 403). One upvote/vote per resident enforced by UNIQUE indexes +
handler checks. No fabricated counts. Block-level poll targeting, change-vote, issue
comment threads, and trending-topics analytics are deferred (v2). i18n deferred.

## Conventions
Light Dwaar tokens; reuse Foundation `ui/`; vitest (backend) / jest-expo (frontend) TDD;
tolerate the 2 known pre-existing resident-app tsc errors.
