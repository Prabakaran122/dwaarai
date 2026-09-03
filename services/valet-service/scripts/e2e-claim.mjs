/**
 * Two things a guest needs when they are not holding plastic, against a real
 * service and database:
 *
 *   1. a claim code that gets them back to their own vehicle later, and
 *   2. a card code that CANNOT get them to somebody else's.
 *
 * The second is the sharper one. Card codes are unique per venue, not
 * globally, and every box of cards starts at A001 — so the resolution has to
 * be scoped or a guest at one property can be handed a stranger's car at
 * another.
 */
import pg from 'pg';
import jwt from 'jsonwebtoken';

const BASE = process.env.VALET_BASE_URL;
const pool = new pg.Pool({ connectionString: process.env.VALET_E2E_DATABASE_URL });
const SECRET = process.env.JWT_SECRET;
let pass = 0, fail = 0;
const check = (l, ok, d = '') => { ok ? (console.log('  ok   ' + l), pass++) : (console.log('  FAIL ' + l + ' ' + d), fail++); };

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

/** A venue with a guard, a box of cards, and a token for each role. */
async function venue(name, mobile) {
  const c = await pool.query(`INSERT INTO communities (name,address,city) VALUES ($1,'1','B') RETURNING id`, [name]);
  const cid = c.rows[0].id;
  const b = await pool.query(`INSERT INTO blocks (community_id,name) VALUES ($1,'A') RETURNING id`, [cid]);
  const u = await pool.query(`INSERT INTO units (community_id,block_id,unit_number) VALUES ($1,$2,'U') RETURNING id`, [cid, b.rows[0].id]);
  const g = await pool.query(`INSERT INTO residents (community_id,unit_id,name,mobile,type) VALUES ($1,$2,$3,$4,'guard') RETURNING id`, [cid, u.rows[0].id, 'G-' + name, mobile]);
  return {
    id: cid,
    guard: jwt.sign({ sub: g.rows[0].id, role: 'guard', community_id: cid, name: 'G' }, SECRET),
    admin: jwt.sign({ sub: g.rows[0].id, role: 'community_admin', community_id: cid, name: 'M' }, SECRET),
  };
}

const stay = () => new Date(Date.now() + 864e5).toISOString();
const A = await venue('Claim Venue A', '9000000701');
const B = await venue('Claim Venue B', '9000000702');

console.log('\n--- every ticket gets a code the guest can carry ---');
const t1 = await api('/guard/tickets', {
  method: 'POST', token: A.guard,
  body: { plate: 'KA 01 CC 1111', vehicleMake: 'Swift', stayEndAt: stay() },
});
const claim = t1.body?.claimCode;
check('a card-less ticket still issues a claim code', typeof claim === 'string' && claim.length === 6, JSON.stringify(t1.body?.claimCode));
check('and it avoids the characters that get misheard',
  /^[ABCDEFGHJKLMNPQRTUVWXYZ23456789]{6}$/.test(claim || ''), claim);

const resolved = await api(`/guest/claim/${claim}`);
check('the guest can type it and reach their vehicle', resolved.body?.sessionToken === t1.body.sessionToken);
check('and it returns nothing else', Object.keys(resolved.body || {}).join() === 'sessionToken');

const lower = await api(`/guest/claim/${claim.toLowerCase()}`);
check('case does not matter', lower.body?.sessionToken === t1.body.sessionToken);

// O for Q and I for J are why those letters are not in the alphabet.
const misread = claim.replace(/Q/g, 'O').replace(/J/g, 'I');
const forgiven = await api(`/guest/claim/${misread}`);
check('a misread O for Q or I for J still resolves',
  forgiven.body?.sessionToken === t1.body.sessionToken, `${claim} typed as ${misread}`);

const guestView = await api(`/guest/tickets/${resolved.body.sessionToken}`);
check('and the guest can drive the flow from there', guestView.body?.plate === 'KA 01 CC 1111');

