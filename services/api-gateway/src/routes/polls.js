import { Router } from 'express';
import { z } from 'zod';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// ── Auth helpers ──────────────────────────────────────────────────────────────

function isAdmin(user) {
  return user.role === 'admin' || user.role === 'community_admin' || user.role === 'super_admin';
}

/** Committee members OR admins may create/close polls. */
function canManagePolls(user) {
  return user.is_committee === true || isAdmin(user);
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createPollSchema = z.object({
  question: z.string().min(1).max(280),
  options: z.array(z.string().min(1).max(120)).min(2).max(6),
  closesAt: z.string().optional(),
  targetBlockId: z.string().uuid().optional(),
});

const voteSchema = z.object({
  optionId: z.string().uuid(),
});

// ── Shape helpers ─────────────────────────────────────────────────────────────

/**
 * Assemble poll rows + option rows + my-vote rows into the response shape.
 *
 * @param {object[]} polls         - raw DB rows from the polls table
 * @param {object[]} options       - raw DB rows with votes count (per poll_id)
 * @param {object[]} myVotes       - [{ poll_id, option_id }] for the caller (keyed by unit)
 * @param {boolean}  canManage     - whether the caller can manage polls
 * @returns {object[]}
 */
export function assemblePolls(polls, options, myVotes, canManage = false) {
  const myVoteMap = new Map(myVotes.map((v) => [v.poll_id, v.option_id]));
  const optsByPoll = new Map();
  for (const o of options) {
    if (!optsByPoll.has(o.poll_id)) optsByPoll.set(o.poll_id, []);
    optsByPoll.get(o.poll_id).push({ id: o.id, label: o.label, votes: Number(o.votes ?? 0) });
  }

  const now = new Date();
  return polls.map((p) => {
    const opts = optsByPoll.get(p.id) || [];
    const totalVotes = opts.reduce((s, o) => s + o.votes, 0);
    // Effective status: if the poll is stored as closed OR closes_at is in the past → 'closed'
    const effectiveStatus =
      p.status === 'closed' || (p.closes_at && new Date(p.closes_at) < now)
        ? 'closed'
        : p.status;
    return {
      id: p.id,
      question: p.question,
      status: effectiveStatus,
      closesAt: p.closes_at || null,
      targetBlockId: p.target_block_id || null,
      authorName: p.author_name || null,
      createdAt: p.created_at,
      totalVotes,
      myOptionId: myVoteMap.get(p.id) || null,
      canManage,
      options: opts,
    };
  });
}

// ── GET /polls ────────────────────────────────────────────────────────────────
// List community polls with options, vote counts, and the caller's choice.

router.get('/polls', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id, unit_id } = req.user;
    const manage = canManagePolls(req.user);

    // Resolve the caller's block_id (needed for audience filter)
    // queryOne call 1: SELECT block_id FROM units WHERE id=$1
    const callerBlockRow = await queryOne('SELECT block_id FROM units WHERE id=$1', [unit_id]);
    const callerBlock = callerBlockRow?.block_id || null;

    // queryRows call 1: polls (audience-filtered)
    const polls = await queryRows(
      `SELECT id, question, status, closes_at, target_block_id, author_name, created_at
         FROM polls
        WHERE community_id = $1
          AND (target_block_id IS NULL OR target_block_id = $2)
        ORDER BY created_at DESC
        LIMIT 50`,
      [community_id, callerBlock]
    );

    if (polls.length === 0) {
      return success(res, []);
    }

    const pollIds = polls.map((p) => p.id);

    // queryRows call 2: options
    const options = await queryRows(
      `SELECT o.id, o.poll_id, o.label, o.position,
              (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id)::int AS votes
         FROM poll_options o
        WHERE o.poll_id = ANY($1)
        ORDER BY o.position`,
      [pollIds]
    );

    // queryRows call 3: caller's votes — keyed on unit_id (per-unit voting)
    const myVotes = await queryRows(
      `SELECT poll_id, option_id FROM poll_votes
        WHERE poll_id = ANY($1) AND unit_id = $2`,
      [pollIds, unit_id]
    );

    return success(res, assemblePolls(polls, options, myVotes, manage));
  } catch (err) {
    console.error('GET /polls error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── POST /polls ───────────────────────────────────────────────────────────────
// Create a new poll with its options (committee members or admins only).

router.post('/polls', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    // Committee / admin gate — plain residents are blocked here
    if (!canManagePolls(req.user)) {
      return error(res, 'Only committee members can create polls', 403);
    }

    const parsed = createPollSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { question, options, closesAt, targetBlockId } = parsed.data;

    // Validate closesAt if provided
    let closesAtDate = null;
    if (closesAt) {
      closesAtDate = new Date(closesAt);
      if (isNaN(closesAtDate.getTime())) {
        return error(res, 'closesAt is not a valid date', 400);
      }
    }

    const user = req.user;
    const authorName = user.name || 'Resident';

    // If targetBlockId provided, verify it belongs to the caller's community
    if (targetBlockId) {
      const block = await queryOne(
        'SELECT id FROM blocks WHERE id=$1 AND community_id=$2',
        [targetBlockId, user.community_id]
      );
      if (!block) {
        return error(res, 'Block not found in this community', 400);
      }
    }

    const poll = await queryOne(
      `INSERT INTO polls (community_id, created_by, author_name, question, closes_at, target_block_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.community_id, user.sub, authorName, question, closesAtDate || null, targetBlockId || null]
    );

    // Insert each option with its position index
    const insertedOptions = [];
    for (let i = 0; i < options.length; i++) {
      const opt = await queryOne(
        `INSERT INTO poll_options (poll_id, label, position) VALUES ($1, $2, $3) RETURNING *`,
        [poll.id, options[i], i]
      );
      insertedOptions.push({ id: opt.id, label: opt.label, votes: 0 });
    }

    return success(
      res,
      {
        id: poll.id,
        question: poll.question,
        status: poll.status,
        closesAt: poll.closes_at || null,
        targetBlockId: poll.target_block_id || null,
        authorName: poll.author_name || null,
        createdAt: poll.created_at,
        totalVotes: 0,
        myOptionId: null,
        canManage: true,
        options: insertedOptions,
      },
      201
    );
  } catch (err) {
    console.error('POST /polls error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── POST /polls/:id/vote ──────────────────────────────────────────────────────
// Cast a vote on a poll option. Each unit may only vote once per poll.

router.post('/polls/:id/vote', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = voteSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id, sub, unit_id } = req.user;
    const pollId = req.params.id;
    const { optionId } = parsed.data;

    // Verify poll exists in community
    const poll = await queryOne(
      `SELECT id, status, closes_at FROM polls WHERE id = $1 AND community_id = $2`,
      [pollId, community_id]
    );
    if (!poll) {
      return error(res, 'Poll not found', 404);
    }

    // Check effective closed state: stored status OR past closes_at
    const effectivelyClosed =
      poll.status === 'closed' || (poll.closes_at && new Date(poll.closes_at) < new Date());
    if (effectivelyClosed) {
      return error(res, 'Poll is closed', 409);
    }

    // Verify the option belongs to this poll
    const opt = await queryOne(
      `SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2`,
      [optionId, pollId]
    );
    if (!opt) {
      return error(res, 'Option does not belong to this poll', 400);
    }

    // Insert vote — on unique violation (23505) return 409 (one vote per unit)
    try {
      await queryOne(
        `INSERT INTO poll_votes (poll_id, option_id, resident_id, unit_id) VALUES ($1, $2, $3, $4)`,
        [pollId, optionId, sub, unit_id]
      );
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        return error(res, 'This unit has already voted', 409);
      }
      throw dbErr;
    }

    return success(res, { voted: true, optionId }, 201);
  } catch (err) {
    console.error('POST /polls/:id/vote error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── POST /polls/:id/close ─────────────────────────────────────────────────────
// Close a poll (committee members or admins only).

router.post('/polls/:id/close', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    if (!canManagePolls(req.user)) {
      return error(res, 'Only committee members can close polls', 403);
    }

    const { community_id } = req.user;
    const pollId = req.params.id;

    const poll = await queryOne(
      `SELECT id FROM polls WHERE id = $1 AND community_id = $2`,
      [pollId, community_id]
    );
    if (!poll) {
      return error(res, 'Poll not found', 404);
    }

    await queryOne(`UPDATE polls SET status='closed' WHERE id=$1`, [pollId]);

    return success(res, { id: pollId, status: 'closed' });
  } catch (err) {
    console.error('POST /polls/:id/close error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
