import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promote, rollback, listBackups, readLog, KEEP_BACKUPS } from './promote.js';
import { sha256 } from './manifest.js';

const AUTH = 'Basic ' + Buffer.from('promoter:pw').toString('base64');

async function setup(liveFiles) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-pr-'));
  const live = path.join(base, 'landing');
  for (const [rel, body] of Object.entries(liveFiles)) {
    await fs.mkdir(path.dirname(path.join(live, rel)), { recursive: true });
    await fs.writeFile(path.join(live, rel), body);
  }
  return {
    live, backups: path.join(base, 'backups'), logFile: path.join(base, 'log', 'p.jsonl'),
    staging: { base: 'https://staging.test', user: 'promoter', pass: 'pw' }, by: 'asha',
  };
}

function fakeStaging(files, { lie = null } = {}) {
  const manifest = Object.entries(files).map(([p, c]) => ({ path: p, sha256: sha256(Buffer.from(c)), size: Buffer.byteLength(c) }));
  const fetched = [];
  const fetchImpl = async (url, opts) => {
    if (opts.headers.Authorization !== AUTH) return new Response('', { status: 401 });
    const u = new URL(url);
    if (u.pathname === '/_staging/manifest.php') return Response.json({ files: manifest });
    if (u.pathname === '/_staging/file.php') {
      const p = u.searchParams.get('p');
      fetched.push(p);
      if (p === lie) return new Response('tampered');
      return Object.hasOwn(files, p) ? new Response(files[p]) : new Response('', { status: 404 });
    }
    return new Response('', { status: 404 });
  };
  return { fetchImpl, fetched };
}

const read = (cfg, rel) => fs.readFile(path.join(cfg.live, rel), 'utf8');
const exists = (p) => fs.access(p).then(() => true, () => false);
const NOW = new Date('2026-11-09T10:00:00Z');

test('copies changed files, deletes removed ones, downloads only what changed', async () => {
  const cfg = await setup({ 'index.html': 'old home', 'about.html': 'same', 'gone.html': 'bye' });
  const { fetchImpl, fetched } = fakeStaging({ 'index.html': 'new home', 'about.html': 'same', 'blog/new.html': 'hi' });

  const r = await promote(cfg, { fetchImpl, now: NOW });

  assert.deepEqual({ changed: r.changed, removed: r.removed, backup: r.backup }, { changed: 2, removed: 1, backup: '20261109-100000' });
  assert.deepEqual(fetched.sort(), ['blog/new.html', 'index.html']);
  assert.equal(await read(cfg, 'index.html'), 'new home');
  assert.equal(await read(cfg, 'blog/new.html'), 'hi');
  assert.equal(await exists(path.join(cfg.live, 'gone.html')), false);
  assert.equal(await fs.readFile(path.join(cfg.backups, '20261109-100000', 'index.html'), 'utf8'), 'old home');
});

test('never touches the APK, its install page, build scripts or dotfiles', async () => {
  const cfg = await setup({
    'index.html': 'old', 'apps/dwaarai-valet.apk': 'APK', 'install.html': 'install',
    'scripts/build.py': 'py', '.well-known/a.txt': 'acme',
  });
  const { fetchImpl } = fakeStaging({ 'index.html': 'new' });

  await promote(cfg, { fetchImpl, now: NOW });

  assert.equal(await read(cfg, 'apps/dwaarai-valet.apk'), 'APK');
  assert.equal(await read(cfg, 'install.html'), 'install');
  assert.equal(await read(cfg, 'scripts/build.py'), 'py');
  assert.equal(await read(cfg, '.well-known/a.txt'), 'acme');
});

