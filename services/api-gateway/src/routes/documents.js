import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const UPLOAD_BASE = process.env.UPLOAD_DIR || '/opt/communitygate/uploads';

const VALID_CATEGORIES = ['ownership', 'maintenance', 'id_proof', 'other'];

const documentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const dir = path.join(UPLOAD_BASE, 'documents', month);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage: documentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only images or PDF allowed'));
    }
  },
});

function shapeDoc(d) {
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    fileUrl: d.file_path,
    mime: d.mime,
    sizeBytes: d.size_bytes,
    createdAt: d.created_at,
  };
}

// -- GET /documents (resident) — list this unit's active documents ------------

router.get('/documents', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { community_id, unit_id } = req.user;
    const rows = await queryRows(
      `SELECT id, title, category, file_path, mime, size_bytes, created_at
         FROM unit_documents
        WHERE community_id = $1 AND unit_id = $2 AND is_active = true
        ORDER BY created_at DESC`,
      [community_id, unit_id]
    );
    return success(res, rows.map(shapeDoc));
  } catch (err) {
    console.error('GET /documents error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /documents (resident) — upload a document --------------------------

router.post('/documents', authenticateJWT(['resident']), (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return error(res, err.message, 400);
    next();
  });
}, async (req, res) => {
  try {
    const { community_id, unit_id, sub } = req.user;

    // Validate title and category BEFORE checking for file presence
    const title = (req.body.title || '').trim();
    if (!title || title.length > 120) {
      return error(res, 'title is required (1–120 chars)', 400);
    }

    const category = req.body.category || 'other';
    if (!VALID_CATEGORIES.includes(category)) {
      return error(res, `category must be one of: ${VALID_CATEGORIES.join(', ')}`, 400);
    }

    // File is required
    if (!req.file) {
      return error(res, 'No file uploaded', 400);
    }

    // Derive the month from the folder multer actually wrote to, avoiding
    // month-boundary drift if the month rolls over between storage and handler.
    const month = path.basename(req.file.destination);
    const servedPath = `/uploads/documents/${month}/${req.file.filename}`;

    const doc = await queryOne(
      `INSERT INTO unit_documents (community_id, unit_id, uploaded_by, title, category, file_path, mime, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [community_id, unit_id, sub, title, category, servedPath, req.file.mimetype, req.file.size]
    );

    return success(res, shapeDoc(doc), 201);
  } catch (err) {
    console.error('POST /documents error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- DELETE /documents/:id (resident) — soft-delete --------------------------

router.delete('/documents/:id', authenticateJWT(['resident']), async (req, res) => {
  try {
    const { unit_id } = req.user;

    const doc = await queryOne(
      'SELECT id FROM unit_documents WHERE id = $1 AND unit_id = $2 AND is_active = true',
      [req.params.id, unit_id]
    );
    if (!doc) {
      return error(res, 'Document not found', 404);
    }

    await queryOne(
      'UPDATE unit_documents SET is_active = false WHERE id = $1 RETURNING id',
      [doc.id]
    );

    return success(res, { deleted: true });
  } catch (err) {
    console.error('DELETE /documents/:id error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
