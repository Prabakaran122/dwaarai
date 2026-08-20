# Community BRD closeout + Events resident UI — design

**Date:** 2026-08-21
**Sources:** `Dwaar_AI_Community_BRD_v1.0`, `Dwaar_AI_BRD_Events_Module_v1.0` (Mukesh Jena, Aug 2026)
**Baseline:** master, api-gateway 557 tests green

A 2026-08-20 conformance audit found the Community BRD at 17 of 25 requirements
with 4 partial and 4 not started, and the Events BRD backend- and admin-complete
but with **no resident-facing UI at all** — the half its own scope statement is
about. This design closes both gaps.

Two sub-projects. Part A first: it is lower risk, and its cron and env-gated
delivery patterns are reused by Part B.

---

## Part A — Community closeout

### A1. Poll closing date (F-14)

The BRD makes the closing date required. The shipped Basera APK creates polls
without one, and `community.test.js` locks that optionality in, so the server
keeps `closesAt` optional and `PollCreateScreen` enforces it client-side with a
default of today + 7 days.

The server does gain a validation it lacks today: when `closesAt` is present it
must be in the future. Creating a poll that is already closed is not a
back-compat case worth protecting.

### A2. Poll auto-close and summary push (F-19)

Read paths already treat a past `closes_at` as closed, so voting is correctly
refused today. What is missing is the authoritative state flip and the
notification.

New `src/cron/close-polls.js`, following `src/cron/generate-visits.js`: find
polls where `closes_at < NOW()` and `status <> 'closed'`, flip them, and push a
result summary to eligible voters. The lazy read-path check stays as the
fallback that makes the cron non-critical — if it stops, voting still closes on
time; only the notification is lost.

### A3. Announcement priority tiers (F-21)

`NOTICE_PRIORITIES` becomes `['normal', 'important', 'urgent']`. `'general'` is
accepted as an input alias normalising to `'normal'`, so a client speaking the
BRD's vocabulary and the installed APK's `normal|urgent` both work.

**Approved deviation from the BRD.** The BRD specifies General = feed only, no
push. The product owner elected to keep push on General, because silently
dropping notifications for the most common announcement type is a bigger
regression than notification fatigue.

That decision leaves General and Important with identical delivery, which would
make the middle tier meaningless. They are therefore separated by push
treatment rather than by push-or-not:

| Tier | Feed | Push | SMS |
|---|---|---|---|
| General (`normal`) | yes | normal priority, no sound | no |
| Important | yes | high priority, sound | no |
| Urgent | yes | high priority, sound | yes, env-gated |

`lib/fcm.js#sendToMultiple` currently hardcodes `sound: 'default'` and
`priority: 'high'`. It gains an options argument; existing callers keep today's
behaviour by default.

SMS uses the existing `lib/msg91.js#sendTransactionalSMS` behind
`ANNOUNCEMENT_SMS_ENABLED`, **default off**. An SMS failure must never fail the
publish — the announcement is the product, the SMS is a courtesy. This mirrors
the guest-booking receipt, which already logs and continues.

### A4. Pinned announcement cap (F-22)

Publishing a pinned announcement unpins all but the newest 3, in the same
transaction as the insert. Doing it in a follow-up statement would leave a
window where four are pinned.

### A5. Trending topics (F-06)

`GET /community/trending` returns the 5 most frequent title terms across the
last 7 days. Chips are tappable and filter the feed.

The BRD leaves the algorithm open and asks whether stopwords are excluded. They
are: a trending list of "the, is, for, and, to" is noise. A small English
stopword list lives beside the query, with terms under 3 characters dropped.

The BRD says topics recalculate nightly. This computes on request instead —
the dataset is one community's titles over 7 days, the query is cheap, and a
nightly job would make the chips stale for a full day after a real incident,
which is exactly when they matter.

### A6. Announcement live preview (F-23)

The announcement tab of `ComposeSheet` renders a preview using the same
component residents see in the feed, so the preview cannot drift from reality.
Re-rendering on each keystroke is well inside the BRD's 500ms budget.

### A7. Scheduled announcements (F-24)

`notices.scheduled_at TIMESTAMPTZ NULL`. A notice with a future `scheduled_at`
is withheld from resident queries and shown to committee members with a
"Scheduled" badge. A publish cron releases them.

