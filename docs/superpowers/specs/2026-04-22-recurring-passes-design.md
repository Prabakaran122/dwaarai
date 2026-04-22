# Recurring Visitor Passes — Design Spec

**Date:** 2026-04-22
**Feature:** Recurring passes for daily visitors (maids, cooks, tutors) with guard check-in and photo capture
**Status:** Approved

---

## Overview

Residents create recurring passes for regular visitors (maid, cook, tutor, newspaper, driver). The system generates daily "expected visit" records based on the schedule. Guards see an "Expected Now" panel showing visitors due in the current time window. When a visitor arrives, the guard taps "Arrived", snaps a photo, and the visit is logged. Visitors with the same name across multiple flats are grouped — one tap marks all units as arrived.

No gate open command is involved — recurring visitors are pedestrians walking through the gate. This is a digital attendance register with photo proof.

## Data Model

### New Table: `recurring_passes`

```sql
CREATE TABLE recurring_passes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL REFERENCES communities(id),
  unit_id         UUID NOT NULL REFERENCES units(id),
  created_by      UUID NOT NULL REFERENCES residents(id),
  visitor_name    VARCHAR(200) NOT NULL,
  visitor_name_normalized VARCHAR(200) NOT NULL,
  visitor_role    VARCHAR(50),
  schedule_type   VARCHAR(20) NOT NULL,
  schedule_days   SMALLINT[],
  time_from       TIME NOT NULL,
  time_until      TIME NOT NULL,
  status          VARCHAR(20) DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recurring_active ON recurring_passes(community_id)
  WHERE status = 'active';
```

**schedule_type values:** daily, weekday, weekly, custom

**schedule_days:** Array of day numbers (Sun=0, Mon=1 ... Sat=6). NULL for daily. `[1,2,3,4,5]` for weekday. `[6]` for weekly Saturday. `[2,4,6]` for custom Tue/Thu/Sat.

**visitor_name_normalized:** Lowercase, trimmed version of visitor_name. Used for grouping same visitor across multiple flats.

**visitor_role values:** maid, cook, driver, tutor, newspaper, other

**status values:** active, paused, cancelled

### New Table: `expected_visits`

```sql
CREATE TABLE expected_visits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_pass_id UUID NOT NULL REFERENCES recurring_passes(id),
  community_id    UUID NOT NULL REFERENCES communities(id),
  unit_id         UUID NOT NULL,
  visit_date      DATE NOT NULL,
  time_from       TIME NOT NULL,
  time_until      TIME NOT NULL,
  visitor_name_normalized VARCHAR(200) NOT NULL,
  visitor_role    VARCHAR(50),
  status          VARCHAR(20) DEFAULT 'expected',
  arrived_at      TIMESTAMPTZ,
  marked_by       UUID,
  photo_url       VARCHAR(500),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_expected_today ON expected_visits(community_id, visit_date, status);
CREATE INDEX idx_expected_name ON expected_visits(community_id, visit_date, visitor_name_normalized)
  WHERE status = 'expected';
```

**status values:** expected, arrived, missed

No changes to existing tables.

## API Endpoints

### POST `/api/v1/recurring-passes` (Resident JWT)

Create a recurring pass for a regular visitor.

**Request:**
```json
{
  "visitor_name": "Lakshmi",
  "visitor_role": "maid",
  "schedule_type": "weekday",
  "schedule_days": [1,2,3,4,5],
  "time_from": "06:00",
  "time_until": "09:00"
}
```

**Server-side:**
1. Validate input (Zod schema)
2. Compute visitor_name_normalized (lowercase, trim)
3. Insert into recurring_passes with community_id and unit_id from JWT
4. If today matches the schedule, also generate today's expected_visit immediately
5. Return the created pass

**Response:**
```json
{
  "id": "uuid",
  "visitor_name": "Lakshmi",
  "visitor_role": "maid",
  "schedule_type": "weekday",
  "schedule_days": [1,2,3,4,5],
  "time_from": "06:00",
  "time_until": "09:00",
  "status": "active"
}
```

### GET `/api/v1/recurring-passes` (Resident JWT)

