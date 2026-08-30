/**
 * End-to-end smoke test of the valet flow: a real service, a real Postgres,
 * over real HTTP. The vitest suites mock the database and prove routing,
 * validation and the state machine; this proves the pieces work together, and
 * it is what to run against a freshly deployed box.
 *
 *   VALET_BASE_URL=http://127.0.0.1:3060 \
 *   VALET_E2E_DATABASE_URL=postgresql://cguser:devpass@localhost:5432/communitygate \
 *   JWT_SECRET=<the running service's secret> \
 *   node scripts/e2e-smoke.mjs
 *
 * It seeds a throwaway community and removes it again, so it is safe to run
 * against a live database — but it does write, so never point it at one you
 * would not want a test hotel in.
 */
import pg from 'pg';
import jwt from 'jsonwebtoken';

const BASE = process.env.VALET_BASE_URL || 'http://127.0.0.1:3060';
const DB = process.env.VALET_E2E_DATABASE_URL;
const SECRET = process.env.JWT_SECRET;

if (!DB || !SECRET) {
  console.error('Set VALET_E2E_DATABASE_URL and JWT_SECRET (matching the running service).');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: DB });
let pass = 0, fail = 0;

function check(label, cond, detail = '') {
  if (cond) { console.log(`  ok   ${label}`); pass++; }
  else { console.log(`  FAIL ${label} ${detail}`); fail++; }
}

async function api(path, { method = 'GET', token, body, raw } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body: json };
}

// --- seed a community, unit and two guards ---------------------------------
const c = await pool.query(
  `INSERT INTO communities (name, address, city) VALUES ('E2E Hotel','1 Rd','Bengaluru') RETURNING id`
);
const communityId = c.rows[0].id;
const b = await pool.query(`INSERT INTO blocks (community_id,name) VALUES ($1,'A') RETURNING id`, [communityId]);
const u = await pool.query(
  `INSERT INTO units (community_id,block_id,unit_number) VALUES ($1,$2,'A-1') RETURNING id`,
  [communityId, b.rows[0].id]
);
const g = await pool.query(
  `INSERT INTO residents (community_id,unit_id,name,mobile,type)
   VALUES ($1,$2,'Ramesh','9000000001','guard'),($1,$2,'Suresh','9000000002','guard') RETURNING id`,
  [communityId, u.rows[0].id]
);
const [guardA, guardB] = g.rows.map((r) => r.id);

const tokenA = jwt.sign({ sub: guardA, role: 'guard', community_id: communityId, name: 'Ramesh' }, SECRET);
const tokenB = jwt.sign({ sub: guardB, role: 'guard', community_id: communityId, name: 'Suresh' }, SECRET);
const adminToken = jwt.sign({ sub: guardA, role: 'community_admin', community_id: communityId }, SECRET);

console.log('\n--- health & auth ---');
check('health responds', (await api('/health')).body?.status === 'ok');
check('guard routes reject an anonymous caller', (await api('/guard/tickets')).status === 401);
check('guard routes reject a resident token',
  (await api('/guard/tickets', { token: jwt.sign({ sub: guardA, role: 'resident', community_id: communityId }, SECRET) })).status === 403);

console.log('\n--- ticket creation ---');
const created = await api('/guard/tickets', {
  method: 'POST', token: tokenA,
  body: { plate: 'ka 03 nj 0435', vehicleMake: 'Maruti Swift', stayEndAt: new Date(Date.now() + 864e5).toISOString() },
});
check('creates a ticket', created.status === 201, JSON.stringify(created.body));
const sessionToken = created.body?.sessionToken;
check('display id is sequential', created.body?.displayId === 'SRT-0001', created.body?.displayId);
check('session token is long', sessionToken?.length === 32);
check('returns a scannable QR', String(created.body?.qrDataUrl).startsWith('data:image/png;base64,'));
check('guest URL embeds the token', String(created.body?.guestUrl).includes(sessionToken));

console.log('\n--- returning vehicle ---');
await api('/guard/tickets', {
  method: 'POST', token: tokenA,
  body: { plate: 'KA03NJ0435', vehicleMake: 'Swift', stayEndAt: new Date(Date.now() + 864e5).toISOString() },
});
const lookup = await api('/guard/plate-lookup?plate=KA%2003%20NJ%200435', { token: tokenA });
check('matches a plate across spacing', lookup.body?.isReturning === true && lookup.body?.visitCount === 2,
  JSON.stringify(lookup.body));

console.log('\n--- guest view (unauthenticated) ---');
const guest = await api(`/guest/tickets/${sessionToken}`);
check('guest sees their vehicle', guest.body?.plate === 'KA 03 NJ 0435', JSON.stringify(guest.body));
check('guest sees the venue name', guest.body?.venueName === 'E2E Hotel');
check('guest sees the drop-off valet', guest.body?.dropOffGuardName === 'Ramesh');
check('guest response leaks no session token', guest.body?.sessionToken === undefined);
const unknown = await api('/guest/tickets/definitely-not-a-real-token');
check('unknown token 404s generically', unknown.status === 404 && unknown.body?.error === 'not_found');

console.log('\n--- request / accept / arrive ---');
check('guest requests their car', (await api(`/guest/tickets/${sessionToken}/request`, { method: 'POST' })).body?.status === 'requested');
const accepted = await api(`/guard/tickets/${sessionToken}/accept`, { method: 'POST', token: tokenB, body: { etaMinutes: 5 } });
check('a different valet accepts', accepted.body?.status === 'en_route' && accepted.body?.currentGuardName === 'Suresh',
  JSON.stringify(accepted.body));
