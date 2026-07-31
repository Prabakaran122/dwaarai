/**
 * Edge → cloud event-sync contract (cloud half).
 *
 * `tests/fixtures/edge-event-sync.json` is a golden capture of what
 * edge/offline_queue.py really POSTs to /events/sync, pinned on the Python side
 * by tests/unit/test_event_sync_contract.py. Here we feed that exact payload to
 * the REAL zod schema the route uses.
 *
 * Together the two tests close the gap that let the contract silently break:
 * the edge sent float-epoch `event_ts` and `guard_review`/`alarm` decisions the
 * schema rejected, so every batch 400'd and no offline event ever synced. The
 * offline-queue unit tests never caught it because they mock the HTTP layer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../../../../tests/fixtures/edge-event-sync.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

// The schema module the route actually uses — no express/db/mqtt needed.
const { eventSyncSchema, eventSyncItemSchema } = await import('../schemas/event-sync.js');

describe('POST /events/sync contract', () => {
  it('accepts the payload the edge actually produces', () => {
    const parsed = eventSyncSchema.safeParse(fixture);
    if (!parsed.success) {
      throw new Error(
        'Edge sync payload rejected by the cloud schema:\n' +
          JSON.stringify(parsed.error.issues, null, 2)
      );
    }
    expect(parsed.data.events).toHaveLength(fixture.events.length);
  });

  it('covers every decision and detection method the edge emits', () => {
    // Guards against a fixture that only exercises the easy 'allow'/'anpr' path.
    const decisions = new Set(fixture.events.map((e) => e.access_decision));
    const methods = new Set(fixture.events.map((e) => e.detection_method));
    expect(decisions).toContain('guard_review'); // was rejected by the old enum
    expect(decisions).toContain('alarm');
    expect(methods).toContain('fingerprint'); // 11 chars — was over the old max(10)
  });

  it('requires ISO-8601 UTC for event_ts, not a float epoch', () => {
    const base = fixture.events[0];
    expect(eventSyncItemSchema.safeParse({ ...base, event_ts: 1785312000.5 }).success).toBe(false);
    expect(eventSyncItemSchema.safeParse({ ...base, event_ts: '2026-07-29T08:00:00.500Z' }).success).toBe(true);
  });

  it('drops edge-only bookkeeping fields instead of failing on them', () => {
    // The edge attaches gate_opened/user_id/etc. for its own logs; the schema
    // must tolerate them (zod strips unknown keys). is_offline_event is no
    // longer edge-only bookkeeping — it's now a recognized, optional field on
    // the contract (see the `is_offline_event` describe block below), so it
    // passes through with its real value instead of being stripped.
    const parsed = eventSyncItemSchema.parse(fixture.events[0]);
    expect(parsed).not.toHaveProperty('gate_opened');
    expect(parsed.is_offline_event).toBe(false);
    expect(parsed.detection_method).toBe('anpr');
  });

  it('still rejects genuinely malformed events', () => {
    const base = fixture.events[0];
    expect(eventSyncItemSchema.safeParse({ ...base, community_id: 'not-a-uuid' }).success).toBe(false);
    expect(eventSyncItemSchema.safeParse({ ...base, access_decision: 'maybe' }).success).toBe(false);
    expect(eventSyncItemSchema.safeParse({ ...base, detection_method: 'x'.repeat(21) }).success).toBe(false);
    expect(eventSyncItemSchema.safeParse({ ...base, anpr_confidence: 1.5 }).success).toBe(false);
  });
});

describe('is_offline_event', () => {
  const base = {
    community_id: '00000000-0000-0000-0000-000000000043',
    gate_id: '00000000-0000-0000-0000-000000043001',
    detection_method: 'rfid',
    access_decision: 'allow',
    event_ts: '2026-07-31T10:00:00.000Z',
  };

  it('accepts an explicit false', () => {
    const parsed = eventSyncItemSchema.safeParse({ ...base, is_offline_event: false });
    expect(parsed.success).toBe(true);
    expect(parsed.data.is_offline_event).toBe(false);
  });

  it('accepts an explicit true', () => {
    const parsed = eventSyncItemSchema.safeParse({ ...base, is_offline_event: true });
    expect(parsed.success).toBe(true);
  });

  it('stays optional so existing edge payloads still validate', () => {
    const parsed = eventSyncItemSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.data.is_offline_event).toBeUndefined();
  });

  it('rejects a non-boolean', () => {
    const parsed = eventSyncItemSchema.safeParse({ ...base, is_offline_event: 'yes' });
    expect(parsed.success).toBe(false);
  });
});
