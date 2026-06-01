import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

const LANGUAGES = ['en', 'hi', 'kn'];

const languageSchema = z.object({
  language: z.enum(['en', 'hi', 'kn']),
});

// -- PUT /guard/language (guard JWT) -----------------------------------------
// Persist the guard's preferred UI language (guards are residents rows).

router.put('/guard/language', authenticateJWT(['guard']), async (req, res) => {
  try {
    const parsed = languageSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, `language must be one of: ${LANGUAGES.join(', ')}`, 400);
    }
    await query(
      'UPDATE residents SET preferred_language = $1 WHERE id = $2',
      [parsed.data.language, req.user.sub]
    );
    return success(res, { language: parsed.data.language });
  } catch (err) {
    console.error('PUT /guard/language error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
