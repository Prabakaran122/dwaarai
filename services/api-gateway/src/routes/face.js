import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT, authenticateDevice } from '../middleware/auth.js';
import { vectorize, isRecognitionConfigured, matchFace } from '../lib/faceRecognition.js';

const router = Router();

const LOCATIONS = ['gate', 'pool', 'clubhouse', 'gym'];

// Build a full consent map (all locations present, defaulting to disabled).
function consentMap(rows) {
  const map = {};
  for (const loc of LOCATIONS) map[loc] = false;
  for (const r of rows) if (LOCATIONS.includes(r.location)) map[r.location] = r.enabled;
  return map;
}

// -- GET /face (resident) — enrollment status + consent map ------------------

router.get('/face', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    const enrollment = await queryOne(
      'SELECT status, enrolled_at, activated_at FROM face_enrollments WHERE resident_id = $1',
      [user.sub]
    );
    const consents = await queryRows(
      'SELECT location, enabled FROM biometric_consents WHERE resident_id = $1',
      [user.sub]
    );
    return success(res, {
      status: enrollment && enrollment.status !== 'deleted' ? enrollment.status : 'not_enrolled',
      enrolled_at: enrollment?.enrolled_at || null,
      activated_at: enrollment?.activated_at || null,
      recognition_ready: isRecognitionConfigured(),
      consents: consentMap(consents),
      locations: LOCATIONS,
    });
  } catch (err) {
    console.error('GET /face error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /face/enroll (resident) --------------------------------------------
// Accepts a scan transiently, vectorizes via the recognition service, stores
// ONLY the vector. The image is never persisted. Optionally sets initial consent.

const enrollSchema = z.object({
  scan_b64: z.string().optional(),
  consent_locations: z.array(z.enum(['gate', 'pool', 'clubhouse', 'gym'])).optional(),
  consent_acknowledged: z.boolean(),
});

router.post('/face/enroll', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    if (!parsed.data.consent_acknowledged) {
      return error(res, 'Consent is required before enrollment', 400);
    }
    const user = req.user;

    // Vectorize the scan if a recognition service is configured. The raw scan
    // is used only here and never stored.
    let vector = null;
    let status = 'pending';
    if (parsed.data.scan_b64) {
      try {
        vector = await vectorize(parsed.data.scan_b64);
        if (vector) status = 'active';
      } catch (e) {
        console.error('[Face] vectorize failed:', e.message);
        return error(res, 'Could not process the face scan. Please try again.', 502);
      }
    }

    const enrollment = await queryOne(
      `INSERT INTO face_enrollments (community_id, unit_id, resident_id, status, vector, enrolled_at, activated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       ON CONFLICT (resident_id) DO UPDATE
         SET status = EXCLUDED.status,
             vector = EXCLUDED.vector,
             enrolled_at = NOW(),
             activated_at = EXCLUDED.activated_at,
             deleted_at = NULL
       RETURNING status, enrolled_at, activated_at`,
      [user.community_id, user.unit_id, user.sub, status, vector, status === 'active' ? new Date() : null]
    );

    // Set any initial per-location consents.
    if (parsed.data.consent_locations?.length) {
      for (const loc of parsed.data.consent_locations) {
        await query(
          `INSERT INTO biometric_consents (resident_id, location, enabled, updated_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (resident_id, location) DO UPDATE SET enabled = true, updated_at = NOW()`,
          [user.sub, loc]
        );
      }
    }

    return success(res, {
      status: enrollment.status,
      pending_reason: enrollment.status === 'pending' ? 'awaiting_recognition_service' : null,
    }, 201);
  } catch (err) {
    console.error('POST /face/enroll error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- PUT /face/consent (resident) — toggle a location ------------------------

const consentSchema = z.object({
  location: z.enum(['gate', 'pool', 'clubhouse', 'gym']),
  enabled: z.boolean(),
});

router.put('/face/consent', authenticateJWT(['resident']), async (req, res) => {
  try {
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const user = req.user;
    const { location, enabled } = parsed.data;
    await query(
      `INSERT INTO biometric_consents (resident_id, location, enabled, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (resident_id, location) DO UPDATE SET enabled = $3, updated_at = NOW()`,
      [user.sub, location, enabled]
    );
    const consents = await queryRows(
      'SELECT location, enabled FROM biometric_consents WHERE resident_id = $1',
      [user.sub]
    );
    return success(res, { consents: consentMap(consents) });
  } catch (err) {
    console.error('PUT /face/consent error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /face (resident) — permanent deletion, real-time -----------------
// Removes the vector, marks the enrollment deleted, and disables all consents.
// Access immediately falls back to OTP for this resident.

router.delete('/face', authenticateJWT(['resident']), async (req, res) => {
  try {
    const user = req.user;
    await query(
      `UPDATE face_enrollments
          SET status = 'deleted', vector = NULL, deleted_at = NOW(), activated_at = NULL
        WHERE resident_id = $1`,
      [user.sub]
    );
    await query(
      'UPDATE biometric_consents SET enabled = false, updated_at = NOW() WHERE resident_id = $1',
      [user.sub]
    );
    return success(res, { deleted: true });
  } catch (err) {
    console.error('DELETE /face error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- GET /face/access-log (resident) — biometric access audit trail ----------

router.get('/face/access-log', authenticateJWT(['resident']), async (req, res) => {
  try {
    const rows = await queryRows(
      `SELECT location, method, decision, terminal_id, event_ts
         FROM biometric_access_events
        WHERE resident_id = $1
        ORDER BY event_ts DESC
        LIMIT 100`,
      [req.user.sub]
    );
    return success(res, rows);
  } catch (err) {
    console.error('GET /face/access-log error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /face/access (device/terminal token) -------------------------------
// A terminal reports a matched resident at a location. The gateway enforces
// per-location consent + active enrollment before granting, and logs the event.

const accessSchema = z.object({
  community_id: z.string().uuid(),
  location: z.enum(['gate', 'pool', 'clubhouse', 'gym']),
  resident_id: z.string().uuid().optional(),
  method: z.enum(['face', 'otp']).default('face'),
  terminal_id: z.string().optional(),
});

router.post('/face/access', authenticateDevice, async (req, res) => {
  try {
    const parsed = accessSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id, location, resident_id, method, terminal_id } = parsed.data;

    let decision = 'fallback'; // default to OTP fallback when face can't grant
    let residentForLog = resident_id || null;

    if (method === 'face' && resident_id) {
      const enrollment = await queryOne(
        "SELECT status FROM face_enrollments WHERE resident_id = $1 AND community_id = $2",
        [resident_id, community_id]
      );
      const consent = await queryOne(
        'SELECT enabled FROM biometric_consents WHERE resident_id = $1 AND location = $2',
        [resident_id, location]
      );
      // Must be actively enrolled AND consented for THIS location.
      if (enrollment?.status === 'active' && consent?.enabled) {
        decision = 'granted';
      } else {
        decision = 'fallback';
      }
    }

    await query(
      `INSERT INTO biometric_access_events (community_id, resident_id, location, method, decision, terminal_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [community_id, residentForLog, location, method, decision, terminal_id || null]
    );

    return success(res, { decision, location, method });
  } catch (err) {
    console.error('POST /face/access error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /face/verify-driver (guard) ----------------------------------------
// At the gate, check the driver's face against the unit's enrolled residents.
// Non-blocking: returns confirmed / flagged / unavailable — the guard decides.

const verifyDriverSchema = z.object({
  unit_number: z.string().optional(),
  plate: z.string().optional(),
  scan_b64: z.string().min(1),
}).refine((d) => d.unit_number || d.plate, { message: 'unit_number or plate is required' });

router.post('/face/verify-driver', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = verifyDriverSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'unit_number or plate, and scan_b64, are required', 400);
    }
    const user = req.user;
    const { unit_number, plate, scan_b64 } = parsed.data;

    // Resolve the unit either directly or via the vehicle's plate.
    let unit = null;
    if (unit_number) {
      unit = await queryOne('SELECT id FROM units WHERE community_id = $1 AND unit_number = $2', [user.community_id, unit_number]);
    } else if (plate) {
      const normalized = plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      unit = await queryOne(
        'SELECT unit_id AS id FROM vehicles WHERE community_id = $1 AND plate = $2 AND is_active = true',
        [user.community_id, normalized]
      );
    }
    if (!unit) {
      return error(res, 'Unit not found for this vehicle', 404);
    }

    if (!isRecognitionConfigured()) {
      return success(res, { status: 'unavailable', reason: 'recognition_service_not_configured' });
    }

    // Candidate vectors = actively enrolled residents of this unit.
    const candidates = await queryRows(
      `SELECT fe.resident_id, r.name, fe.vector
         FROM face_enrollments fe
         JOIN residents r ON r.id = fe.resident_id
        WHERE fe.unit_id = $1 AND fe.status = 'active' AND fe.vector IS NOT NULL`,
      [unit.id]
    );
    if (candidates.length === 0) {
      return success(res, { status: 'unavailable', reason: 'no_enrolled_residents' });
    }

    let result;
    try {
      result = await matchFace(scan_b64, candidates.map((c) => ({ resident_id: c.resident_id, name: c.name, vector: c.vector })));
    } catch (e) {
      console.error('[Face] driver match failed:', e.message);
      return error(res, 'Could not process the face scan. Verify manually.', 502);
    }
    if (!result.available) {
      return success(res, { status: 'unavailable', reason: 'recognition_service_not_configured' });
    }

    const status = result.matched ? 'confirmed' : 'flagged';

    // Log the verification for transparency (resident sees it in their audit trail).
    await query(
      `INSERT INTO biometric_access_events (community_id, resident_id, location, method, decision, terminal_id)
       VALUES ($1, $2, 'gate', 'face', $3, $4)`,
      [user.community_id, result.resident_id || null, result.matched ? 'granted' : 'flagged', user.gate_id || null]
    );

    return success(res, {
      status,
      resident_name: result.matched ? result.name : null,
      confidence: result.confidence,
    });
  } catch (err) {
    console.error('POST /face/verify-driver error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
