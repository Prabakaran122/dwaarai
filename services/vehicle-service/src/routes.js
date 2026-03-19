import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import multer from 'multer';
import { query, queryOne, queryRows } from './db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Response helpers ────────────────────────────────────────────────

function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    error: null,
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

function error(res, message, statusCode = 400, details = null) {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error: { message, details },
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

// ── Plate normalizer ────────────────────────────────────────────────

export function normalizePlate(raw) {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

// ── Zod schemas ─────────────────────────────────────────────────────

const createVehicleSchema = z.object({
  plate: z.string().min(1).max(20),
  make: z.string().max(50).optional(),
  model: z.string().max(50).optional(),
  color: z.string().max(30).optional(),
  type: z.enum(['car', 'bike', 'scooter', 'truck', 'other']).default('car'),
  rfid_uid_hash: z.string().length(64).optional(),
});

const updateVehicleSchema = z.object({
  plate: z.string().min(1).max(20).optional(),
  make: z.string().max(50).optional(),
  model: z.string().max(50).optional(),
  color: z.string().max(30).optional(),
  type: z.enum(['car', 'bike', 'scooter', 'truck', 'other']).optional(),
  rfid_uid_hash: z.string().length(64).nullable().optional(),
});

const accessCheckSchema = z.object({
  community_id: z.string().uuid(),
  gate_id: z.string().uuid(),
  method: z.enum(['anpr', 'rfid', 'otp']),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  snapshot_b64: z.string().optional(),
  ts: z.string().optional(),
});

const blacklistCreateSchema = z.object({
  plate: z.string().max(20).optional(),
  rfid_uid_hash: z.string().length(64).optional(),
  reason: z.string().min(1),
}).refine(d => d.plate || d.rfid_uid_hash, {
  message: 'Either plate or rfid_uid_hash is required',
});

// ── Vehicle CRUD ────────────────────────────────────────────────────

// POST /vehicles
router.post('/vehicles', async (req, res) => {
  try {
    const parsed = createVehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { plate: rawPlate, make, model, color, type, rfid_uid_hash } = parsed.data;
    const plate = normalizePlate(rawPlate);
    const plateDisplay = rawPlate.trim();

    const user = req.user;
    const community_id = user.community_id;
    const unit_id = user.unit_id;
    const resident_id = user.sub;

    // Check uniqueness
    const existing = await queryOne(
      'SELECT id FROM vehicles WHERE community_id = $1 AND plate = $2 AND is_active = true',
      [community_id, plate]
    );
    if (existing) {
      return error(res, 'Vehicle with this plate already exists in this community', 409);
    }

    const vehicle = await queryOne(
      `INSERT INTO vehicles (community_id, unit_id, resident_id, plate, plate_display, make, model, color, type, rfid_uid_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [community_id, unit_id, resident_id, plate, plateDisplay, make || null, model || null, color || null, type, rfid_uid_hash || null]
    );

    return success(res, vehicle, 201);
  } catch (err) {
    console.error('POST /vehicles error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// GET /vehicles
router.get('/vehicles', async (req, res) => {
  try {
    const user = req.user;
    const community_id = user.community_id;
    const cursor = req.query.cursor || null;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    let sql, params;
    if (user.role === 'admin') {
      sql = `SELECT * FROM vehicles WHERE community_id = $1 AND is_active = true`;
      params = [community_id];
    } else {
      sql = `SELECT * FROM vehicles WHERE community_id = $1 AND unit_id = $2 AND is_active = true`;
      params = [community_id, user.unit_id];
    }

    if (cursor) {
      sql += ` AND created_at < $${params.length + 1}`;
      params.push(cursor);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const rows = await queryRows(sql, params);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].created_at.toISOString() : null;

    return success(res, { vehicles: data, nextCursor });
  } catch (err) {
    console.error('GET /vehicles error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// PUT /vehicles/:id
router.put('/vehicles/:id', async (req, res) => {
  try {
    const parsed = updateVehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const fields = parsed.data;
    if (Object.keys(fields).length === 0) {
      return error(res, 'No fields to update', 400);
    }

    const user = req.user;
    const vehicleId = req.params.id;

    // Check ownership / community
    const existing = await queryOne(
      'SELECT * FROM vehicles WHERE id = $1 AND is_active = true',
      [vehicleId]
    );
    if (!existing) {
      return error(res, 'Vehicle not found', 404);
    }
    if (existing.community_id !== user.community_id) {
      return error(res, 'Forbidden', 403);
    }
    if (user.role !== 'admin' && existing.unit_id !== user.unit_id) {
      return error(res, 'Forbidden', 403);
    }

    // Build dynamic UPDATE
    const setClauses = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(fields)) {
      if (key === 'plate') {
        setClauses.push(`plate = $${idx}`, `plate_display = $${idx + 1}`);
        values.push(normalizePlate(val), val.trim());
        idx += 2;
      } else {
        setClauses.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }
    }
    values.push(vehicleId);

    const updated = await queryOne(
      `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return success(res, updated);
  } catch (err) {
    console.error('PUT /vehicles/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// DELETE /vehicles/:id (admin only)
router.delete('/vehicles/:id', async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'admin') {
      return error(res, 'Admin access required', 403);
    }

    const vehicleId = req.params.id;
    const existing = await queryOne(
      'SELECT * FROM vehicles WHERE id = $1 AND community_id = $2 AND is_active = true',
      [vehicleId, user.community_id]
    );
    if (!existing) {
      return error(res, 'Vehicle not found', 404);
    }

    await query(
      'UPDATE vehicles SET is_active = false WHERE id = $1',
      [vehicleId]
    );
    return success(res, { id: vehicleId, is_active: false });
  } catch (err) {
    console.error('DELETE /vehicles/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// POST /vehicles/bulk-import (admin only)
router.post('/vehicles/bulk-import', upload.single('file'), async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'admin') {
      return error(res, 'Admin access required', 403);
    }
    if (!req.file) {
      return error(res, 'CSV file required', 400);
    }

    const csv = req.file.buffer.toString('utf-8');
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      return error(res, 'CSV must have a header row and at least one data row', 400);
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const requiredHeaders = ['plate', 'unit_number'];
    for (const rh of requiredHeaders) {
      if (!headers.includes(rh)) {
        return error(res, `Missing required CSV header: ${rh}`, 400);
      }
    }

    const community_id = user.community_id;
    const imported = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const row = {};
      headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });

      try {
        const plate = normalizePlate(row.plate);
        if (!plate) {
          errors.push({ row: i + 1, error: 'Empty plate' });
          continue;
        }

        // Look up unit
        const unit = await queryOne(
          'SELECT id FROM units WHERE community_id = $1 AND unit_number = $2',
          [community_id, row.unit_number]
        );
        if (!unit) {
          errors.push({ row: i + 1, error: `Unit ${row.unit_number} not found` });
          continue;
        }

        await queryOne(
          `INSERT INTO vehicles (community_id, unit_id, plate, plate_display, make, model, color, type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (community_id, plate) DO NOTHING
           RETURNING id`,
          [community_id, unit.id, plate, row.plate, row.make || null, row.model || null, row.color || null, row.type || 'car']
        );
        imported.push({ row: i + 1, plate });
      } catch (rowErr) {
        errors.push({ row: i + 1, error: rowErr.message });
      }
    }

    return success(res, { imported: imported.length, errors });
  } catch (err) {
    console.error('POST /vehicles/bulk-import error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── Whitelist Sync ──────────────────────────────────────────────────

// GET /whitelist/sync (device token)
router.get('/whitelist/sync', async (req, res) => {
  try {
    const device = req.device;
    const community_id = device.community_id;

    const vehicles = await queryRows(
      `SELECT v.plate, v.rfid_uid_hash, v.unit_id, u.unit_number, r.name AS resident_name
       FROM vehicles v
       JOIN units u ON v.unit_id = u.id
       LEFT JOIN residents r ON v.resident_id = r.id
       WHERE v.community_id = $1 AND v.is_active = true`,
      [community_id]
    );

    const blacklisted = await queryRows(
      `SELECT plate, rfid_uid_hash FROM blacklist
       WHERE community_id = $1 AND is_active = true`,
      [community_id]
    );

    return success(res, { vehicles, blacklist: blacklisted });
  } catch (err) {
    console.error('GET /whitelist/sync error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── Access Check ────────────────────────────────────────────────────

// POST /access/check (device token)
router.post('/access/check', async (req, res) => {
  try {
    const startMs = Date.now();
    const parsed = accessCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { community_id, gate_id, method, value, confidence, snapshot_b64, ts } = parsed.data;
    const eventId = uuidv4();
    const eventTs = ts || new Date().toISOString();

    // Normalize lookup value
    const lookupValue = method === 'anpr' ? normalizePlate(value) : value;

    // Check blacklist first
    let blacklisted = null;
    if (method === 'anpr') {
      blacklisted = await queryOne(
        'SELECT id FROM blacklist WHERE community_id = $1 AND plate = $2 AND is_active = true',
        [community_id, lookupValue]
      );
    } else if (method === 'rfid') {
      blacklisted = await queryOne(
        'SELECT id FROM blacklist WHERE community_id = $1 AND rfid_uid_hash = $2 AND is_active = true',
        [community_id, lookupValue]
      );
    }

    if (blacklisted) {
      const processingMs = Date.now() - startMs;
      await query(
        `INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, access_decision, deny_reason, anpr_confidence, processing_ms, event_ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [eventId, community_id, gate_id, method, lookupValue, 'deny', 'blacklisted', confidence || null, processingMs, eventTs]
      );
      return success(res, {
        decision: 'deny',
        event_id: eventId,
        reason: 'blacklisted',
        message: 'Vehicle or RFID is blacklisted',
      });
    }

    // Look up vehicle by plate or RFID
    let vehicle = null;
    if (method === 'anpr') {
      vehicle = await queryOne(
        `SELECT v.id, v.unit_id, u.unit_number, r.name AS resident_name
         FROM vehicles v
         JOIN units u ON v.unit_id = u.id
         LEFT JOIN residents r ON v.resident_id = r.id
         WHERE v.community_id = $1 AND v.plate = $2 AND v.is_active = true`,
        [community_id, lookupValue]
      );
    } else if (method === 'rfid') {
      vehicle = await queryOne(
        `SELECT v.id, v.unit_id, u.unit_number, r.name AS resident_name
         FROM vehicles v
         JOIN units u ON v.unit_id = u.id
         LEFT JOIN residents r ON v.resident_id = r.id
         WHERE v.community_id = $1 AND v.rfid_uid_hash = $2 AND v.is_active = true`,
        [community_id, lookupValue]
      );
    } else if (method === 'otp') {
      // Check visitor_passes
      const pass = await queryOne(
        `SELECT vp.id, vp.unit_id, u.unit_number, vp.visitor_name AS resident_name
         FROM visitor_passes vp
         JOIN units u ON vp.unit_id = u.id
         WHERE vp.community_id = $1 AND vp.otp = $2 AND vp.status = 'active'
           AND NOW() BETWEEN vp.valid_from AND vp.valid_until
           AND vp.uses_count < vp.max_uses`,
        [community_id, lookupValue]
      );

      if (pass) {
        const processingMs = Date.now() - startMs;
        // Increment uses
        await query(
          'UPDATE visitor_passes SET uses_count = uses_count + 1 WHERE id = $1',
          [pass.id]
        );
        await query(
          `INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, matched_pass_id, matched_unit_id, matched_unit_number, resident_name, access_decision, processing_ms, event_ts)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [eventId, community_id, gate_id, method, lookupValue, pass.id, pass.unit_id, pass.unit_number, pass.resident_name, 'allow', processingMs, eventTs]
        );
        return success(res, {
          decision: 'allow',
          method,
          event_id: eventId,
          unit_id: pass.unit_id,
          unit_number: pass.unit_number,
          resident_name: pass.resident_name,
          vehicle_id: null,
          message: 'Visitor pass verified',
        });
      }
    }

    if (vehicle) {
      const processingMs = Date.now() - startMs;
      await query(
        `INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, matched_vehicle_id, matched_unit_id, matched_unit_number, resident_name, access_decision, anpr_confidence, processing_ms, event_ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [eventId, community_id, gate_id, method, lookupValue, vehicle.id, vehicle.unit_id, vehicle.unit_number, vehicle.resident_name, 'allow', confidence || null, processingMs, eventTs]
      );
      return success(res, {
        decision: 'allow',
        method,
        event_id: eventId,
        unit_id: vehicle.unit_id,
        unit_number: vehicle.unit_number,
        resident_name: vehicle.resident_name,
        vehicle_id: vehicle.id,
        message: 'Vehicle recognized',
      });
    }

    // Not found — guard review
    const processingMs = Date.now() - startMs;
    await query(
      `INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, access_decision, deny_reason, anpr_confidence, processing_ms, event_ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [eventId, community_id, gate_id, method, lookupValue, 'guard_review', 'not_recognized', confidence || null, processingMs, eventTs]
    );
    return success(res, {
      decision: 'guard_review',
      event_id: eventId,
      reason: 'not_recognized',
      message: 'Vehicle not recognized — guard review required',
    });
  } catch (err) {
    console.error('POST /access/check error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── Blacklist ───────────────────────────────────────────────────────

// POST /blacklist (admin only)
router.post('/blacklist', async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'admin') {
      return error(res, 'Admin access required', 403);
    }

    const parsed = blacklistCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }

    const { plate: rawPlate, rfid_uid_hash, reason } = parsed.data;
    const plate = rawPlate ? normalizePlate(rawPlate) : null;

    const entry = await queryOne(
      `INSERT INTO blacklist (community_id, plate, rfid_uid_hash, reason, added_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user.community_id, plate, rfid_uid_hash || null, reason, user.sub]
    );

    return success(res, entry, 201);
  } catch (err) {
    console.error('POST /blacklist error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// DELETE /blacklist/:id (admin only)
router.delete('/blacklist/:id', async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'admin') {
      return error(res, 'Admin access required', 403);
    }

    const blId = req.params.id;
    const existing = await queryOne(
      'SELECT id FROM blacklist WHERE id = $1 AND community_id = $2 AND is_active = true',
      [blId, user.community_id]
    );
    if (!existing) {
      return error(res, 'Blacklist entry not found', 404);
    }

    await query(
      'UPDATE blacklist SET is_active = false WHERE id = $1',
      [blId]
    );
    return success(res, { id: blId, is_active: false });
  } catch (err) {
    console.error('DELETE /blacklist/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
