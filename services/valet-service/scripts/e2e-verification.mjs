/**
 * End-to-end proof that a handover records HOW the guest was identified.
 *
 * The scan proves possession of the live ticket and nothing about who holds
 * it. The intake photo is the second factor and is optional, so a release can
 * legitimately happen with no photo on file — and the audit trail has to say
 * which of the two happened, or a later dispute is unanswerable.
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

const c = await pool.query(`INSERT INTO communities (name,address,city) VALUES ('Verif','1','B') RETURNING id`);
const cid = c.rows[0].id;
const b = await pool.query(`INSERT INTO blocks (community_id,name) VALUES ($1,'A') RETURNING id`, [cid]);
const u = await pool.query(`INSERT INTO units (community_id,block_id,unit_number) VALUES ($1,$2,'U') RETURNING id`, [cid, b.rows[0].id]);
const g = await pool.query(`INSERT INTO residents (community_id,unit_id,name,mobile,type) VALUES ($1,$2,'Ramesh','9000000601','guard') RETURNING id`, [cid, u.rows[0].id]);
const token = jwt.sign({ sub: g.rows[0].id, role: 'guard', community_id: cid, name: 'Ramesh' }, SECRET);

/** Drives a ticket to the point a pickup can be confirmed. */
async function readyTicket(plate) {
  const t = (await api('/guard/tickets', {
    method: 'POST', token,
    body: { plate, vehicleMake: 'Swift', stayEndAt: new Date(Date.now() + 864e5).toISOString() },
  })).body;
  await api(`/guest/tickets/${t.sessionToken}/request`, { method: 'POST' });
  await api(`/guard/tickets/${t.sessionToken}/accept`, { method: 'POST', token, body: {} });
  await api(`/guard/tickets/${t.sessionToken}/arrived`, { method: 'POST', token });
  // A real scan, so the server-side scan guard is genuinely satisfied. The
  // rotating token only ever leaves the service inside the QR image, never as
  // text, so read it the way a camera would recover it.
  await api(`/guest/tickets/${t.sessionToken}/rotating-qr`);
  const rot = await pool.query(
    `SELECT token FROM valet_rotating_tokens
      WHERE ticket_id=(SELECT id FROM valet_tickets WHERE session_token=$1)
      ORDER BY generated_at DESC LIMIT 1`,
    [t.sessionToken]
  );
  await api(`/guard/tickets/${t.sessionToken}/scan`, {
    method: 'POST', token, body: { rotatingToken: rot.rows[0].token },
  });
  await pool.query(
    `INSERT INTO valet_condition_records (ticket_id, stage, media_type, storage_key, captured_at)
     VALUES ((SELECT id FROM valet_tickets WHERE session_token=$1), 'return', 'photo', 'k.jpg', NOW())`,
    [t.sessionToken]
  );
  return t.sessionToken;
}

async function metadataOf(sessionToken, eventType) {
  const r = await pool.query(
    `SELECT metadata FROM valet_ticket_events
      WHERE ticket_id=(SELECT id FROM valet_tickets WHERE session_token=$1) AND event_type=$2
      ORDER BY created_at DESC LIMIT 1`,
    [sessionToken, eventType]
  );
  return r.rows[0]?.metadata ?? null;
}

