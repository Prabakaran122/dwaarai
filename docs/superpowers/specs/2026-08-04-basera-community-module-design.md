# Basera — Community module, v1.0

**Date:** 2026-08-04 · **Status:** approved design, not yet implemented
**Source:** `Dwaar_AI_Community_BRD_v1.0.docx` (Mukesh Kumar Jena, Aug 2026)
**Surface:** Basera (resident app) + one supporting screen in the Admin Portal

## Goal

Ship the Community tab of Basera: a structured feed where issues are trackable,
RWA authority is visible, and polls produce data. The BRD's framing is that
accountability and transparency are the point — the immutable status timeline is
a compliance feature, not decoration.

## Scope

**In:** every P0 and P1 requirement of the Community BRD — feed with type
tagging and filters, issue reporting with upvotes, immutable status timeline,
role-gated RWA action bar, official replies, photo attachments, poll creation
with audience and voting rules, announcement composer, resolve notifications.

**Out:** trending topics (P2 — needs a nightly job and text analysis for the
lowest-priority widget); everything the BRD lists as out of scope (WhatsApp
integration, photo galleries, the Events tab, direct messaging, admin analytics).

### Documented deviation — needs product-owner approval

**F-03** requires an issue's status strip to reflect an RWA change "within 5s".
The resident app has no socket connection today and `socket.io-client` is not a
dependency. We are implementing **optimistic-local updates plus refresh on
focus**: your own vote/upvote applies instantly, and another user's status change
appears on pull-to-refresh or when the screen regains focus — typically seconds
after any interaction, but not pushed to an idle screen.

Rationale: only F-03 needs true push. F-04 allows the upvote count a full minute,
and "poll results update in real time after resident votes" refers to your own
vote. Adding a socket lifecycle to a mobile app — background, reconnect, auth
refresh, battery — is disproportionate for a feed people glance at. The BRD
states deviations must be approved before implementation; this one is open.

## Data model

Five additive changes. No destructive migrations.

| Change | Why |
|---|---|
| `residents.committee_role` — `president\|secretary\|treasurer\|member`, NULL = not committee | The mockups label people "Rajan Kumar · Secretary". Today there is only an `is_committee` boolean and no way to set it, so the entire committee half is unusable. |
| **`issue_status_events`** (new, insert-only) | The audit trail F-09 requires. |
| **`issue_photos`** (new) | Up to 5 ordered photos per issue. A child table, not an array column, so the cap and ordering are enforceable. |
| `issues` + `reference`, `assignee_name`, `resolved_at` | `reference` is the `IQ-YYYY-NNN` id shown in the thread's top bar, allocated per community per year. |
| `polls` + `topic`, `one_vote_per_unit` (default true), `is_anonymous` (default false), `show_live_results` (default true), `audience` (`all\|owners\|block`) | The BRD's poll rules. `target_block_id` already exists for the block case. |

### `issue_status_events`

```
id, issue_id, community_id,
from_status, to_status,
changed_by_resident_id, changed_by_name, changed_by_role,
kind,          -- 'status_change' | 'system'
detail,        -- e.g. 'Community upvote threshold crossed'
created_at
```

`kind` exists because the mockup's timeline contains an entry no user performed:
"24 residents affected — Community upvote threshold crossed". System entries
carry a NULL actor.

The table is **insert-only**: no route, service function, or admin path issues an
UPDATE or DELETE against it. Entries survive the parent issue being hidden or
reported. The author's name and role are **denormalised onto the row** rather
than joined at read time, so the timeline still reads correctly if the person
later leaves the committee or the flat — an audit record must show who they were
at the time, not who they are now.

## API

Extends the existing `issues.js`, `polls.js` and `notices.js` — no new service.

- `GET /community/feed?type=` — unified feed. Most recent announcement pinned
  first regardless of age, then reverse-chronological. `type` filters to one post
  type; the app also filters client-side where it already holds the data (F-05).
