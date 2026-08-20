import { Router } from 'express';
import { queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// The BRD leaves the algorithm open and asks whether stopwords are excluded.
// They are: a trending list reading "the, is, for, and, to" is noise, not a
// signal about what the community is talking about.
export const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'has',
  'had', 'her', 'his', 'its', 'our', 'out', 'was', 'were', 'will', 'with',
  'from', 'this', 'that', 'they', 'them', 'there', 'their', 'been', 'have',
  'when', 'what', 'who', 'why', 'how', 'about', 'into', 'over', 'than', 'then',
  'some', 'such', 'only', 'also', 'more', 'most', 'other', 'please', 'would',
  'could', 'should', 'need', 'needs', 'new', 'get', 'got', 'due', 'per',
]);

export const MIN_TERM_LENGTH = 3;
export const TRENDING_LIMIT = 5;
export const WINDOW_DAYS = 7;

/**
 * Most frequent meaningful words across a set of post titles.
 * Pure, so the ranking rules are testable without a database.
 */
export function topTerms(titles, limit = TRENDING_LIMIT) {
  const counts = new Map();
  for (const title of titles) {
    if (!title) continue;
    // Split on anything that is not a letter: this keeps "gate" out of
    // "gate's" and drops digits, which are never interesting as topics.
    for (const word of String(title).toLowerCase().split(/[^a-z]+/)) {
      if (word.length < MIN_TERM_LENGTH || STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    // Ties broken alphabetically so the list is stable between requests
    // rather than reshuffling on every refresh.
    .sort((a, b) => (b.count - a.count) || a.term.localeCompare(b.term))
    .slice(0, limit);
}

// -- GET /community/trending --------------------------------------------------
//
// Computed per request rather than nightly as the BRD suggests. The dataset is
// one community's titles over a week and the query is cheap, while a nightly
// job would leave the chips a full day stale — exactly wrong after a real
// incident, which is when anyone looks at them.
router.get('/community/trending', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const rows = await queryRows(
      `SELECT title FROM notices
        WHERE community_id = $1 AND is_removed = false
          AND created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
          AND (scheduled_at IS NULL OR scheduled_at <= NOW())
       UNION ALL
       SELECT title FROM issues
        WHERE community_id = $1
          AND created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'`,
      [req.user.community_id]
    );
    return success(res, topTerms(rows.map((r) => r.title)));
  } catch (err) {
    console.error('GET /community/trending error:', err.message);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
