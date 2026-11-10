import fs from 'node:fs/promises';
import path from 'node:path';
import { buildManifest, liveSkip, sha256 } from './manifest.js';
import { validateManifest, isProtected, PromoteError } from './policy.js';

/**
 * Promote = make the live website match staging. Order matters, and is the
 * point: validate everything, download everything, verify every checksum --
 * and only then back up live and change it. Any failure before the backup
 * leaves dwaarai.com exactly as it was.
 */

export const KEEP_BACKUPS = 10;
const BACKUP_NAME = /^\d{8}-\d{6}$/;

// 2026-11-09T10:00:00.000Z -> 20261109-100000
const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

const authHeader = (s) => 'Basic ' + Buffer.from(`${s.user}:${s.pass}`).toString('base64');

async function fromStaging(staging, rel, fetchImpl) {
  const r = await fetchImpl(`${staging.base}${rel}`, { headers: { Authorization: authHeader(staging) }, redirect: 'error' });
  if (!r.ok) throw new PromoteError(`Staging answered ${r.status} for ${rel}`);
  return r;
}

export function diff(target, current) {
  const have = new Map(current.map((f) => [f.path, f.sha256]));
  const want = new Set(target.map((f) => f.path));
  return {
    changed: target.filter((f) => have.get(f.path) !== f.sha256),
    removed: current.filter((f) => !want.has(f.path)).map((f) => f.path),
  };
}

function inside(root, rel) {
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new PromoteError(`Refusing to write outside the site: ${rel}`);
  return full;
}

const isLink = (p) => fs.lstat(p).then((s) => s.isSymbolicLink(), () => false);

// Refuse to write or delete through a symlink anywhere on the path: mkdir,
// copyFile and rename would otherwise follow it out of the live folder.
async function assertNoLinks(live, rels) {
  for (const rel of rels) {
    const parts = rel.split('/');
    let cur = live;
    for (const seg of parts.slice(0, -1)) {
      cur = path.join(cur, seg);
      if (await isLink(cur)) throw new PromoteError(`Refusing to write through a symlink: ${rel}`);
    }
    if (await isLink(path.join(live, rel))) throw new PromoteError(`Refusing to touch a symlink: ${rel}`);
  }
}

async function applyChanges(live, copies, removals) {
  await assertNoLinks(live, [...copies.map((c) => c.path), ...removals]);
  const tmps = [];
  try {
    for (const { path: rel, from } of copies) {
      const dest = inside(live, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      // Copy beside, then rename: a visitor gets the old page or the new one,
      // never half of one.
      const tmp = `${dest}.promote-tmp`;
      tmps.push(tmp);
      // rm does not follow a symlink at the final component, so a planted
      // link at the tmp name is removed rather than written through; EXCL
      // makes the copy refuse if anything appears there in the meantime.
      await fs.rm(tmp, { force: true });
      await fs.copyFile(from, tmp, fs.constants.COPYFILE_EXCL);
      await fs.rename(tmp, dest);
    }
  } catch (e) {
    for (const tmp of tmps) await fs.rm(tmp, { force: true });
    throw e;
  }
  for (const rel of removals) {
    await fs.rm(inside(live, rel), { force: true });
    let dir = path.dirname(rel);
    while (dir && dir !== '.' && !isProtected(`${dir}/`)) {
      try { await fs.rmdir(path.join(live, dir)); } catch { break; } // not empty: stop
      dir = path.dirname(dir);
    }
  }
}

// Make live match a backup again. Same diff rules as a rollback: protected and
// dot paths are never in either manifest, so they are never touched.
async function restoreFrom(cfg, stamp) {
  const src = path.join(cfg.backups, stamp);
  const target = await buildManifest(src, { skip: liveSkip });
  const current = await buildManifest(cfg.live, { skip: liveSkip });
  const { changed, removed } = diff(target, current);
  await applyChanges(cfg.live, changed.map((f) => ({ path: f.path, from: path.join(src, f.path) })), removed);
}

// Apply changes; if that fails part-way, put live back from the backup taken
// just before, and say which backup holds the pre-change site.
async function applyOrRestore(cfg, backup, copies, removed) {
  try {
    await applyChanges(cfg.live, copies, removed);
  } catch (e) {
    e.backup = backup;
    try {
      await restoreFrom(cfg, backup);
    } catch (re) {
      e.details = [...(e.details || []), `Automatic restore failed: ${re.message}`];
    }
    throw e;
  }
}

// A backup is built in a partial- folder (never BACKUP_NAME-shaped) and only
// renamed into place once every file is copied.
async function backupLive(cfg, liveFiles, stamp) {
  const final = path.join(cfg.backups, stamp);
  if (await fs.access(final).then(() => true, () => false)) {
    throw new PromoteError('Another backup was made this second; try again');
  }
  const partial = path.join(cfg.backups, `partial-${stamp}`);
  try {
    await fs.rm(partial, { recursive: true, force: true });
    await fs.mkdir(partial, { recursive: true });
    for (const f of liveFiles) {
      const d = path.join(partial, f.path);
      await fs.mkdir(path.dirname(d), { recursive: true });
      await fs.copyFile(path.join(cfg.live, f.path), d);
    }
    await fs.rename(partial, final);
  } catch (e) {
    await fs.rm(partial, { recursive: true, force: true });
    throw e;
  }
  return stamp;
}

export async function listBackups(dir) {
  try {
    return (await fs.readdir(dir)).filter((n) => BACKUP_NAME.test(n)).sort().reverse();
  } catch {
    return [];
  }
}

async function pruneBackups(dir) {
  for (const n of (await listBackups(dir)).slice(KEEP_BACKUPS)) {
    await fs.rm(path.join(dir, n), { recursive: true, force: true });
  }
}

async function appendLog(file, entry) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(entry) + '\n');
}

