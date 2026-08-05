import { Router } from 'express';
import { z } from 'zod';
import { queryOne, queryRows } from '../db/queries.js';
import { success, error } from '../middleware/response.js';
import { authenticateJWT } from '../middleware/auth.js';
import { resolveCaller } from '../lib/committee.js';

const router = Router();

// ── Auth helpers ──────────────────────────────────────────────────────────────

function isAdmin(user) {
  return user.role === 'admin' || user.role === 'community_admin' || user.role === 'super_admin';
}

/**
 * Committee members OR admins may create/close polls.
 *
 * Admins take a fast path with no DB round trip — an admin token's `sub` is
 * an admins.id, which would never match a residents row anyway. Everyone
 * else is checked fresh against `residents.committee_role` via
 * resolveCaller, never from `user.is_committee` on the JWT: that claim is
 * minted at login, so a resident appointed to (or removed from) the
 * committee afterwards would keep the stale answer until they log in again.
 */
async function canManagePolls(user) {
  if (isAdmin(user)) return true;
  const caller = await resolveCaller(queryOne, user);
  return caller.isCommittee;
}

// ── Audience rules (BRD poll rules) ─────────────────────────────────────────
// Exported because both the create-time validation below and the vote handler
// need the same list/logic, and a rule that drifts between the two is a
// security bug, not a style problem.

export const POLL_AUDIENCES = ['all', 'owners', 'block'];

