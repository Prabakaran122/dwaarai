/**
 * End-to-end test of physical valet cards and plate search, against a real
 * service and a real Postgres over real HTTP.
 *
 * The mocked suites prove the routing and the branches. This proves the parts
 * that only exist in the database: the partial unique index that stops a card
 * being on two open tickets, and the fact that closing a ticket frees its card
 * without anyone running a release step.
 *
 *   VALET_BASE_URL=http://127.0.0.1:3062 \
 *   VALET_E2E_DATABASE_URL=postgresql://... JWT_SECRET=... node scripts/e2e-cards.mjs
 */
import pg from 'pg';
import jwt from 'jsonwebtoken';

const BASE = process.env.VALET_BASE_URL || 'http://127.0.0.1:3062';
const DB = process.env.VALET_E2E_DATABASE_URL;
const SECRET = process.env.JWT_SECRET;
if (!DB || !SECRET) {
  console.error('Set VALET_E2E_DATABASE_URL and JWT_SECRET');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: DB });
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${label}`); pass++; }
  else { console.log(`  FAIL ${label} ${detail}`); fail++; }
};

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body: json };
}

// --- seed -------------------------------------------------------------------
const c = await pool.query(
  `INSERT INTO communities (name, address, city) VALUES ('Card Test Venue','1 Rd','Bengaluru') RETURNING id`
);
const communityId = c.rows[0].id;
const b = await pool.query(`INSERT INTO blocks (community_id,name) VALUES ($1,'A') RETURNING id`, [communityId]);
const u = await pool.query(
  `INSERT INTO units (community_id,block_id,unit_number) VALUES ($1,$2,'A-1') RETURNING id`,
  [communityId, b.rows[0].id]
);
const g = await pool.query(
  `INSERT INTO residents (community_id,unit_id,name,mobile,type)
   VALUES ($1,$2,'Ramesh','9000000501','guard') RETURNING id`,
  [communityId, u.rows[0].id]
);
const guardId = g.rows[0].id;
const token = jwt.sign({ sub: guardId, role: 'guard', community_id: communityId, name: 'Ramesh' }, SECRET);
const admin = jwt.sign({ sub: guardId, role: 'admin', community_id: communityId, name: 'Manager' }, SECRET);

console.log('\n--- registering printed stock (operator) ---');
const reg = await api('/admin/cards', {
  method: 'POST', token: admin, body: { prefix: 'A', from: 1, to: 3 },
});
check('registers a printed range', reg.status === 201, JSON.stringify(reg.body));
check('creates exactly the codes on the box',
  JSON.stringify(reg.body?.added) === JSON.stringify(['A001', 'A002', 'A003']), JSON.stringify(reg.body));

const again = await api('/admin/cards', {
  method: 'POST', token: admin, body: { prefix: 'A', from: 2, to: 4 },
});
// Ordering an overlapping box is normal; it must not fail or duplicate.
check('an overlapping re-order adds only what is new',
  JSON.stringify(again.body?.added) === JSON.stringify(['A004']) &&
  JSON.stringify(again.body?.skipped) === JSON.stringify(['A002', 'A003']), JSON.stringify(again.body));

const dupes = await pool.query(
  `SELECT code, COUNT(*)::int c FROM valet_cards WHERE community_id = $1 GROUP BY code HAVING COUNT(*) > 1`,
  [communityId]
);
check('no code was registered twice', dupes.rows.length === 0, JSON.stringify(dupes.rows));

const guardTry = await api('/admin/cards', {
  method: 'POST', token, body: { prefix: 'B', from: 1, to: 1 },
});
check('a guard cannot register stock', guardTry.status === 403);

// A card belonging to a DIFFERENT venue, to prove scoping.
const other = await pool.query(
  `INSERT INTO communities (name, address, city) VALUES ('Other Venue','2 Rd','Bengaluru') RETURNING id`
);
const otherCommunityId = other.rows[0].id;
await pool.query(`INSERT INTO valet_cards (community_id, code) VALUES ($1,'A001')`, [otherCommunityId]);

const stayEnd = () => new Date(Date.now() + 864e5).toISOString();

console.log('\n--- binding a card at intake ---');
const t1 = await api('/guard/tickets', {
  method: 'POST', token,
  body: { plate: 'KA 05 MH 2847', vehicleMake: 'Honda City', stayEndAt: stayEnd(), cardCode: 'A001' },
});
check('creates a ticket with a card', t1.status === 201, JSON.stringify(t1.body));
check('returns the bound card code', t1.body?.cardCode === 'A001');
const tokenA = t1.body?.sessionToken;

const row = await pool.query(
  `SELECT card_code, card_id FROM valet_tickets WHERE session_token = $1`, [tokenA]
);
check('persists the card on the ticket', row.rows[0]?.card_code === 'A001' && !!row.rows[0]?.card_id);

console.log('\n--- a card cannot be on two open tickets ---');
const clash = await api('/guard/tickets', {
  method: 'POST', token,
  body: { plate: 'KA 01 AB 9012', vehicleMake: 'Innova', stayEndAt: stayEnd(), cardCode: 'A001' },
});
check('refuses the reused card', clash.status === 409 && clash.body?.error === 'card_in_use', JSON.stringify(clash.body));
check('names the ticket already holding it', String(clash.body?.message).includes('SRT-'), clash.body?.message);

const count = await pool.query('SELECT COUNT(*)::int AS c FROM valet_tickets WHERE community_id = $1', [communityId]);
check('the rejected ticket was rolled back, not left half-created', count.rows[0].c === 1, `rows=${count.rows[0].c}`);

console.log('\n--- card scoping and validation ---');
const unknown = await api('/guard/tickets', {
  method: 'POST', token,
  body: { plate: 'KA 09 XY 3355', vehicleMake: 'Creta', stayEndAt: stayEnd(), cardCode: 'ZZZZ' },
});
check('refuses a code no venue owns', unknown.status === 409 && unknown.body?.error === 'unknown_card');

const lower = await api('/guard/tickets', {
  method: 'POST', token,
  body: { plate: 'KA 07 CD 1111', vehicleMake: 'Swift', stayEndAt: stayEnd(), cardCode: 'a002' },
});
check('matches a card code case-insensitively', lower.status === 201 && lower.body?.cardCode === 'A002',
  JSON.stringify(lower.body));
const tokenB = lower.body?.sessionToken;

console.log('\n--- the guest side of a card ---');
const resolved = await fetch(`${BASE}/guest/cards/A001`).then((r) => r.json());
check('a bound card resolves to its ticket', resolved.sessionToken === tokenA);
check('and returns nothing else about the vehicle', Object.keys(resolved).join() === 'sessionToken',
  Object.keys(resolved).join());

const free = await fetch(`${BASE}/guest/cards/A003`);
const bogus = await fetch(`${BASE}/guest/cards/NOPE`);
const [freeBody, bogusBody] = [await free.text(), await bogus.text()];
check('an unbound card 404s', free.status === 404);
// Byte-identical, not merely both-404: a body that distinguished "this card
// exists but is free" from "no such card" would let someone enumerate a
// venue's card stock and learn how busy it is.
check('an unknown code is indistinguishable from a free one',
  bogus.status === free.status && bogusBody === freeBody, `${freeBody} vs ${bogusBody}`);

// The guest can drive their whole flow from the card alone.
const guestView = await api(`/guest/tickets/${resolved.sessionToken}`);
check('the card gets the guest to their live status', guestView.body?.plate === 'KA 05 MH 2847',
  JSON.stringify(guestView.body));
const requested = await api(`/guest/tickets/${resolved.sessionToken}/request`, { method: 'POST' });
check('and lets them request the car', requested.body?.status === 'requested');

console.log('\n--- closing a ticket frees its card ---');
// Drive it to a close without a pickup: the manual expire path.
await api(`/guard/tickets/${tokenA}/expire`, { method: 'POST', token });
const afterClose = await fetch(`${BASE}/guest/cards/A001`);
check('the card stops resolving once the ticket closes', afterClose.status === 404);

const reuse = await api('/guard/tickets', {
  method: 'POST', token,
  body: { plate: 'KA 22 ZZ 7777', vehicleMake: 'Baleno', stayEndAt: stayEnd(), cardCode: 'A001' },
});
check('the freed card can be handed to the next guest', reuse.status === 201 && reuse.body?.cardCode === 'A001',
  JSON.stringify(reuse.body));
check('and now resolves to the NEW ticket, not the old one',
  (await fetch(`${BASE}/guest/cards/A001`).then((r) => r.json())).sessionToken === reuse.body?.sessionToken);

console.log('\n--- binding a card after the fact ---');
const late = await api('/guard/tickets', {
  method: 'POST', token,
  body: { plate: 'KA 33 QQ 4444', vehicleMake: 'i20', stayEndAt: stayEnd() },
});
check('a ticket can start with no card at all', late.status === 201 && late.body?.cardCode === null);
const bound = await api(`/guard/tickets/${late.body.sessionToken}/card`, {
  method: 'POST', token, body: { cardCode: 'A003' },
});
check('and have one bound afterwards', bound.status === 200 && bound.body?.cardCode === 'A003',
  JSON.stringify(bound.body));
check('which then resolves for the guest',
  (await fetch(`${BASE}/guest/cards/A003`).then((r) => r.json())).sessionToken === late.body.sessionToken);

const doubleBind = await api(`/guard/tickets/${tokenB}/card`, {
  method: 'POST', token, body: { cardCode: 'A003' },
});
check('a card already in use cannot be bound to a second ticket', doubleBind.status === 409,
  JSON.stringify(doubleBind.body));

console.log('\n--- the database, not just the route, enforces one open ticket per card ---');
// The route checks before inserting, but two guards scanning the same card at
// the same instant would both pass that check. The partial unique index is
// what actually holds, so test it directly rather than trusting the route.
const cardRow = await pool.query(
  'SELECT id FROM valet_cards WHERE community_id = $1 AND code = $2', [communityId, 'A003']
);
let indexHeld = false;
try {
  await pool.query(
    `INSERT INTO valet_tickets
       (community_id, display_id, session_token, plate, plate_normalized, vehicle_make,
        status, stay_end_at, created_by_guard_id, card_id, card_code)
     VALUES ($1,'SRT-9999','tok-bypass','KA 99 ZZ 0001','KA99ZZ0001','Ghost',
             'parked', NOW() + INTERVAL '1 day', $2, $3, 'A003')`,
    [communityId, guardId, cardRow.rows[0].id]
  );
} catch (e) {
  indexHeld = e.code === '23505';
}
check('a direct insert bypassing the route is still rejected', indexHeld);

// The same thing through the front door, concurrently.
await api(`/guard/tickets/${late.body.sessionToken}/expire`, { method: 'POST', token });
const raced = await Promise.all([1, 2, 3].map(() =>
  api('/guard/tickets', {
    method: 'POST', token,
    body: { plate: 'KA 44 RC 000' + Math.random().toString().slice(2, 3),
            vehicleMake: 'Race', stayEndAt: stayEnd(), cardCode: 'A003' },
  })
));
const created = raced.filter((r) => r.status === 201);
check('exactly one of three simultaneous scans of a card wins',
  created.length === 1, `created=${created.length} statuses=${raced.map((r) => r.status).join()}`);
check('the losers get a clean 409, not a 500',
  raced.filter((r) => r.status === 409).length === 2, raced.map((r) => r.status).join());

// The three above were serialised by Node's event loop, so the pre-check
// caught them and the index never fired. Force the case a second service
// instance produces: hold a transaction that has already taken the card but
// not committed, so the request's pre-check reads "free" and only the index
// stops it.
const holder = await pool.connect();
const freeCard = await pool.query(
  'SELECT id FROM valet_cards WHERE community_id = $1 AND code = $2', [communityId, 'A002']
);
await pool.query(
  `UPDATE valet_tickets SET card_id = NULL, card_code = NULL WHERE card_id = $1`, [freeCard.rows[0].id]
);
await holder.query('BEGIN');
await holder.query(
  `INSERT INTO valet_tickets
     (community_id, display_id, session_token, plate, plate_normalized, vehicle_make,
      status, stay_end_at, created_by_guard_id, card_id, card_code)
   VALUES ($1,'SRT-9998','tok-holder','KA 98 ZZ 0002','KA98ZZ0002','Holder',
           'parked', NOW() + INTERVAL '1 day', $2, $3, 'A002')`,
  [communityId, guardId, freeCard.rows[0].id]
);
// Uncommitted, so the route's SELECT cannot see it — exactly the blind spot.
const blind = api('/guard/tickets', {
  method: 'POST', token,
  body: { plate: 'KA 55 BL 1234', vehicleMake: 'Blind', stayEndAt: stayEnd(), cardCode: 'A002' },
});
await new Promise((r) => setTimeout(r, 300));
await holder.query('COMMIT');
holder.release();
const blindRes = await blind;
check('a write that only the index can stop returns 409, not 500',
  blindRes.status === 409 && blindRes.body?.error === 'card_in_use',
  `${blindRes.status} ${JSON.stringify(blindRes.body)}`);
check('and still explains itself to the guard',
  typeof blindRes.body?.message === 'string' && blindRes.body.message.length > 0,
  JSON.stringify(blindRes.body));

console.log('\n--- plate search ---');
const s1 = await api('/guard/tickets/search?plate=KA07', { token });
check('finds a ticket by plate prefix', s1.body?.tickets?.length === 1 && s1.body.tickets[0].plate === 'KA 07 CD 1111',
  JSON.stringify(s1.body?.tickets?.map((t) => t.plate)));

const s2 = await api('/guard/tickets/search?plate=ka%2007%20cd', { token });
check('ignores spacing and case', s2.body?.tickets?.length === 1);

const s3 = await api('/guard/tickets/search?plate=KA', { token });
check('refuses a query too short to narrow anything', s3.body?.tickets?.length === 0);

const s4 = await api('/guard/tickets/search?plate=ZZ99', { token });
check('returns nothing for a plate that was never here', s4.body?.tickets?.length === 0);

const s5 = await api('/guard/tickets/search?plate=KA05', { token });
check('still finds a CLOSED ticket — the queue cannot', s5.body?.tickets?.length === 1,
  JSON.stringify(s5.body?.tickets?.map((t) => t.status)));

console.log('\n--- operator card stock view ---');
const stock = await api('/admin/cards', { token: admin });
const byCode = Object.fromEntries(stock.body.cards.map((c) => [c.code, c]));
check('lists every registered card', stock.body.cards.length === 4, String(stock.body.cards.length));
check('shows which vehicle a card is out with',
  byCode.A001?.inUseBy?.plate === 'KA 22 ZZ 7777', JSON.stringify(byCode.A001));
check('shows an unused card as free', byCode.A004?.inUseBy === null, JSON.stringify(byCode.A004));

const retireBusy = await api(`/admin/cards/${byCode.A001.id}/deactivate`, { method: 'POST', token: admin });
check('refuses to retire a card a guest is holding', retireBusy.status === 409, JSON.stringify(retireBusy.body));

const retire = await api(`/admin/cards/${byCode.A004.id}/deactivate`, { method: 'POST', token: admin });
check('retires a card that is back in the stack', retire.status === 200 && retire.body?.isActive === false);

const stillThere = await pool.query('SELECT is_active FROM valet_cards WHERE id = $1', [byCode.A004.id]);
check('retiring deactivates rather than deletes, keeping history',
  stillThere.rows.length === 1 && stillThere.rows[0].is_active === false);

const useRetired = await api('/guard/tickets', {
  method: 'POST', token,
  body: { plate: 'KA 66 RT 8888', vehicleMake: 'Retired', stayEndAt: stayEnd(), cardCode: 'A004' },
});
check('a retired card cannot be handed out', useRetired.status === 409 && useRetired.body?.error === 'unknown_card',
  JSON.stringify(useRetired.body));

await api(`/admin/cards/${byCode.A004.id}/activate`, { method: 'POST', token: admin });
const useRestored = await api('/guard/tickets', {
  method: 'POST', token,
  body: { plate: 'KA 66 RT 8888', vehicleMake: 'Restored', stayEndAt: stayEnd(), cardCode: 'A004' },
});
check('a restored card works again', useRestored.status === 201, JSON.stringify(useRestored.body));

console.log('\n--- operator plate search ---');
const a1 = await api('/admin/tickets/search?plate=2847', { token: admin });
check('finds a vehicle by the last four digits alone',
  a1.body?.tickets?.some((t) => t.plate === 'KA 05 MH 2847') === true,
  JSON.stringify(a1.body?.tickets?.map((t) => t.plate)));

const g1 = await api('/guard/tickets/search?plate=2847', { token });
check('the valet app search agrees with it',
  g1.body?.tickets?.some((t) => t.plate === 'KA 05 MH 2847') === true,
  JSON.stringify(g1.body?.tickets?.map((t) => t.plate)));

const a2 = await api('/admin/tickets/search?plate=KA05', { token: admin });
check('includes checked-out vehicles', a2.body?.tickets?.length === 1,
  JSON.stringify(a2.body?.tickets?.map((t) => t.status)));

const a3 = await api('/admin/tickets/search?plate=2847', { token });
check('a guard cannot use the operator search', a3.status === 403);

console.log('\n--- tenancy ---');
const otherGuard = jwt.sign(
  { sub: guardId, role: 'guard', community_id: otherCommunityId, name: 'Ramesh' }, SECRET
);
const crossSearch = await api('/guard/tickets/search?plate=KA05', { token: otherGuard });
check('another venue cannot search this venue\'s vehicles', crossSearch.body?.tickets?.length === 0);

// --- cleanup ----------------------------------------------------------------
for (const cid of [communityId, otherCommunityId]) {
  await pool.query('DELETE FROM valet_tickets WHERE community_id = $1', [cid]);
  await pool.query('DELETE FROM valet_cards WHERE community_id = $1', [cid]);
  await pool.query('DELETE FROM residents WHERE community_id = $1', [cid]);
  await pool.query('DELETE FROM units WHERE community_id = $1', [cid]);
  await pool.query('DELETE FROM blocks WHERE community_id = $1', [cid]);
  await pool.query('DELETE FROM communities WHERE id = $1', [cid]);
}
await pool.end();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