- `POST /issues` — owners and committee only. Tenants are rejected server-side.
- `GET /issues/:id` — post, photos, impact count, timeline, replies, in one call.
- `POST /issues/:id/upvote` — toggles the caller's "Same issue" mark.
- `PATCH /issues/:id/status` — committee only. Forward-only
  `open → in_progress → resolved`; any backwards or skipping transition is a 422.
  Writes the `issue_status_events` row **in the same transaction** as the status
  change, so a timeline can never be missing an entry.
- `POST /issues/:id/replies` — committee replies are flagged `is_official`.
- `POST /issues/:id/photos` — multer to `/uploads/issues/YYYY-MM/`, matching the
  incidents pattern (`035_incident_media`). Max 5 per issue, 10MB each,
  JPEG/PNG/HEIC. The client compresses to 1200px before upload.
- `POST /polls` — validates ≥2 options, ≤6, and a future `closes_at`.
- `POST /polls/:id/vote` — enforces `one_vote_per_unit` **server-side** against
  `poll_votes.unit_id`, not merely by disabling the UI.
- `POST /notices` — announcements, committee only, with priority.

Resolve notifications (F-12) go through the existing notification-service to the
reporter and every upvoter, deep-linking to the thread.

## Permissions

From the BRD's role table. Enforced **server-side**; hiding a control in the app
is presentation, not authorisation.

| | Post issue | Post discussion | Post poll | Vote / reply / upvote | Announce | Change status |
|---|---|---|---|---|---|---|
| Owner | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Tenant | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Committee | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Guard | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (read-only feed) |

A resident must never see the RWA action bar (F-10), and must never succeed in
calling `PATCH /issues/:id/status` if they construct the request by hand.

## Mobile (Basera)

Rebuild `CommunityScreen` (currently 93 lines) to the feed mockup: Deep Ocean top
bar, compose strip, filter tabs with an amber active underline, pinned
announcement card, issue cards with inline status strip and "Same issue" counter,
poll cards with live percentage bars.

New screens: `IssueDetailScreen` (photo strip, impact counter, vertical status
timeline, RWA action bar, threaded replies with green "Official response"
bubbles) and `PollCreateScreen` (topic, question, 2–6 draggable options, audience
chips, closing date, three rule toggles).

Extend the existing `ComposeSheet` with the BRD's type selector: Report issue,
Create poll, Start discussion, Announce (committee only).

Uses the existing theme tokens — `brandPrimary #1B3A4B`, `actionPrimary #F59E0B`
already match the BRD's Deep Ocean and Amber, and `colors.test.ts` pins them.

## Admin Portal — committee appointment

The portal has no residents screen (`community-admins` manages portal accounts,
not residents). Add one lightweight **Residents** page: list with search, and a
committee-role selector per resident. Backed by an admin-scoped list endpoint and
`PATCH /residents/:id/committee-role`.

This is outside the Basera BRD but is a hard dependency: without it nobody can be
a committee member, and every committee-gated requirement is untestable.

## Testing

Server (vitest): forward-only status transitions including rejected backwards and
skipping attempts; timeline immutability; each row of the permissions matrix,
asserted against the API rather than the UI; one-vote-per-unit under a second
vote from the same flat; the 5-photo cap; announcement pinning in feed order.

App (jest, following the existing `*.test.tsx` pattern): the RWA action bar is
absent for owner and tenant roles; official replies render distinctly; poll
create validation gates the submit button; optimistic upvote toggles and reverts
on server error.

## Risks

- **The deviation above is unapproved.** If Mukesh requires literal 5s push,
  `socket.io-client` enters the resident app and the estimate grows.
- **Issue reference allocation** (`IQ-YYYY-NNN`) needs a per-community counter
  that is safe under concurrent inserts; a naive `MAX(n)+1` will collide.
- **Photo storage is local disk**, consistent with incidents, and therefore tied
  to the single EC2 box. Fine now; it is the thing to revisit before multi-node.