export function isEligibleVoter(poll, voter) {
  if (poll?.audience === 'owners') return voter?.resident_type === 'owner';
  if (poll?.audience === 'block') return voter?.block_id === poll.target_block_id;
  return true;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createPollSchema = z.object({
  topic: z.string().max(80).optional(),
  question: z.string().min(1).max(280),
  options: z.array(z.string().min(1).max(120)).min(2).max(6),
  closesAt: z.string().optional(),
  audience: z.enum(POLL_AUDIENCES).optional().default('all'),
  targetBlockId: z.string().uuid().optional(),
  oneVotePerUnit: z.boolean().optional().default(true),
  isAnonymous: z.boolean().optional().default(false),
  showLiveResults: z.boolean().optional().default(true),
});

const voteSchema = z.object({
  optionId: z.string().uuid(),
});

// ── Shape helpers ─────────────────────────────────────────────────────────────

/**
 * Assemble poll rows + option rows + my-vote rows into the response shape.
 *
 * Respects `show_live_results`: while a poll is open and results are hidden,
 * every vote count (per-option and total) comes back null rather than the
 * real number — the app renders "Results hidden until poll closes". Once the
 * poll is closed (by status or by closes_at), real tallies are always shown.
 *
 * Anonymity note: this shape never carries voter identity to begin with —
 * only aggregate counts and the caller's own `myOptionId` (their own vote,
 * which they need to see what they chose) — so `is_anonymous` needs no
 * separate branch here. It exists as a column for future read paths (e.g. a
 * "who voted" list) to check before ever joining in a voter's name.
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
    const closed = effectiveStatus === 'closed';
    const revealResults = p.show_live_results !== false || closed;

    return {
      id: p.id,
      topic: p.topic || null,
      question: p.question,
      status: effectiveStatus,
      closesAt: p.closes_at || null,
      audience: p.audience || 'all',
      targetBlockId: p.target_block_id || null,
      oneVotePerUnit: p.one_vote_per_unit !== false,
      isAnonymous: p.is_anonymous === true,
      showLiveResults: p.show_live_results !== false,
      authorName: p.author_name || null,
      createdAt: p.created_at,
      totalVotes: revealResults ? totalVotes : null,
      myOptionId: myVoteMap.get(p.id) || null,
      canManage,
      options: opts.map((o) => ({ ...o, votes: revealResults ? o.votes : null })),
    };
  });
}

// ── GET /polls ────────────────────────────────────────────────────────────────
// List community polls with options, vote counts, and the caller's choice.

router.get('/polls', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const { community_id, unit_id } = req.user;

    // Resolve the caller's block_id (needed for audience filter)
    // queryOne call 1: SELECT block_id FROM units WHERE id=$1
    const callerBlockRow = await queryOne('SELECT block_id FROM units WHERE id=$1', [unit_id]);
    const callerBlock = callerBlockRow?.block_id || null;

    // queryRows call 1: polls (audience-filtered)
    const polls = await queryRows(
      `SELECT id, topic, question, status, closes_at, audience, target_block_id,
              one_vote_per_unit, is_anonymous, show_live_results, author_name, created_at
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

    // Computed after the queries above so it cannot shift their positional
    // mock/call order (community.test.js and poll-rules.test.js both assert
    // it) — the same reasoning community-feed.js's `me` lookup documents.
    const manage = await canManagePolls(req.user);

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
    // Committee / admin gate — plain residents (and guards, who never reach
    // this role check because authenticateJWT already rejects a 'guard' role
    // token above) are blocked here.
    if (!(await canManagePolls(req.user))) {
      return error(res, 'Only committee members can create polls', 403);
    }

    const parsed = createPollSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const {
      topic, question, options, closesAt, audience, targetBlockId,
      oneVotePerUnit, isAnonymous, showLiveResults,
    } = parsed.data;

    // closesAt stays optional (pre-existing behaviour — some callers create
    // open-ended polls), but when it IS given it must be a real, FUTURE
    // instant per the BRD: a poll that starts already closed is a dead poll.
    let closesAtDate = null;
    if (closesAt) {
      closesAtDate = new Date(closesAt);
      if (isNaN(closesAtDate.getTime())) {
        return error(res, 'closesAt is not a valid date', 400);
      }
      if (closesAtDate <= new Date()) {
        return error(res, 'closesAt must be in the future', 422);
      }
    }

    // A block-audience poll with no target block would compare every voter's
    // block_id against NULL forever — nobody could ever vote, with nothing
    // in the response to explain why. Reject at creation instead.
    if (audience === 'block' && !targetBlockId) {
      return error(res, 'targetBlockId is required when audience is "block"', 422);
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
      `INSERT INTO polls (
         community_id, created_by, author_name, topic, question, closes_at,
         audience, target_block_id, one_vote_per_unit, is_anonymous, show_live_results
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        user.community_id, user.sub, authorName, topic || null, question, closesAtDate,
        audience, targetBlockId || null, oneVotePerUnit, isAnonymous, showLiveResults,
      ]
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
        topic: poll.topic || null,
        question: poll.question,
        status: poll.status,
        closesAt: poll.closes_at || null,
        audience: poll.audience,
        targetBlockId: poll.target_block_id || null,
        oneVotePerUnit: poll.one_vote_per_unit !== false,
        isAnonymous: poll.is_anonymous === true,
        showLiveResults: poll.show_live_results !== false,
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
// Cast a vote on a poll option. Each unit may only vote once per poll, unless
// the poll turned that rule off (`one_vote_per_unit = false`).

router.post('/polls/:id/vote', authenticateJWT(['resident', 'admin']), async (req, res) => {
  try {
    const parsed = voteSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, 'Validation error', 400, parsed.error.issues);
    }
    const { community_id, sub, unit_id } = req.user;
    const pollId = req.params.id;
    const { optionId } = parsed.data;

    // Verify poll exists in community, and in the same query resolve the
    // voter's resident_type + block_id — isEligibleVoter needs both, and
    // neither lives in the JWT. One combined queryOne rather than two
    // separate lookups so this stays a single round trip; a LEFT JOIN means
    // a poll that exists still comes back even if the resident row somehow
    // doesn't (defaults resident_type/voter_block_id to NULL, which
    // isEligibleVoter treats as ineligible for 'owners'/'block' audiences —
    // safe by default rather than a separate 404 branch).
    const poll = await queryOne(
      `SELECT p.id, p.status, p.closes_at, p.audience, p.target_block_id, p.one_vote_per_unit,
              r.type AS resident_type, u.block_id AS voter_block_id
         FROM polls p
         LEFT JOIN residents r ON r.id = $3
         LEFT JOIN units u ON u.id = r.unit_id
        WHERE p.id = $1 AND p.community_id = $2`,
      [pollId, community_id, sub]
    );
    if (!poll) {
      return error(res, 'Poll not found', 404);
    }

    const voter = { resident_type: poll.resident_type, unit_id, block_id: poll.voter_block_id };
    if (!isEligibleVoter(poll, voter)) {
      return error(res, 'This poll is not open to you', 403);
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

    // Friendly pre-check on the common path. This is check-then-act and loses
    // a race between two residents of the same unit voting simultaneously —
    // the partial unique index from migration 038
    // (uniq_poll_unit_when_required, WHERE one_vote_per_unit) is the real
    // backstop, caught below.
    if (poll.one_vote_per_unit) {
      const existing = await queryOne(
        'SELECT 1 FROM poll_votes WHERE poll_id = $1 AND unit_id = $2',
        [pollId, unit_id]
      );
      if (existing) return error(res, 'This unit has already voted', 409);
    }

    // Insert vote — every poll_votes row carries its own one_vote_per_unit,
    // copied from the parent poll at insert time (038's backfill migration
    // did the same for pre-existing rows). A vote row that disagreed with its
    // poll would silently disable the partial index for that flat.
    try {
      await queryOne(
        `INSERT INTO poll_votes (poll_id, option_id, resident_id, unit_id, one_vote_per_unit)
         VALUES ($1, $2, $3, $4, $5)`,
        [pollId, optionId, sub, unit_id, poll.one_vote_per_unit]
      );
    } catch (dbErr) {
      // 23505 = unique_violation. Only the partial index guarding this poll
      // can fire it here (option_id/poll_id/unit_id are all already
      // validated above), so it always means "this unit already voted".
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
    if (!(await canManagePolls(req.user))) {
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