console.log('\n--- the guard can find the code again later ---');
// A guest phones having lost it. The handout is long gone, so the code has to
// be findable from the queue and from the operator's search.
const queue = await api('/guard/tickets', { token: A.guard });
const inQueue = queue.body?.tickets?.find((t) => t.sessionToken === t1.body.sessionToken);
check('the queue carries the claim code', inQueue?.claimCode === claim, JSON.stringify(inQueue?.claimCode));

const found = await api('/admin/tickets/search?plate=CC1111', { token: A.admin });
check('the operator search carries it too',
  found.body?.tickets?.[0]?.claimCode === claim, JSON.stringify(found.body?.tickets?.[0]));

check('the create response says where the guest should type it',
  typeof t1.body?.claimUrl === 'string' && t1.body.claimUrl.includes('/valet'), t1.body?.claimUrl);

console.log('\n--- the code dies with the ticket ---');
await api(`/guard/tickets/${t1.body.sessionToken}/expire`, { method: 'POST', token: A.guard });
const afterClose = await api(`/guest/claim/${claim}`);
check('a closed ticket stops resolving', afterClose.status === 404);
const unknown = await api('/guest/claim/ZZZZZZ');
check('and looks identical to a code that never existed',
  unknown.status === afterClose.status && JSON.stringify(unknown.body) === JSON.stringify(afterClose.body));

console.log('\n--- two venues, the same card code ---');
// Every box of cards starts at A001. This is the collision that would hand a
// guest a stranger's vehicle at a property they have never visited.
for (const v of [A, B]) {
  await api('/admin/cards', { method: 'POST', token: v.admin, body: { codes: ['A001'] } });
}
const carA = await api('/guard/tickets', {
  method: 'POST', token: A.guard,
  body: { plate: 'KA 11 AA 1111', vehicleMake: 'Venue A car', stayEndAt: stay(), cardCode: 'A001' },
});
const carB = await api('/guard/tickets', {
  method: 'POST', token: B.guard,
  body: { plate: 'KA 22 BB 2222', vehicleMake: 'Venue B car', stayEndAt: stay(), cardCode: 'A001' },
});
check('both venues can have A001 on an open ticket at once',
  carA.status === 201 && carB.status === 201, `${carA.status}/${carB.status}`);

const scopedA = await api(`/guest/cards/${A.id}/A001`);
const scopedB = await api(`/guest/cards/${B.id}/A001`);
check("venue A's card resolves to venue A's car", scopedA.body?.sessionToken === carA.body.sessionToken);
check("venue B's card resolves to venue B's car", scopedB.body?.sessionToken === carB.body.sessionToken);
check('and the two are different vehicles', scopedA.body?.sessionToken !== scopedB.body?.sessionToken);

const unscoped = await api('/guest/cards/A001');
check('an unscoped card lookup no longer exists at all', unscoped.status === 404, String(unscoped.status));
const wrongVenue = await api(`/guest/cards/00000000-0000-0000-0000-0000000000ff/A001`);
check('a card code against a venue that does not own it resolves to nothing', wrongVenue.status === 404);

console.log('\n--- claim codes are unique across venues, unlike card codes ---');
const both = await pool.query(
  `SELECT claim_code, COUNT(*)::int c FROM valet_tickets
    WHERE claim_code IS NOT NULL AND status NOT IN ('final_closed','expired')
    GROUP BY claim_code HAVING COUNT(*) > 1`
);
check('no two open tickets share a claim code', both.rows.length === 0, JSON.stringify(both.rows));

for (const cid of [A.id, B.id]) {
  await pool.query('DELETE FROM valet_ticket_events WHERE ticket_id IN (SELECT id FROM valet_tickets WHERE community_id=$1)', [cid]);
  await pool.query('DELETE FROM valet_tickets WHERE community_id=$1', [cid]);
  await pool.query('DELETE FROM valet_cards WHERE community_id=$1', [cid]);
  await pool.query('DELETE FROM residents WHERE community_id=$1', [cid]);
  await pool.query('DELETE FROM units WHERE community_id=$1', [cid]);
  await pool.query('DELETE FROM blocks WHERE community_id=$1', [cid]);
  await pool.query('DELETE FROM communities WHERE id=$1', [cid]);
}
await pool.end();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