test('refuses a bad staging site before touching anything, and says why', async () => {
  const cfg = await setup({ 'index.html': 'old' });
  const { fetchImpl, fetched } = fakeStaging({ 'index.html': 'new', 'apps/evil.apk': 'x', 'shell.php': '<?php' });

  await assert.rejects(promote(cfg, { fetchImpl, now: NOW }), /cannot take/);

  assert.deepEqual(fetched, []);
  assert.equal(await read(cfg, 'index.html'), 'old');
  assert.deepEqual(await listBackups(cfg.backups), []);
  const [entry] = await readLog(cfg.logFile);
  assert.equal(entry.ok, false);
  assert.deepEqual(entry.details, ['apps/evil.apk: managed by the app deploy, not the website', 'shell.php: .php files are not allowed']);
});

test('a file that changes mid-download aborts with live untouched and no backup', async () => {
  const cfg = await setup({ 'index.html': 'old', 'a.html': 'a' });
  const { fetchImpl } = fakeStaging({ 'index.html': 'new', 'a.html': 'a2' }, { lie: 'index.html' });

  await assert.rejects(promote(cfg, { fetchImpl, now: NOW }), /changed on staging/);

  assert.equal(await read(cfg, 'index.html'), 'old');
  assert.equal(await read(cfg, 'a.html'), 'a');
  assert.deepEqual(await listBackups(cfg.backups), []);
  // The download folder is gone too (the backups folder may never have been created).
  assert.deepEqual(await fs.readdir(cfg.backups).catch(() => []), []);
});

test('nothing to do makes no backup', async () => {
  const cfg = await setup({ 'index.html': 'same' });
  const { fetchImpl } = fakeStaging({ 'index.html': 'same' });
  const r = await promote(cfg, { fetchImpl, now: NOW });
  assert.deepEqual(r, { changed: 0, removed: 0, backup: null });
});

test('rollback restores a backup and is itself undoable', async () => {
  const cfg = await setup({ 'index.html': 'v1', 'old.html': 'o' });
  await promote(cfg, { fetchImpl: fakeStaging({ 'index.html': 'v2' }).fetchImpl, now: NOW });

  const r = await rollback({ ...cfg, backup: '20261109-100000' }, { now: new Date('2026-11-09T11:00:00Z') });

  assert.equal(r.backup, '20261109-110000');
  assert.equal(await read(cfg, 'index.html'), 'v1');
  assert.equal(await read(cfg, 'old.html'), 'o');
  assert.equal(await fs.readFile(path.join(cfg.backups, '20261109-110000', 'index.html'), 'utf8'), 'v2');
  const log = await readLog(cfg.logFile);
  assert.deepEqual(log.map((e) => [e.kind, e.ok, e.by]), [['rollback', true, 'asha'], ['promote', true, 'asha']]);
});

test('rollback to a backup that does not exist is refused', async () => {
  const cfg = await setup({ 'index.html': 'v1' });
  await assert.rejects(rollback({ ...cfg, backup: '20200101-000000' }), /No backup called/);
});

test(`keeps the newest ${KEEP_BACKUPS} backups`, async () => {
  const cfg = await setup({ 'index.html': 'v0' });
  for (let i = 1; i <= KEEP_BACKUPS + 2; i++) {
    const { fetchImpl } = fakeStaging({ 'index.html': `v${i}` });
    await promote(cfg, { fetchImpl, now: new Date(Date.UTC(2026, 10, 9, 10, 0, i)) });
  }
  const kept = await listBackups(cfg.backups);
  assert.equal(kept.length, KEEP_BACKUPS);
  assert.equal(kept[0], '20261109-100012');
});

test('a second backup in the same second is refused before live is touched', async () => {
  const cfg = await setup({ 'index.html': 'v1' });
  await promote(cfg, { fetchImpl: fakeStaging({ 'index.html': 'v2' }).fetchImpl, now: NOW });

  await assert.rejects(rollback({ ...cfg, backup: '20261109-100000' }, { now: NOW }), /Another backup was made this second/);

  assert.equal(await read(cfg, 'index.html'), 'v2');
  assert.equal(await fs.readFile(path.join(cfg.backups, '20261109-100000', 'index.html'), 'utf8'), 'v1');
});

