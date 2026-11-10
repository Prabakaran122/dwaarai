import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createServer } from './server.js';
import { signHeader } from './sign.js';
import { sha256 } from './manifest.js';

const SECRET = 'srv-secret';

async function start(fetchImpl) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-srv-'));
  const live = path.join(base, 'landing');
  await fs.mkdir(live);
  await fs.writeFile(path.join(live, 'index.html'), 'old');
  const cfg = {
    secret: SECRET, live, backups: path.join(base, 'b'), logFile: path.join(base, 'l.jsonl'),
    staging: { base: 'https://staging.test', user: 'promoter', pass: 'pw' },
  };
  const server = createServer(cfg, { fetchImpl });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  const call = (method, p, body = '', sign = true) => fetch(url + p, {
    method, body: body || undefined,
    headers: sign ? { 'X-Site-Signature': signHeader(SECRET, method, p, body) } : {},
  });
  return { server, call, live, port, url };
}

function staging(files, gate) {
  const manifest = Object.entries(files).map(([p, c]) => ({ path: p, sha256: sha256(Buffer.from(c)), size: c.length }));
  return async (url) => {
    await gate;
    const u = new URL(url);
    if (u.pathname === '/_staging/manifest.php') return Response.json({ files: manifest });
    return new Response(files[u.searchParams.get('p')]);
  };
}

async function untilIdle(call) {
  for (let i = 0; i < 100; i++) {
    const s = await (await call('GET', '/_site/status')).json();
    if (!s.running) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('still running');
}

test('refuses unsigned requests', async (t) => {
  const { server, call } = await start(staging({ 'index.html': 'x' }));
  t.after(() => server.close());
  assert.equal((await call('GET', '/_site/manifest', '', false)).status, 401);
  assert.equal((await call('POST', '/_site/promote', '{}', false)).status, 401);
});

test('a tampered signature is refused', async (t) => {
  const { server, url } = await start(staging({}));
  t.after(() => server.close());
  const good = signHeader(SECRET, 'GET', '/_site/status');
  const bad = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
  const res = await fetch(url + '/_site/status', { headers: { 'X-Site-Signature': bad } });
  assert.equal(res.status, 401);
});

test('a stale signature is refused', async (t) => {
  const { server, url } = await start(staging({}));
  t.after(() => server.close());
  const stale = signHeader(SECRET, 'GET', '/_site/status', '', Date.now() - 400_000);
  const res = await fetch(url + '/_site/status', { headers: { 'X-Site-Signature': stale } });
  assert.equal(res.status, 401);
});

test('an unknown path is 404 once signed', async (t) => {
  const { server, call } = await start(staging({}));
  t.after(() => server.close());
  assert.equal((await call('GET', '/_site/nope')).status, 404);
});

test('reports the live manifest', async (t) => {
  const { server, call } = await start(staging({}));
  t.after(() => server.close());
  const body = await (await call('GET', '/_site/manifest')).json();
  assert.deepEqual(body.files.map((f) => f.path), ['index.html']);
});

test('runs one promote at a time in the background and records who', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { server, call, live } = await start(staging({ 'index.html': 'new' }, gate));
  t.after(() => server.close());

  assert.equal((await call('POST', '/_site/promote', '{"by":"asha"}')).status, 202);
  assert.equal((await call('POST', '/_site/promote', '{"by":"ravi"}')).status, 409);
  release();
  const s = await untilIdle(call);

  assert.equal(await fs.readFile(path.join(live, 'index.html'), 'utf8'), 'new');
  assert.deepEqual([s.log[0].kind, s.log[0].ok, s.log[0].by], ['promote', true, 'asha']);
  assert.equal(s.backups.length, 1);
});

test('the lock is released after a failing promote, and the failure is logged', async (t) => {
  const { server, call } = await start(async () => { throw new Error('staging down'); });
  t.after(() => server.close());

  assert.equal((await call('POST', '/_site/promote', '{"by":"asha"}')).status, 202);
  const s = await untilIdle(call);
  assert.deepEqual([s.log[0].kind, s.log[0].ok, s.log[0].by], ['promote', false, 'asha']);

  assert.equal((await call('POST', '/_site/promote', '{"by":"ravi"}')).status, 202);
  await untilIdle(call);
});

test('rollback needs a well-formed backup name', async (t) => {
  const { server, call } = await start(staging({}));
  t.after(() => server.close());
  assert.equal((await call('POST', '/_site/rollback', '{"by":"a","backup":"../../etc"}')).status, 400);
});

test('rollback backup must be a string', async (t) => {
  const { server, call } = await start(staging({}));
  t.after(() => server.close());
  const res = await call('POST', '/_site/rollback', '{"by":"a","backup":["20260101-010101"]}');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad_backup');
});

test('a JSON body that is not an object is bad_json', async (t) => {
  const { server, call } = await start(staging({}));
  t.after(() => server.close());
  const res = await call('POST', '/_site/promote', 'null');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad_json');
});

test('invalid requests are refused before the busy check', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { server, call } = await start(staging({ 'index.html': 'new' }, gate));
  t.after(() => server.close());

  assert.equal((await call('POST', '/_site/promote', '{"by":"asha"}')).status, 202);
  assert.equal((await call('POST', '/_site/rollback', '{"by":"ravi","backup":["x"]}')).status, 400);
  release();
  await untilIdle(call);
});

test('a signed body over 10 KB is refused with 413', async (t) => {
  const { server, call } = await start(staging({}));
  t.after(() => server.close());
  const big = JSON.stringify({ by: 'x'.repeat(20_000) });
  assert.equal((await call('POST', '/_site/promote', big)).status, 413);
});

test('an oversized body with no Content-Length is refused with 413', async (t) => {
  const { server, url } = await start(staging({}));
  t.after(() => server.close());
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(Buffer.alloc(6000, 'a'));
      c.enqueue(Buffer.alloc(6000, 'a'));
      c.close();
    },
  });
  const res = await fetch(url + '/_site/promote', {
    method: 'POST', body: stream, duplex: 'half',
    headers: { 'X-Site-Signature': signHeader(SECRET, 'POST', '/_site/promote', '') },
  });
  assert.equal(res.status, 413);
});

test('a client that drops mid-body does not take the server down', async (t) => {
  const { server, call, port } = await start(staging({}));
  t.after(() => server.close());
  await new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write('POST /_site/promote HTTP/1.1\r\nHost: t\r\nContent-Length: 1000\r\n'
        + 'Content-Type: application/json\r\n\r\n{"by":"a"');
      setTimeout(() => sock.destroy(), 50);
    });
    sock.on('error', () => {});
    sock.on('close', resolve);
  });
  assert.equal((await call('GET', '/_site/status')).status, 200);
});