// Cleanup runs even when an assertion throws. Two crashed runs of this
// script once left four throwaway venues sitting in the production
// database, which is exactly what seeding-and-deleting is meant to avoid.
try {
  console.log('\n--- a ticket with no intake photo ---');
  const noPhoto = await readyTicket('KA 01 NP 1111');
  const detail = await api(`/guard/tickets/${noPhoto}`, { token });
  check('the ticket reports no photo, so the app can say so', detail.body?.hasPhoto === false);

  const liar = await api(`/guard/tickets/${noPhoto}/confirm-pickup`, {
    method: 'POST', token, body: { verification: 'photo' },
  });
  // The client is the thing being audited, so this cannot be left to the client.
  check('a claimed photo match is refused when no photo exists',
    liar.status === 409 && liar.body?.error === 'no_photo_to_match', JSON.stringify(liar.body));
  const stillOpen = await api(`/guard/tickets/${noPhoto}`, { token });
  check('and the refused claim did not release the car', stillOpen.body?.status === 'arrived', stillOpen.body?.status);

  const honest = await api(`/guard/tickets/${noPhoto}/confirm-pickup`, {
    method: 'POST', token, body: { verification: 'vehicle_confirmed' },
  });
  check('a vehicle confirmation releases the car', honest.status === 200, JSON.stringify(honest.body));
  check('and is recorded as such, not as a photo match',
    (await metadataOf(noPhoto, 'closed_pickup'))?.verification === 'vehicle_confirmed',
    JSON.stringify(await metadataOf(noPhoto, 'closed_pickup')));

  console.log('\n--- a ticket with an intake photo ---');
  const withPhoto = await readyTicket('KA 02 WP 2222');
  await pool.query(
    `INSERT INTO valet_photos (ticket_id, storage_key, consent_at)
     VALUES ((SELECT id FROM valet_tickets WHERE session_token=$1), 'p.jpg', NOW())`,
    [withPhoto]
  );
  const d2 = await api(`/guard/tickets/${withPhoto}`, { token });
  check('the ticket reports a photo', d2.body?.hasPhoto === true);

  const photoOk = await api(`/guard/tickets/${withPhoto}/confirm-pickup`, {
    method: 'POST', token, body: { verification: 'photo' },
  });
  check('a photo match is accepted', photoOk.status === 200);
  check('and recorded as a photo match',
    (await metadataOf(withPhoto, 'closed_pickup'))?.verification === 'photo');

  console.log('\n--- an older app that sends no verification field ---');
  const legacy = await readyTicket('KA 03 LG 3333');
  await api(`/guard/tickets/${legacy}/confirm-pickup`, { method: 'POST', token, body: {} });
  // A build from before this change must never have its release recorded as a
  // photo match it never performed.
  check('falls back to the truth rather than claiming a photo match',
    (await metadataOf(legacy, 'closed_pickup'))?.verification === 'vehicle_confirmed',
    JSON.stringify(await metadataOf(legacy, 'closed_pickup')));

  console.log('\n--- the photo endpoint still needs a guard token ---');
  const anon = await fetch(`${BASE}/guard/tickets/${withPhoto}/photo`);
  check('an unauthenticated fetch is refused', anon.status === 401, String(anon.status));
  const authed = await fetch(`${BASE}/guard/tickets/${withPhoto}/photo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // 404 here only because the scratch row points at a key with no stored bytes;
  // what matters is that the token gets past the guard rather than 401ing.
  check('an authenticated one gets past auth', authed.status !== 401, String(authed.status));
} finally {
  await pool.query('DELETE FROM valet_ticket_events WHERE ticket_id IN (SELECT id FROM valet_tickets WHERE community_id=$1)', [cid]);
  await pool.query('DELETE FROM valet_condition_records WHERE ticket_id IN (SELECT id FROM valet_tickets WHERE community_id=$1)', [cid]);
  await pool.query('DELETE FROM valet_photos WHERE ticket_id IN (SELECT id FROM valet_tickets WHERE community_id=$1)', [cid]);
  await pool.query('DELETE FROM valet_rotating_tokens WHERE ticket_id IN (SELECT id FROM valet_tickets WHERE community_id=$1)', [cid]);
  await pool.query('DELETE FROM valet_tickets WHERE community_id=$1', [cid]);
  await pool.query('DELETE FROM residents WHERE community_id=$1', [cid]);
  await pool.query('DELETE FROM units WHERE community_id=$1', [cid]);
  await pool.query('DELETE FROM blocks WHERE community_id=$1', [cid]);
  await pool.query('DELETE FROM communities WHERE id=$1', [cid]);
  await pool.end();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
