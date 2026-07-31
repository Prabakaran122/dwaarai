/**
 * The edge → cloud gate-event contract (POST /events/sync).
 *
 * Kept in its own module, free of express/db/mqtt imports, so the contract test
 * can validate payloads without booting the service.
 *
 * This schema and edge/offline_queue.py are pinned to each other by the golden
 * payload in tests/fixtures/edge-event-sync.json — see
 * tests/unit/test_event_sync_contract.py (edge half) and
 * src/__tests__/event-sync-contract.test.js (cloud half). When the edge learns
 * to emit something new, widen this schema, the mirrored one in
 * gate-command-service/src/routes.js, AND the gate_events column.
 */
import { z } from 'zod';

export const eventSyncItemSchema = z.object({
  community_id: z.string().uuid(),
  gate_id: z.string().uuid(),
  // 20 chars fits biometric verify methods ('fingerprint', 'finger_vein');
  // matches gate_events.detection_method after migration 031.
  detection_method: z.string().min(1).max(20),
  raw_value: z.string().max(100).optional(),
  matched_vehicle_id: z.string().uuid().optional().nullable(),
  matched_pass_id: z.string().uuid().optional().nullable(),
  matched_unit_id: z.string().uuid().optional().nullable(),
  matched_unit_number: z.string().max(30).optional().nullable(),
  resident_name: z.string().max(200).optional().nullable(),
  // 'guard_review' is first-class everywhere else (the cloud itself writes it in
  // vehicles.js, and all three apps style it); 'alarm'/'alert' are the edge's
  // panel-health events. Omitting them here silently dropped real events.
  access_decision: z.enum([
    'allow', 'deny', 'override', 'guard_review', 'alarm', 'alert',
  ]),
  // Which way through the gate. The column has existed since migration 008 but
  // the edge never set it, so every historical row reads 'entry'.
  direction: z.enum(['entry', 'exit']).optional(),
  deny_reason: z.string().max(100).optional().nullable(),
  anpr_confidence: z.number().min(0).max(1).optional().nullable(),
  snapshot_s3_key: z.string().optional().nullable(),
  processing_ms: z.number().int().optional().nullable(),
  // zod's .datetime() accepts ONLY UTC ISO-8601 ending in `Z`. The edge
  // normalises its float-epoch timestamps in offline_queue.to_iso8601().
  event_ts: z.string().datetime(),
  // Whether this event was buffered on the edge and synced late. Optional and
  // defaulted at the handler, not here, so payloads from existing edge builds —
  // which never send it — keep their historical meaning of "synced offline".
  is_offline_event: z.boolean().optional(),
});

export const eventSyncSchema = z.object({
  events: z.array(eventSyncItemSchema).min(1).max(500),
});