List the resident's recurring passes for their unit. Includes today's arrival status for each.

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "visitor_name": "Lakshmi",
      "visitor_role": "maid",
      "schedule_type": "weekday",
      "schedule_days": [1,2,3,4,5],
      "time_from": "06:00",
      "time_until": "09:00",
      "status": "active",
      "today_status": "arrived",
      "today_arrived_at": "2026-04-22T06:45:00Z",
      "today_photo_url": "/uploads/visits/2026-04/uuid.jpg"
    }
  ]
}
```

### PUT `/api/v1/recurring-passes/:id` (Resident JWT)

Edit schedule, pause, or resume a recurring pass.

**Request (partial update):**
```json
{
  "schedule_type": "custom",
  "schedule_days": [2,4,6],
  "status": "paused"
}
```

### DELETE `/api/v1/recurring-passes/:id` (Resident JWT)

Cancel a recurring pass. Sets status to 'cancelled'. Keeps historical arrived records. Deletes future expected visits.

### GET `/api/v1/expected-visits` (Guard JWT)

Get today's expected visitors whose time window includes the current time. Grouped by visitor_name_normalized so the guard sees one entry per person.

**Query parameters:**
- `date` (optional, defaults to today)

**Server-side:**
1. Get all expected_visits for today + this community
2. Filter to entries where current time is between time_from and time_until (for expected status), or show all arrived entries
3. Group by visitor_name_normalized
4. For each group, collect all unit numbers
5. Return grouped list

**Response:**
```json
{
  "data": {
    "expected": [
      {
        "id": "uuid",
        "visitor_name": "Lakshmi",
        "visitor_role": "maid",
        "units": ["402", "301", "502"],
        "visit_ids": ["uuid1", "uuid2", "uuid3"],
        "time_from": "06:00",
        "time_until": "09:00"
      }
    ],
    "arrived": [
      {
        "visitor_name": "Newspaper Boy",
        "visitor_role": "newspaper",
        "units": ["502"],
        "arrived_at": "2026-04-22T06:15:00Z",
        "photo_url": "/uploads/visits/2026-04/uuid.jpg"
      }
    ]
  }
}
```

### POST `/api/v1/expected-visits/:id/arrived` (Guard JWT)

Mark a visitor as arrived. Auto-marks all expected visits for the same normalized name in the same community today.

**Request:** Multipart form-data with optional photo file.

**Server-side:**
1. Find the target expected_visit
2. Get its visitor_name_normalized
3. Find ALL expected_visits with same visitor_name_normalized + community_id + visit_date + status='expected'
4. Save photo to `/opt/communitygate/uploads/visits/{YYYY-MM}/{visit_id}.jpg`
5. Update all matching visits: status='arrived', arrived_at=NOW(), marked_by=guard_id, photo_url
6. Return count of units marked

**Response:**
```json
{
  "marked": 3,
  "units": ["402", "301", "502"],
  "photo_url": "/uploads/visits/2026-04/uuid.jpg"
}
```

### POST `/api/v1/uploads/visit-photo` (Guard JWT)

Upload a photo for a visit. Returns the URL. Used if the guard wants to add/retry a photo after marking arrived.

**Request:** Multipart form-data with photo file.
**Max size:** 2MB
**Format:** JPEG (guard app compresses before upload)

**Response:**
```json
{
  "url": "/uploads/visits/2026-04/uuid.jpg"
}
```

### POST `/api/v1/expected-visits/generate` (Internal)

Generate today's expected visits from active recurring passes. Called by cron and on server startup.

**Server-side:**
1. Get all recurring_passes where status='active' and community_id matches
2. For each, check if today matches schedule_type + schedule_days
3. Skip if expected_visit already exists for this pass + today
4. Insert expected_visit row
5. Update yesterday's 'expected' entries to 'missed'

## Guard App Changes

### Expected Visitors Panel

New component shown in the guard workstation, alongside the existing action zone.

**Content:**
- Header: "EXPECTED NOW (count)"
- List of expected visitors (grouped by name), showing: name, role, unit(s), time window, "Arrived" button
- Below: "Arrived Today" section showing already-arrived visitors with timestamp

**"Arrived" button flow:**
1. Guard taps "Arrived"
2. `expo-image-picker` opens (camera mode)
3. Guard snaps photo
4. Photo compressed to 800x600 JPEG, quality 0.7
5. Uploads via `POST /expected-visits/:id/arrived` with photo
6. Entry moves to "Arrived Today" section
7. All matching units marked simultaneously

**Auto-refresh:** Poll `GET /expected-visits` every 60 seconds.

### No gate open command

Tapping "Arrived" only logs the visit. No MQTT, no gate command. These are pedestrians.

## Resident App Changes

### Recurring Visitors Section

Added to the existing Visitors tab, above the OTP passes section.

**Content:**
- "Recurring Visitors" header with count
- List of active recurring passes showing: name, role, schedule, today's status (arrived/expected/no visit today)
- If arrived today: timestamp + "View Photo" link
- Each entry has Edit and Pause buttons
- "Add Recurring Visitor" button at bottom

### Add Recurring Visitor Form

Modal form with fields:
- **Name** (text input, required)
- **Role** (dropdown: Maid, Cook, Driver, Tutor, Newspaper, Other)
- **Schedule** (dropdown: Daily, Weekday, Weekly, Custom)
- **Days** (day picker, shown for Weekly/Custom: S M T W T F S toggles)
- **Time window** (from time picker, to time picker)
- Save button

### Activity Feed

When guard marks visitor as arrived, the resident sees in their activity feed:
- "Lakshmi (Maid) arrived at Main Gate"
- Timestamp
- "View Photo" button showing the guard-captured photo

## Photo Upload & Storage

- **Guard app:** Captures via expo-image-picker, compresses to 800x600 JPEG quality 0.7 (~100-200KB)
- **Upload:** Multipart form-data to API endpoint
- **Server storage:** `/opt/communitygate/uploads/visits/{YYYY-MM}/{visit_id}.jpg`
- **Serving:** nginx `location /uploads/ { root /opt/communitygate; }`
- **Max file size:** 2MB
- **Cleanup:** Cron deletes photos older than 90 days
- **Migration to S3:** Change upload path + serve via CloudFront when needed

## Daily Generation (Cron)

Runs inside the API gateway process using `node-cron`.

**Two triggers:**
1. On API server start — generate for today if not already done
2. Daily at 00:05 — `cron.schedule('5 0 * * *', generateExpectedVisits)`

**Generation logic:**
1. Get all `recurring_passes` where status='active'
2. For each, check if today matches: daily (always), weekday (Mon-Fri), weekly/custom (check schedule_days array)
3. Skip if expected_visit already exists for this recurring_pass_id + today
4. Insert expected_visit
5. Update yesterday's 'expected' entries to 'missed'

## Same Visitor Across Multiple Flats

When the same visitor (e.g., maid "Lakshmi") works in multiple flats, each resident creates their own recurring pass. The system handles grouping:

**Guard sees:** One entry with multiple units: "Lakshmi (Maid) · Flats: 402, 301, 502"
**Guard taps "Arrived" once:** All three expected_visits marked as arrived with the same photo
**Matching logic:** Same `visitor_name_normalized` + same `visitor_role` + same `community_id` + same `visit_date` + status='expected'
**Each resident sees:** Their own arrival record with photo in their activity feed

## Edge Cases

| Scenario | Handling |
|----------|---------|
| Resident creates pass, visitor comes same day | On pass creation, generate today's expected_visit if schedule matches today |
| Guard marks arrived outside time window | Allowed — time window is a guideline. Log actual arrival time |
| Resident pauses pass | Status='paused'. Cron skips paused passes. Today's expected visit stays |
| Resident cancels pass | Status='cancelled'. Delete future expected visits. Keep historical records |
| Two visitors same name, different roles | Grouped separately — matching includes visitor_role |
| Same name, genuinely different people | Resident adds last name to distinguish. Normalization preserves this |
| Photo upload fails | Visit marked arrived without photo. Guard can retry via separate upload endpoint |
| Server restarts mid-day | On startup, check and generate today's visits if needed |
| Multiple gates | Expected list is community-wide. All gates see same expected visitors |

## What's NOT Changing

- Existing visitor passes / OTP flow — untouched
- Remote approval flow — untouched
- Gate commands / MQTT / edge node — untouched (this feature has no gate commands)
- Admin portal — no changes needed for v1

## Future: AI Suggestions (Phase 2)

Once communities have 30+ days of real gate event data, the system can:
1. Analyze visit patterns from gate_events table
2. Identify recurring visitors (same plate/name, similar times, 5+ visits)
3. Push suggestion to resident: "You get Swiggy deliveries most evenings. Create a recurring pass?"
4. Resident taps "Yes" → auto-creates the recurring pass

This is Phase 2 — requires real data. The recurring passes table and expected visits infrastructure built in Phase 1 is the foundation.