test('refuses to write through a symlink in the live folder', async () => {
  const cfg = await setup({ 'index.html': 'old' });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-out-'));
  await fs.symlink(outside, path.join(cfg.live, 'blog'));
  const { fetchImpl } = fakeStaging({ 'index.html': 'new', 'blog/x.html': 'hi' });

  await assert.rejects(promote(cfg, { fetchImpl, now: NOW }), /symlink/);

  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(await read(cfg, 'index.html'), 'old');
});

test('a failure after the backup restores live and records which backup holds the old site', async () => {
  const cfg = await setup({ 'index.html': 'old', 'x.html': 'file' });
  // index.html is copied first; then x.html/y.html cannot be written because x.html is a file.
  const { fetchImpl } = fakeStaging({ 'index.html': 'new', 'x.html/y.html': 'y' });

  await assert.rejects(promote(cfg, { fetchImpl, now: NOW }), (e) => e.backup === '20261109-100000');

  assert.equal(await read(cfg, 'index.html'), 'old');
  assert.equal(await read(cfg, 'x.html'), 'file');
  const [entry] = await readLog(cfg.logFile);
  assert.equal(entry.ok, false);
  assert.equal(entry.backup, '20261109-100000');
});

test('a backup whose copy fails leaves no backup folder and live untouched', async () => {
  const cfg = await setup({ 'index.html': 'old' });
  const { fetchImpl } = fakeStaging({ 'index.html': 'new' });
  const realCopy = fs.copyFile;
  mock.method(fs, 'copyFile', async (src, dest, ...rest) => {
    if (String(dest).includes('partial-')) throw new Error('disk full');
    return realCopy(src, dest, ...rest);
  });
  try {
    await assert.rejects(promote(cfg, { fetchImpl, now: NOW }), /disk full/);
  } finally {
    mock.restoreAll();
  }

  assert.equal(await read(cfg, 'index.html'), 'old');
  assert.deepEqual(await listBackups(cfg.backups), []);
  assert.deepEqual(await fs.readdir(cfg.backups), []);
});

test('a planted symlink at the promote temp name is never written through', async () => {
  const cfg = await setup({ 'index.html': 'old' });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-pwn-'));
  await fs.symlink(path.join(outside, 'pwn.txt'), path.join(cfg.live, 'index.html.promote-tmp'));
  const { fetchImpl } = fakeStaging({ 'index.html': 'new' });

  await promote(cfg, { fetchImpl, now: NOW });

  assert.equal(await exists(path.join(outside, 'pwn.txt')), false);
  const st = await fs.lstat(path.join(cfg.live, 'index.html'));
  assert.equal(st.isSymbolicLink(), false);
  assert.equal(await read(cfg, 'index.html'), 'new');
});

test('live files staging could never hold are left alone and not counted as removed', async () => {
  const cfg = await setup({ 'index.html': 'old', 'old.zip': 'Z', 'My File#1.html': 'odd', 'noext': 'n' });
  const { fetchImpl } = fakeStaging({ 'index.html': 'new' });

  const r = await promote(cfg, { fetchImpl, now: NOW });

  assert.equal(r.removed, 0);
  assert.equal(await read(cfg, 'old.zip'), 'Z');
  assert.equal(await read(cfg, 'My File#1.html'), 'odd');
  assert.equal(await read(cfg, 'noext'), 'n');
  assert.equal(await read(cfg, 'index.html'), 'new');
});

test('readLog skips a torn line and still returns the others', async () => {
  const cfg = await setup({ 'index.html': 'x' });
  await fs.mkdir(path.dirname(cfg.logFile), { recursive: true });
  await fs.writeFile(cfg.logFile, '{"n":1}\n{"n":2, tor\n{"n":3}\n');
  assert.deepEqual((await readLog(cfg.logFile)).map((e) => e.n), [3, 1]);
});

test('a staging manifest that is not JSON is reported plainly', async () => {
  const cfg = await setup({ 'index.html': 'old' });
  const fetchImpl = async () => new Response('<html>oops</html>');
  await assert.rejects(promote(cfg, { fetchImpl, now: NOW }), { message: 'Staging sent an unreadable file list' });
});