Publishing is what fires the push, so a scheduled announcement must not
notify at creation time — the delivery logic moves behind a single
`publishNotice()` path shared by immediate and scheduled publication.

### A8. Per-post replies toggle (F-25)

`notices.replies_enabled BOOLEAN NOT NULL DEFAULT TRUE`. Default preserves
today's behaviour. When false the composer is hidden and the reply endpoint
rejects with 403 — UI-only enforcement is not enforcement.

Migration `042_notice_scheduling.sql` carries A7 and A8.

---

## Part B — Events resident UI

The backend is complete and tested: stall booking with a database-enforced
single winner, a 15-minute reservation TTL, fee-free donations, guest links,
and webhook settlement. Part B is client work plus one small endpoint.

### B1. Payment mechanism

`react-native-razorpay` is added as a dependency. `DuesScreen` already contains
the intended pattern — an optional `require` returning null so the app still
runs in Expo Go — and the new code reuses it rather than inventing a second
one. Adding the module revives the dues payment path as a side effect; it has
never been able to charge.

This is a native module, so it ships only in a new EAS build. Not OTA-able.

### B2. Payment confirmation endpoint

The client must not treat the checkout SDK's callback as proof of payment; only
the webhook is authoritative. Dues solves this with `GET /dues/payments/:id`;
stalls and donations have no equivalent.

New `GET /payment-orders/:id`, scoped to the caller's community, returning
status and enough context to render a confirmation. The app polls it after
checkout returns.

### B3. Screens

- **EventsScreen** (rebuilt) — filter chips All / Upcoming / Stall Booking /
  Donations / Past mapping to the `filter` param the backend already supports,
  featured hero card, event cards with tags, donation card. The existing RSVP
  screen is replaced; RSVP is explicitly out of scope in this BRD, but the
  endpoints stay for the installed APK.
- **StallBookingScreen** — availability stats, colour-coded grid map from
  `row_index`/`col_index`, type filter chips fading non-matching stalls to 30%,
  booking summary with the 3% platform fee as its own line, pay CTA.
- **DonateSheet** — goal progress bar, ₹51 / ₹101 / ₹251 / ₹501 quick amounts,
  custom input, pay CTA. No platform fee line, because there is no fee.
- **BookingConfirmationScreen** — stall code, event, date, amount paid.

State in a new `eventsStore`, matching the store-per-domain convention. Screens
are swapped in by local state and props, per the app's existing no-navigation-
stack pattern.

### B4. Losing a booking race

The partial unique index guarantees one winner; the loser gets a 409. The app
renders that as "That stall was just taken" and refreshes the map, rather than
a generic failure. This is the BRD's stated acceptance criterion — one booking,
one clear error.

### B5. New-event indicator (FR-EVT-05)

A dot on the Events tab when an event has been published since the user last
opened it. Last-seen timestamp in AsyncStorage, compared against the newest
event's `created_at` already returned by the list — no server state and no
polling.

The BRD also wants the dot when a stall frees up. That is deferred: a released
stall changes no event-level timestamp, so detecting it means either polling
stall inventory from the tab bar or new server state, and neither is worth it
for a P1 indicator. Noted here so the gap is deliberate rather than silent.

---

## Testing

TDD throughout, in the existing suites — vitest for api-gateway, jest for
resident-app. Every requirement gets a test whose name carries its BRD ID
(`F-22`, `FR-STL-04`), so conformance becomes greppable; the audit that
prompted this work could not do that, because only 4 IDs appeared anywhere in
the tree.

Payment paths test against the existing test-mode order fallback, so CI needs
no gateway credentials. The SMS path is tested with msg91 mocked, including the
failure case that must not fail the publish.

## Delivery

Part A is OTA-safe. Part B requires a new EAS APK. Work lands on a feature
branch; the APK is not published to `/apps/` until reviewed, per the standing
rule that the live download never serves unreviewed code.

## Out of scope

RSVP removal from the backend, guest-booking web page (FR-GST-02, tracked
separately), Razorpay live keys, and the BRD open questions the documents
themselves leave unresolved — SMS opt-out policy, tenant poll creation,
route-vs-payout settlement, refund SOP.