export async function readLog(file, n = 20) {
  try {
    const out = [];
    for (const l of (await fs.readFile(file, 'utf8')).split('\n')) {
      if (!l.trim()) continue;
      try { out.push(JSON.parse(l)); } catch { /* a torn line must not hide the rest */ }
    }
    return out.slice(-n).reverse();
  } catch {
    return [];
  }
}

async function logged(cfg, kind, now, fn) {
  const entry = { at: now.toISOString(), kind, by: cfg.by || 'unknown' };
  try {
    const result = await fn();
    await appendLog(cfg.logFile, { ...entry, ok: true, ...result });
    return result;
  } catch (e) {
    await appendLog(cfg.logFile, { ...entry, ok: false, error: e.message, details: e.details || [], ...(e.backup ? { backup: e.backup } : {}) });
    throw e;
  }
}

export function promote(cfg, { fetchImpl = fetch, now = new Date() } = {}) {
  return logged(cfg, 'promote', now, async () => {
    const stamp = stampOf(now);
    let files;
    try {
      ({ files } = await (await fromStaging(cfg.staging, '/_staging/manifest.php', fetchImpl)).json());
    } catch (e) {
      if (e instanceof PromoteError) throw e;
      throw new PromoteError('Staging sent an unreadable file list');
    }
    const v = validateManifest(files);
    if (!v.ok) throw new PromoteError('Staging has files the live site cannot take', v.errors);

    const liveFiles = await buildManifest(cfg.live, { skip: liveSkip });
    const { changed, removed } = diff(files, liveFiles);
    if (!changed.length && !removed.length) return { changed: 0, removed: 0, backup: null };
    await assertNoLinks(cfg.live, [...changed.map((f) => f.path), ...removed]);

    // Not BACKUP_NAME-shaped, so never listed, restored or pruned as a backup.
    const incoming = path.join(cfg.backups, `incoming-${stamp}`);
    try {
      const copies = [];
      for (const f of changed) {
        const res = await fromStaging(cfg.staging, `/_staging/file.php?p=${encodeURIComponent(f.path)}`, fetchImpl);
        const buf = Buffer.from(await res.arrayBuffer());
        if (sha256(buf) !== f.sha256) throw new PromoteError(`${f.path} changed on staging while promoting. Try again.`);
        const dest = inside(incoming, f.path);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, buf);
        copies.push({ path: f.path, from: dest });
      }
      const backup = await backupLive(cfg, liveFiles, stamp);
      await applyOrRestore(cfg, backup, copies, removed);
      await pruneBackups(cfg.backups);
      return {
        changed: changed.length, removed: removed.length, backup,
        paths: [...changed.map((f) => f.path), ...removed].slice(0, 200),
      };
    } finally {
      await fs.rm(incoming, { recursive: true, force: true });
    }
  });
}

export function rollback(cfg, { now = new Date() } = {}) {
  return logged(cfg, 'rollback', now, async () => {
    if (!BACKUP_NAME.test(cfg.backup || '') || !(await listBackups(cfg.backups)).includes(cfg.backup)) {
      throw new PromoteError(`No backup called ${cfg.backup}`);
    }
    const src = path.join(cfg.backups, cfg.backup);
    const target = await buildManifest(src, { skip: liveSkip });
    const liveFiles = await buildManifest(cfg.live, { skip: liveSkip });
    const { changed, removed } = diff(target, liveFiles);
    await assertNoLinks(cfg.live, [...changed.map((f) => f.path), ...removed]);
    // Back up first, so a rollback can itself be rolled back.
    const backup = await backupLive(cfg, liveFiles, stampOf(now));
    await applyOrRestore(cfg, backup, changed.map((f) => ({ path: f.path, from: path.join(src, f.path) })), removed);
    await pruneBackups(cfg.backups);
    return { restored: cfg.backup, changed: changed.length, removed: removed.length, backup };
  });
}
