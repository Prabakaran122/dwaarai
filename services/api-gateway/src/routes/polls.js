import { Router } from 'express';
import { z } from 'zod';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createPollSchema = z.object({
  question: z.string().min(1).max(280),
  options: z.array(z.string().min(1).max(120)).min(2).max(6),
  closesAt: z.string().datetime({ offset: true }).optional(),
});

const voteSchema = z.object({
  optionId: z.string().uuid(),
});

// ── Shape helpers ─────────────────────────────────────────────────────────────

/**
 * Assemble poll rows + option rows + my-vote rows into the response shape.
 * polls    — raw DB rows from the polls table
 * options  — raw DB rows with votes count (per poll_id)
 * myVotes  — [{ poll_id, option_id }] for the caller
 */
export function assemblePolls(polls, options, myVotes) {
  const myVoteMap = new Map(myVotes.map((v) => [v.poll_id, v.option_id]));
  const optsByPoll = new Map();
  for (const o of options) {
    if (!optsByPoll.has(o.poll_id)) optsByPoll.set(o.poll_id, []);
    optsByPoll.get(o.poll_id).push({ id: o.id, label: o.label, votes: Number(o.votes ?? 0) });
  }

  return polls.map((p) => {
    const opts = optsByPoll.get(p.id) || [];
    const totalVotes = opts.reduce((s, o) => s + o.votes, 0);
    return {
      id: p.id,
      question: p.question,
      status: p.status,
      closesAt: p.closes_at || null,
      authorName: p.author_name || null,
      createdAt: p.created_at,
      totalVotes,
      myOptionId: myVoteMap.get(p.id) || null,
      options: opts,
    };
  });
}

// ── GET /polls ────────────────────────────────────────────────────────────────
// List community polls with options, vote counts, and the caller's choice.

router.get('/polls', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id, sub } = req.user;

    const polls = await queryRows(
      `SELECT id, question, status, closes_at, author_name, created_at
         FROM polls
        WHERE community_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [community_id]
    );

    if (polls.length === 0) {
      return success(res, []);
    }

    const pollIds = polls.map((p) => p.id);

    const options = await queryRows(
      `SELECT o.id, o.poll_id, o.label, o.position,
              (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id)::int AS votes
         FROM poll_options o
        WHERE o.poll_id = ANY($1)
        ORDER BY o.position`,
      [pollIds]
    );

    const myVotes = await queryRows(
      `SELECT poll_id, option_id FROM poll_votes
        WHERE poll_id = ANY($1) AND resident_id = $2`,
      [pollIds, sub]
    );

    return success(res, assemblePolls(polls, options, myVotes));
  } catch (err) {
    console.error('GET /polls error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// ── POST /polls ───────────────────────────────────────────────────────────────
// Create a new poll with its options.

router.post('/polls', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = createPollSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { question, options, closesAt } = parsed.data;
    const user = req.user;
    const authorName = user.name || 'Resident';

    const poll = await queryOne(
      `INSERT INTO polls (community_id, created_by, author_name, question, closes_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user.community_id, user.sub, authorName, question, closesAt || null]
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
        authorName: poll.author_name || null,
        createdAt: poll.created_at,
        totalVotes: 0,
        myOptionId: null,
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
// Cast a vote on a poll option. Each resident may only vote once per poll.

router.post('/polls/:id/vote', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = voteSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id, sub } = req.user;
    const pollId = req.params.id;
    const { optionId } = parsed.data;

    // Verify poll exists in community and is open
    const poll = await queryOne(
      `SELECT id, status FROM polls WHERE id = $1 AND community_id = $2`,
      [pollId, community_id]
    );
    if (!poll) {
      return error(res, 'Poll not found', 404);
    }
    if (poll.status !== 'open') {
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

    // Insert vote — on PK conflict (23505) return 409
    try {
      await queryOne(
        `INSERT INTO poll_votes (poll_id, option_id, resident_id) VALUES ($1, $2, $3)`,
        [pollId, optionId, sub]
      );
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        return error(res, 'Already voted', 409);
      }
      throw dbErr;
    }

    return success(res, { voted: true, optionId }, 201);
  } catch (err) {
    console.error('POST /polls/:id/vote error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