const enRoute = await api(`/guest/tickets/${sessionToken}`);
check('guest gets a live countdown', enRoute.body?.etaSeconds > 250 && enRoute.body?.etaSeconds <= 300, String(enRoute.body?.etaSeconds));
check('guest sees who is bringing the car', enRoute.body?.guardName === 'Suresh');
check('rejects an out-of-range ETA',
  (await api(`/guard/tickets/${sessionToken}/accept`, { method: 'POST', token: tokenB, body: { etaMinutes: 99 } })).status === 409);
check('marks arrived', (await api(`/guard/tickets/${sessionToken}/arrived`, { method: 'POST', token: tokenB })).body?.status === 'arrived');

console.log('\n--- rotating QR ---');
const qr1 = await api(`/guest/tickets/${sessionToken}/rotating-qr`);
check('issues a pickup QR once arrived', qr1.status === 200 && String(qr1.body?.qrDataUrl).startsWith('data:image'));
const rot1 = (await pool.query(
  `SELECT token FROM valet_rotating_tokens WHERE ticket_id=(SELECT id FROM valet_tickets WHERE session_token=$1)
   ORDER BY generated_at DESC LIMIT 1`, [sessionToken])).rows[0].token;
await api(`/guest/tickets/${sessionToken}/rotating-qr`);   // supersede it
check('a superseded code is refused',
  (await api(`/guard/tickets/${sessionToken}/scan`, { method: 'POST', token: tokenB, body: { rotatingToken: rot1 } })).status === 400);
const rot2 = (await pool.query(
  `SELECT token FROM valet_rotating_tokens WHERE ticket_id=(SELECT id FROM valet_tickets WHERE session_token=$1)
   ORDER BY generated_at DESC LIMIT 1`, [sessionToken])).rows[0].token;
check('the newest code scans', (await api(`/guard/tickets/${sessionToken}/scan`, { method: 'POST', token: tokenB, body: { rotatingToken: rot2 } })).body?.success === true);
check('the same code cannot be replayed',
  (await api(`/guard/tickets/${sessionToken}/scan`, { method: 'POST', token: tokenB, body: { rotatingToken: rot2 } })).status === 400);

console.log('\n--- pickup guards (enforced server-side) ---');
const noCondition = await api(`/guard/tickets/${sessionToken}/confirm-pickup`, { method: 'POST', token: tokenB, body: {} });
check('refuses pickup without return condition media',
  noCondition.status === 409 && noCondition.body?.error === 'return_condition_required', JSON.stringify(noCondition.body));

// Upload one return capture as real multipart.
const form = new FormData();
form.append('stage', 'return');
form.append('mediaType', 'photo');
form.append('angle', 'front');
form.append('media', new Blob([Buffer.from('fake-jpeg-bytes')], { type: 'image/jpeg' }), 'front.jpg');
const upload = await fetch(`${BASE}/guard/tickets/${sessionToken}/condition`, {
  method: 'POST', headers: { Authorization: `Bearer ${tokenB}` }, body: form,
});
check('accepts a return condition upload', upload.status === 201, String(upload.status));

const confirmed = await api(`/guard/tickets/${sessionToken}/confirm-pickup`, { method: 'POST', token: tokenB, body: {} });
check('now confirms, keeping a multi-day ticket alive', confirmed.body?.status === 'parked_again', JSON.stringify(confirmed.body));

console.log('\n--- second pickup on the same ticket ---');
await api(`/guest/tickets/${sessionToken}/request`, { method: 'POST' });
await api(`/guard/tickets/${sessionToken}/accept`, { method: 'POST', token: tokenA, body: {} });
await api(`/guard/tickets/${sessionToken}/arrived`, { method: 'POST', token: tokenA });
const stale = await api(`/guard/tickets/${sessionToken}/confirm-pickup`, { method: 'POST', token: tokenA, body: { final: true } });
check('an earlier pickup\'s capture does not satisfy this one',
  stale.status === 409 && stale.body?.error === 'scan_required', JSON.stringify(stale.body));

console.log('\n--- admin reporting ---');
check('plate history refuses a guard token', (await api('/admin/plate-history?plate=KA03NJ0435', { token: tokenA })).status === 403);
const hist = await api('/admin/plate-history?plate=ka 03 nj 0435', { token: adminToken });
check('plate history works for an admin', hist.status === 200 && hist.body?.visitCount === 2, JSON.stringify(hist.body));

console.log('\n--- audit trail ---');
const detail = await api(`/guard/tickets/${sessionToken}`, { token: tokenA });
const kinds = detail.body?.events?.map((e) => e.event_type) || [];
check('records the whole journey',
  ['created', 'requested', 'accepted', 'arrived', 'scan_success', 'condition_captured', 'closed_pickup'].every((k) => kinds.includes(k)),
  kinds.join(','));
check('attributes events to the acting valet', detail.body?.events?.some((e) => e.event_type === 'accepted' && e.guard_name === 'Suresh'));

// Remove everything this run created, so it can be run repeatedly and leaves
// no test hotel behind on a real database.
await pool.query('DELETE FROM valet_discount_optins WHERE community_id = $1', [communityId]);
await pool.query('DELETE FROM valet_tickets WHERE community_id = $1', [communityId]);
await pool.query('DELETE FROM residents WHERE community_id = $1', [communityId]);
await pool.query('DELETE FROM units WHERE community_id = $1', [communityId]);
await pool.query('DELETE FROM blocks WHERE community_id = $1', [communityId]);
await pool.query('DELETE FROM communities WHERE id = $1', [communityId]);
await pool.end();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
