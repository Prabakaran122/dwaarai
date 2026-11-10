# Website Staging and Promote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The marketing team edits the dwaarai.com marketing site on a password-protected staging copy at `staging.dwaarai.com` (BigRock cPanel), and a **Promote to live** button copies it onto the AWS server that serves dwaarai.com, with a backup and a one-click rollback, without anyone needing git or AWS access.

**Architecture:** Staging is plain files in a cPanel subdomain plus three small PHP endpoints. Promotion is *pulled*, not pushed: the cPanel Promote page sends a signed request to a new localhost-only Node service on the EC2 box (`site-promoter`, behind nginx at `/_site/`), which fetches staging's file list, validates every path, downloads only the changed files, verifies each checksum, backs up the live folder, and then applies the changes. BigRock never holds AWS credentials; a stolen staging password can at most promote what is already on staging.

**Tech Stack:** Node 24 standard library only (no npm dependencies) with `node:test` (not vitest like the other services: the box installs nothing from npm for this service, and `pnpm -r run test` still runs it through its `test` script); PHP 8.1+ on cPanel (curl, hash); Apache `.htaccess`; nginx; systemd. PHP is tested locally with `@php-wasm/cli@3.1.60` (no PHP on this Mac).

**Spec:** The design agreed in the 2026-11-09 conversation, summarised under "Design" below. There is no separate spec file.

## Global Constraints

- Live site folder on EC2: `/opt/communitygate/landing` (nginx `root` of the `server_name dwaarai.com;` block in `/etc/nginx/conf.d/communitygate.conf`).
- **Never touched by a promote or rollback** (owned by other deploys): `apps/` (APK, written by `deploy/publish-valet-apk.sh`), `install.html` (same script), `scripts/` (page build scripts). Also any dotfile or dot-directory.
- **Staging-only, never promoted:** `_staging/`, `promote/`, `cgi-bin/`, every dotfile (`.htaccess`, `.well-known/`, …).
- Allowed file types on promote: `html htm css js mjs json txt xml webmanifest ico png jpg jpeg gif webp svg avif woff woff2 ttf otf eot pdf mp4 webm mp3 csv md`. Anything else refuses the whole promote with the file named.
- Limits: 5,000 files, 50 MB per file, 500 MB total, `index.html` required.
- Signature header `X-Site-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<METHOD>.<path>.<body>")>`, accepted within 300 s. Shared vector: secret `test-secret`, t `1700000000`, `POST`, `/_site/promote`, body `{"by":"asha"}` → `069ff57a44f13ebbce58104ce4adbe2161b6d1e64c965358f78cfa9f09234c57`.
- site-promoter listens on `127.0.0.1:3011` only. Backups in `/opt/communitygate/landing-backups/<YYYYMMDD-HHMMSS>/`, newest 10 kept. Log at `/var/lib/site-promoter/promotions.jsonl`.
- Secrets (`SITE_PROMOTE_SECRET`, the staging `promoter` password) are created and pasted **by the user**; Claude never generates, types or prints them.
- No change to valet-service, api-gateway, admin-portal, the leadmailer or any existing nginx location.
- Commit only when the user says so (repo rule). Commit steps below are staged, not run, until then.

## Design

| Piece | Where | Job |
|---|---|---|
| Staging site | BigRock cPanel, docroot `/home/<cpanel user>/staging.dwaarai.com` (outside `public_html`) | Marketing edits files with File Manager. Whole site behind cPanel Directory Privacy (Basic auth). `noindex` header, staging `robots.txt`. |
| `_staging/lib.php` | staging | Config, signing, path rules, manifest builder, signed calls to dwaarai.com. |
| `_staging/manifest.php` | staging | JSON list of every promotable file with SHA-256 and size. |
| `_staging/file.php?p=` | staging | Raw bytes of one file. Exists so `.htaccess` redirects (e.g. `/index.html` → `/`) never interfere with downloads. |
| `_staging/lead.php` | staging | `/lead` on staging: relays the form to `https://dwaarai.com/lead` with the subject prefixed `[STAGING] `. |
| `promote/index.php` | staging, own Directory Privacy (approvers only) | Shows what would change, Promote button, Rollback buttons, recent history. |
| `site-promoter` | EC2, `services/site-promoter`, systemd `dwaarai-site-promoter` | Signed API: `GET /_site/manifest`, `GET /_site/status`, `POST /_site/promote`, `POST /_site/rollback`. Jobs run in the background; one at a time. |
| nginx | EC2 | One new `location ^~ /_site/` → `127.0.0.1:3011`, inserted before `location ^~ /admin`. |

Zoho: Zoho Forms embeds post straight from the visitor's browser to Zoho, so they work on staging unchanged. Staging test submissions are identified by a hidden **Referrer URL** field added in Zoho Forms (Task 8), which records `staging.dwaarai.com`. GA4 is told to ignore the staging hostname (Task 8).

---

## File Structure

```
services/site-promoter/
  package.json
  src/policy.js          path rules, limits, manifest validation, PromoteError
  src/manifest.js        sha256, buildManifest(dir), liveSkip
  src/sign.js            signHeader / verifyHeader
  src/promote.js         diff, applyChanges, promote, rollback, backups, log
  src/server.js          HTTP API
  src/index.js           env → config → listen
  src/*.test.js          node:test suites
deploy/site-staging/      (uploaded to cPanel; never shipped to EC2)
  .htaccess
  _staging/lib.php  manifest.php  file.php  lead.php  robots.txt
  promote/index.php
  tests/run.php           PHP checks, run under @php-wasm/cli
deploy/deploy-site-promoter.sh   on-box installer (systemd + nginx), idempotent
deploy/ship-site-promoter.sh     laptop wrapper: pack, upload, run installer
deploy/site-staging/pull-live.sh laptop: download the live site as a tarball to seed staging
deploy/site-staging/check-routes.sh  compares status/Location of key URLs on live vs staging
```

---

### Task 1: Path policy and manifest validation

**Files:**
- Create: `services/site-promoter/package.json`
- Create: `services/site-promoter/src/policy.js`
- Test: `services/site-promoter/src/policy.test.js`

**Interfaces:**
- Produces: `PROTECTED: string[]`, `STAGING_ONLY: string[]`, `ALLOWED_EXT: Set<string>`, `LIMITS`, `isProtected(rel: string): boolean`, `checkPath(p: string): string|null` (null = ok, else reason), `validateManifest(files): {ok: boolean, errors: string[]}`, `class PromoteError extends Error { details: string[] }`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "site-promoter",
  "private": true,
  "type": "module",
  "description": "Promotes the staging marketing site onto dwaarai.com",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test \"src/**/*.test.js\""
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Write the failing test**

`services/site-promoter/src/policy.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPath, isProtected, validateManifest } from './policy.js';

const H = 'a'.repeat(64);
const f = (path, size = 10) => ({ path, sha256: H, size });

test('accepts ordinary site paths, including the spaces the live site already uses', () => {
  for (const p of ['index.html', 'careers/index.html', 'Generated Image July 08, 2026 - 12_49PM.jpg', 'data/jobs.json', 'favicon.ico']) {
    assert.equal(checkPath(p), null, p);
  }
});

test('refuses anything that could escape the folder or is not a web file', () => {
  const bad = {
    '../etc/passwd.html': 'not a clean path',
    '/index.html': 'not a relative path',
    'a\\b.html': 'not a relative path',
    'a//b.html': 'not a clean path',
    '.htaccess': 'hidden file',
    'blog/.git/config.txt': 'hidden file',
    'shell.php': '.php files are not allowed',
    'Makefile': '.(none) files are not allowed',
    '_staging/lib.php': 'staging-only file',
    'promote/index.php': 'staging-only file',
    'naïve.html': 'unusual characters in the name',
  };
  for (const [p, why] of Object.entries(bad)) assert.equal(checkPath(p), why, p);
});

test('knows which live paths belong to other deploys', () => {
  assert.equal(isProtected('apps/'), true);
  assert.equal(isProtected('apps/dwaarai-valet.apk'), true);
  assert.equal(isProtected('install.html'), true);
  assert.equal(isProtected('scripts/build_valet_page.py'), true);
  assert.equal(isProtected('apps-guide.html'), false);
  assert.equal(isProtected('index.html'), false);
});

test('a valid manifest passes', () => {
  assert.deepEqual(validateManifest([f('index.html'), f('about.html')]), { ok: true, errors: [] });
});

test('a manifest is refused, with every reason, when anything is wrong', () => {
  const r = validateManifest([
    f('about.html'),
    f('apps/evil.apk'),
    f('x.php'),
    f('about.html'),
    { path: 'big.mp4', sha256: H, size: 51 * 1024 * 1024 },
    { path: 'nosum.html', sha256: 'zz', size: 1 },
  ]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [
    'apps/evil.apk: managed by the app deploy, not the website',
    'x.php: .php files are not allowed',
    'about.html: listed twice',
    'big.mp4: larger than 50 MB',
    'nosum.html: missing checksum',
    'index.html is missing',
  ]);
});

test('a non-list is refused', () => {
  assert.deepEqual(validateManifest(undefined), { ok: false, errors: ['Staging did not send a file list'] });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd services/site-promoter && node --test "src/**/*.test.js"`
Expected: FAIL, `Cannot find module '.../policy.js'`.

- [ ] **Step 4: Implement**

`services/site-promoter/src/policy.js`:

```js
/**
 * What may be promoted onto dwaarai.com, decided before a single byte moves.
 *
 * Staging is shared hosting edited by hand, so everything it says is checked:
 * a path that climbs out of the folder, a script the web server would run, or
 * a file that belongs to another deploy (the valet APK and its install page)
 * refuses the whole promote. Refusing everything is deliberate -- half a
 * website is worse than yesterday's website.
 */

// Written into the live folder by other deploys. A promote neither replaces
// nor deletes them, and staging may not ship them.
export const PROTECTED = ['apps/', 'install.html', 'scripts/'];

// Staging's own machinery. Never promoted.
export const STAGING_ONLY = ['_staging/', 'promote/', 'cgi-bin/'];

export const ALLOWED_EXT = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'xml', 'webmanifest', 'ico',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'pdf', 'mp4', 'webm', 'mp3', 'csv', 'md',
]);

export const LIMITS = { files: 5000, fileBytes: 50 * 1024 * 1024, totalBytes: 500 * 1024 * 1024 };

export class PromoteError extends Error {
  constructor(message, details = []) {
    super(message);
    this.details = details;
  }
}

export function isProtected(rel) {
  return PROTECTED.some((x) => (x.endsWith('/') ? rel.startsWith(x) : rel === x));
}

// ASCII letters, digits, and the punctuation real file names on the site use.
const SEGMENT = /^[\w .,()@+\-]+$/;

export function checkPath(p) {
  if (typeof p !== 'string' || p === '') return 'empty path';
  if (p.length > 300) return 'path too long';
  if (p.startsWith('/') || p.includes('\\')) return 'not a relative path';
  const segs = p.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return 'not a clean path';
    if (s.startsWith('.')) return 'hidden file';
    if (!SEGMENT.test(s)) return 'unusual characters in the name';
  }
  if (STAGING_ONLY.some((x) => p.startsWith(x))) return 'staging-only file';
  const name = segs[segs.length - 1];
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!ALLOWED_EXT.has(ext)) return `.${ext || '(none)'} files are not allowed`;
  return null;
}

export function validateManifest(files) {
  if (!Array.isArray(files)) return { ok: false, errors: ['Staging did not send a file list'] };
  const errors = [];
  if (files.length > LIMITS.files) errors.push(`${files.length} files is more than the ${LIMITS.files} allowed`);
  const seen = new Set();
  let total = 0;
  for (const f of files) {
    const p = f && f.path;
    const why = checkPath(p);
    if (why) { errors.push(`${p}: ${why}`); continue; }
    if (isProtected(p)) { errors.push(`${p}: managed by the app deploy, not the website`); continue; }
    if (seen.has(p)) { errors.push(`${p}: listed twice`); continue; }
    seen.add(p);
    if (!Number.isInteger(f.size) || f.size < 0) errors.push(`${p}: bad size`);
    else if (f.size > LIMITS.fileBytes) { errors.push(`${p}: larger than 50 MB`); continue; }
    else total += f.size;
    if (!/^[0-9a-f]{64}$/.test(f.sha256 || '')) errors.push(`${p}: missing checksum`);
  }
  if (total > LIMITS.totalBytes) errors.push('The site is larger than 500 MB');
  if (!seen.has('index.html')) errors.push('index.html is missing');
  return { ok: errors.length === 0, errors: errors.slice(0, 50) };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd services/site-promoter && node --test "src/**/*.test.js"`
Expected: all policy tests PASS.

- [ ] **Step 6: Stage for commit** (commit when the user asks)

```bash
git add services/site-promoter/package.json services/site-promoter/src/policy.js services/site-promoter/src/policy.test.js
```

---

### Task 2: Manifest builder and request signing

**Files:**
- Create: `services/site-promoter/src/manifest.js`
- Create: `services/site-promoter/src/sign.js`
- Test: `services/site-promoter/src/manifest.test.js`, `services/site-promoter/src/sign.test.js`

**Interfaces:**
- Consumes: `isProtected` from Task 1.
- Produces: `sha256(buf: Buffer): string`, `liveSkip(rel: string): boolean`, `buildManifest(root: string, {skip?}): Promise<{path, sha256, size}[]>` (sorted by path; `skip` is called with file paths and with directory paths ending in `/`); `signHeader(secret, method, path, body?, now?): string`, `verifyHeader(secret, header, method, path, body?, now?): boolean`, `MAX_SKEW_S = 300`.

- [ ] **Step 1: Write the failing tests**

`services/site-promoter/src/manifest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildManifest, liveSkip, sha256 } from './manifest.js';

async function tree(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-man-'));
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), body);
  }
  return root;
}

test('lists every file with its checksum and size, sorted', async () => {
  const root = await tree({ 'index.html': 'home', 'b/x.css': 'x{}' });
  assert.deepEqual(await buildManifest(root), [
    { path: 'b/x.css', sha256: sha256(Buffer.from('x{}')), size: 3 },
    { path: 'index.html', sha256: sha256(Buffer.from('home')), size: 4 },
  ]);
});

test('the live view leaves out other deploys\' files and dotfiles', async () => {
  const root = await tree({
    'index.html': 'home', 'install.html': 'apk page', 'apps/v.apk': 'bin',
    'scripts/b.py': 'py', '.well-known/x.txt': 'x', '.hidden.html': 'h',
  });
  const paths = (await buildManifest(root, { skip: liveSkip })).map((f) => f.path);
  assert.deepEqual(paths, ['index.html']);
});

test('symlinks are ignored, so nothing outside the folder is ever read', async () => {
  const root = await tree({ 'index.html': 'home' });
  await fs.symlink('/etc/hosts', path.join(root, 'hosts.txt'));
  assert.deepEqual((await buildManifest(root)).map((f) => f.path), ['index.html']);
});
```

`services/site-promoter/src/sign.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signHeader, verifyHeader } from './sign.js';

const NOW = 1_700_000_000_000;

test('matches the vector the PHP side is tested against', () => {
  assert.equal(
    signHeader('test-secret', 'POST', '/_site/promote', '{"by":"asha"}', NOW),
    't=1700000000,v1=069ff57a44f13ebbce58104ce4adbe2161b6d1e64c965358f78cfa9f09234c57',
  );
});

test('accepts its own signature', () => {
  const h = signHeader('s', 'GET', '/_site/status', '', NOW);
  assert.equal(verifyHeader('s', h, 'GET', '/_site/status', '', NOW), true);
});

test('refuses a changed body, path, method, secret, or an old request', () => {
  const h = signHeader('s', 'POST', '/_site/promote', '{"by":"a"}', NOW);
  assert.equal(verifyHeader('s', h, 'POST', '/_site/promote', '{"by":"b"}', NOW), false);
  assert.equal(verifyHeader('s', h, 'POST', '/_site/rollback', '{"by":"a"}', NOW), false);
  assert.equal(verifyHeader('s', h, 'GET', '/_site/promote', '{"by":"a"}', NOW), false);
  assert.equal(verifyHeader('other', h, 'POST', '/_site/promote', '{"by":"a"}', NOW), false);
  assert.equal(verifyHeader('s', h, 'POST', '/_site/promote', '{"by":"a"}', NOW + 301_000), false);
});

test('refuses missing or malformed headers, and an unset secret', () => {
  assert.equal(verifyHeader('s', undefined, 'GET', '/x', '', NOW), false);
  assert.equal(verifyHeader('s', 't=1,v1=zz', 'GET', '/x', '', NOW), false);
  const h = signHeader('', 'GET', '/x', '', NOW);
  assert.equal(verifyHeader('', h, 'GET', '/x', '', NOW), false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd services/site-promoter && node --test "src/**/*.test.js"`
Expected: FAIL, modules `manifest.js` and `sign.js` not found.

- [ ] **Step 3: Implement**

`services/site-promoter/src/manifest.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isProtected } from './policy.js';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// What the live folder's website is: everything except other deploys' files
// and dotfiles. Promote and rollback only ever see, change or delete this set.
export const liveSkip = (rel) => isProtected(rel) || rel.split('/').some((s) => s.startsWith('.'));

export async function buildManifest(root, { skip = () => false } = {}) {
  const out = [];
  async function walk(rel) {
    for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      // Never followed: a link could point anywhere on the box.
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!skip(`${r}/`)) await walk(r);
        continue;
      }
      if (!e.isFile() || skip(r)) continue;
      const buf = await fs.readFile(path.join(root, r));
      out.push({ path: r, sha256: sha256(buf), size: buf.length });
    }
  }
  await walk('');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
```

`services/site-promoter/src/sign.js`:

```js
import crypto from 'node:crypto';

/**
 * Requests between the staging Promote page and this service are signed with
 * a shared secret over the time, method, path and body. The PHP twin is
 * site_sign() in deploy/site-staging/_staging/lib.php; both are tested against
 * the same vector, so a change to one without the other fails a test.
 */
export const MAX_SKEW_S = 300;

function signature(secret, t, method, path, body) {
  return crypto.createHmac('sha256', secret).update(`${t}.${method.toUpperCase()}.${path}.${body}`).digest('hex');
}

export function signHeader(secret, method, path, body = '', now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${signature(secret, t, method, path, body)}`;
}

export function verifyHeader(secret, header, method, path, body = '', now = Date.now()) {
  if (!secret || typeof header !== 'string') return false;
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(Math.floor(now / 1000) - t) > MAX_SKEW_S) return false;
  const want = Buffer.from(signature(secret, t, method, path, body), 'hex');
  const got = Buffer.from(m[2], 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd services/site-promoter && node --test "src/**/*.test.js"`
Expected: PASS (policy, manifest, sign).

- [ ] **Step 5: Stage for commit**

```bash
git add services/site-promoter/src/manifest.js services/site-promoter/src/manifest.test.js services/site-promoter/src/sign.js services/site-promoter/src/sign.test.js
```

---

### Task 3: Promote, rollback, backups and history

**Files:**
- Create: `services/site-promoter/src/promote.js`
- Test: `services/site-promoter/src/promote.test.js`

**Interfaces:**
- Consumes: `buildManifest`, `liveSkip`, `sha256` (Task 2); `validateManifest`, `isProtected`, `PromoteError` (Task 1).
- Produces:
  - `cfg` shape used everywhere: `{ live: string, backups: string, logFile: string, staging: { base: string, user: string, pass: string }, by?: string, backup?: string }`
  - `promote(cfg, { fetchImpl?, now? }): Promise<{changed, removed, backup: string|null, paths?: string[]}>`
  - `rollback(cfg, { now? }): Promise<{restored, changed, removed, backup}>` (uses `cfg.backup`)
  - `listBackups(dir): Promise<string[]>` newest first; `readLog(file, n=20): Promise<object[]>` newest first; `KEEP_BACKUPS = 10`.

- [ ] **Step 1: Write the failing test**

`services/site-promoter/src/promote.test.js`:

```js
import { test } from 'node:test';
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd services/site-promoter && node --test "src/**/*.test.js"`
Expected: FAIL, `promote.js` not found.

- [ ] **Step 3: Implement**

`services/site-promoter/src/promote.js`:

```js
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

async function applyChanges(live, copies, removals) {
  for (const { path: rel, from } of copies) {
    const dest = inside(live, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    // Copy beside, then rename: a visitor gets the old page or the new one,
    // never half of one.
    const tmp = `${dest}.promote-tmp`;
    await fs.copyFile(from, tmp);
    await fs.rename(tmp, dest);
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

async function backupLive(cfg, liveFiles, stamp) {
  const dir = path.join(cfg.backups, stamp);
  await fs.mkdir(dir, { recursive: true });
  for (const f of liveFiles) {
    const d = path.join(dir, f.path);
    await fs.mkdir(path.dirname(d), { recursive: true });
    await fs.copyFile(path.join(cfg.live, f.path), d);
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
    return (await fs.readFile(file, 'utf8')).trim().split('\n').filter(Boolean).slice(-n).reverse().map((l) => JSON.parse(l));
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
    await appendLog(cfg.logFile, { ...entry, ok: false, error: e.message, details: e.details || [] });
    throw e;
  }
}

export function promote(cfg, { fetchImpl = fetch, now = new Date() } = {}) {
  return logged(cfg, 'promote', now, async () => {
    const stamp = stampOf(now);
    const { files } = await (await fromStaging(cfg.staging, '/_staging/manifest.php', fetchImpl)).json();
    const v = validateManifest(files);
    if (!v.ok) throw new PromoteError('Staging has files the live site cannot take', v.errors);

    const liveFiles = await buildManifest(cfg.live, { skip: liveSkip });
    const { changed, removed } = diff(files, liveFiles);
    if (!changed.length && !removed.length) return { changed: 0, removed: 0, backup: null };

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
      await applyChanges(cfg.live, copies, removed);
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
    // Back up first, so a rollback can itself be rolled back.
    const backup = await backupLive(cfg, liveFiles, stampOf(now));
    await applyChanges(cfg.live, changed.map((f) => ({ path: f.path, from: path.join(src, f.path) })), removed);
    await pruneBackups(cfg.backups);
    return { restored: cfg.backup, changed: changed.length, removed: removed.length, backup };
  });
}
```

Note the incoming folder name `incoming-<stamp>` (no leading dot), so the test `fs.readdir(cfg.backups)` being `[]` after an abort proves it was cleaned up.

- [ ] **Step 4: Run the tests**

Run: `cd services/site-promoter && node --test "src/**/*.test.js"`
Expected: all PASS.

- [ ] **Step 5: Stage for commit**

```bash
git add services/site-promoter/src/promote.js services/site-promoter/src/promote.test.js
```

---

### Task 4: The HTTP API

**Files:**
- Create: `services/site-promoter/src/server.js`
- Create: `services/site-promoter/src/index.js`
- Test: `services/site-promoter/src/server.test.js`

**Interfaces:**
- Consumes: `verifyHeader` (Task 2); `buildManifest`, `liveSkip` (Task 2); `promote`, `rollback`, `listBackups`, `readLog` (Task 3).
- Produces: `createServer(cfg, { fetchImpl? }): http.Server`. Routes (all require `X-Site-Signature` over the exact path, without query string):
  - `GET /_site/manifest` → `200 {files}` (live, `liveSkip` applied)
  - `GET /_site/status` → `200 {running: null|{kind,by,startedAt}, log: [...20], backups: [...]}`
  - `POST /_site/promote` body `{"by"}` → `202 {started:true}` | `409 {error:'busy'}`
  - `POST /_site/rollback` body `{"by","backup"}` → `202` | `400 {error:'bad_backup'}` | `409`
  - unsigned → `401 {error:'bad_signature'}`; body over 10 KB → `413`.

- [ ] **Step 1: Write the failing test**

`services/site-promoter/src/server.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, body = '', sign = true) => fetch(url + p, {
    method, body: body || undefined,
    headers: sign ? { 'X-Site-Signature': signHeader(SECRET, method, p, body) } : {},
  });
  return { server, call, live };
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

test('rollback needs a well-formed backup name', async (t) => {
  const { server, call } = await start(staging({}));
  t.after(() => server.close());
  assert.equal((await call('POST', '/_site/rollback', '{"by":"a","backup":"../../etc"}')).status, 400);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd services/site-promoter && node --test "src/**/*.test.js"`
Expected: FAIL, `server.js` not found.

- [ ] **Step 3: Implement**

`services/site-promoter/src/server.js`:

```js
import http from 'node:http';
import { verifyHeader } from './sign.js';
import { buildManifest, liveSkip } from './manifest.js';
import { promote, rollback, listBackups, readLog } from './promote.js';

/**
 * Bound to 127.0.0.1 and reached only through nginx at /_site/. Every request
 * is signed by the staging Promote page; there is no other caller.
 *
 * Promote and rollback answer 202 and carry on in the background, because
 * shared hosting stops a PHP request after ~30 s and a big promote can take
 * longer. The Promote page polls /_site/status until `running` is null.
 */
export function createServer(cfg, { fetchImpl = fetch } = {}) {
  let running = null;

  return http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    const p = new URL(req.url, 'http://local').pathname;

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 10_000) return send(413, { error: 'too_large' });
    }
    if (!verifyHeader(cfg.secret, req.headers['x-site-signature'], req.method, p, body)) {
      return send(401, { error: 'bad_signature' });
    }

    try {
      if (req.method === 'GET' && p === '/_site/manifest') {
        return send(200, { files: await buildManifest(cfg.live, { skip: liveSkip }) });
      }
      if (req.method === 'GET' && p === '/_site/status') {
        return send(200, { running, log: await readLog(cfg.logFile, 20), backups: await listBackups(cfg.backups) });
      }
      if (req.method === 'POST' && (p === '/_site/promote' || p === '/_site/rollback')) {
        if (running) return send(409, { error: 'busy', running });
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return send(400, { error: 'bad_json' }); }
        const by = String(input.by || 'unknown').slice(0, 64);
        const kind = p.slice('/_site/'.length);
        if (kind === 'rollback' && !/^\d{8}-\d{6}$/.test(String(input.backup || ''))) {
          return send(400, { error: 'bad_backup' });
        }
        const job = kind === 'promote'
          ? () => promote({ ...cfg, by }, { fetchImpl })
          : () => rollback({ ...cfg, by, backup: input.backup });
        running = { kind, by, startedAt: new Date().toISOString() };
        // The outcome, success or failure, is in the log; nothing to do here.
        job().catch(() => {}).finally(() => { running = null; });
        return send(202, { started: true });
      }
      return send(404, { error: 'not_found' });
    } catch (e) {
      return send(500, { error: 'internal', message: e.message });
    }
  });
}
```

`services/site-promoter/src/index.js`:

```js
import { createServer } from './server.js';

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`${k} is not set`); process.exit(1); }
  return v;
};

const cfg = {
  secret: need('SITE_PROMOTE_SECRET'),
  live: process.env.LIVE_DIR || '/opt/communitygate/landing',
  backups: process.env.BACKUP_DIR || '/opt/communitygate/landing-backups',
  logFile: process.env.LOG_FILE || '/var/lib/site-promoter/promotions.jsonl',
  staging: {
    base: process.env.STAGING_BASE || 'https://staging.dwaarai.com',
    user: need('STAGING_USER'),
    pass: need('STAGING_PASS'),
  },
};

const port = Number(process.env.PORT || 3011);
createServer(cfg).listen(port, '127.0.0.1', () => console.log(`site-promoter on 127.0.0.1:${port}`));
```

- [ ] **Step 4: Run the tests**

Run: `cd services/site-promoter && node --test "src/**/*.test.js"`
Expected: all PASS.

- [ ] **Step 5: Stage for commit**

```bash
git add services/site-promoter/src/server.js services/site-promoter/src/index.js services/site-promoter/src/server.test.js
```

---

### Task 5: The staging side (PHP, .htaccess)

**Files:**
- Create: `deploy/site-staging/_staging/lib.php`, `manifest.php`, `file.php`, `lead.php`, `robots.txt`
- Create: `deploy/site-staging/promote/index.php`
- Create: `deploy/site-staging/.htaccess`
- Test: `deploy/site-staging/tests/run.php`

**Interfaces:**
- Consumes: the signature format and vector from Global Constraints; the API in Task 4.
- Produces: `site_sign(string $secret, int $t, string $method, string $path, string $body = ''): string`, `site_path_ok(string $p): bool`, `site_manifest(string $root): array`, `site_call(string $method, string $path, ?array $payload = null): array{status:int, body:array}`, `site_config(): array{secret:string, live:string}`, `site_docroot(): string`.
- Config file the user creates on cPanel at `/home/<cpanel user>/site-promote-config.php` (one level above the staging docroot, outside any web root):
  ```php
  <?php return ['secret' => '<SITE_PROMOTE_SECRET>', 'live' => 'https://dwaarai.com'];
  ```

- [ ] **Step 1: Write the failing PHP test**

`deploy/site-staging/tests/run.php`:

```php
<?php
declare(strict_types=1);
require __DIR__ . '/../_staging/lib.php';

$fail = 0;
function check(string $name, bool $ok): void {
    global $fail;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . "\n";
    if (!$ok) $fail++;
}

check('signature matches the Node vector',
    site_sign('test-secret', 1700000000, 'post', '/_site/promote', '{"by":"asha"}')
    === '069ff57a44f13ebbce58104ce4adbe2161b6d1e64c965358f78cfa9f09234c57');

foreach (['index.html', 'careers/index.html', 'a b.jpg'] as $p) check("path ok: $p", site_path_ok($p));
foreach (['', '/index.html', '../x.html', 'a//b', '.htaccess', 'x/.git/c', '_staging/lib.php', 'promote/index.php', "a\\b"] as $p) {
    check("path refused: $p", !site_path_ok($p));
}

$root = sys_get_temp_dir() . '/sp-php-' . bin2hex(random_bytes(4));
foreach (['index.html' => 'home', 'b/x.css' => 'x{}', '_staging/lib.php' => 'php', 'promote/index.php' => 'p',
          '.htaccess' => 'h', 'blog/.secret.txt' => 's', 'error_log' => 'e'] as $rel => $body) {
    @mkdir(dirname("$root/$rel"), 0777, true);
    file_put_contents("$root/$rel", $body);
}
$m = site_manifest($root);
check('manifest lists only promotable files', array_column($m, 'path') === ['b/x.css', 'index.html']);
check('manifest checksum', $m[1]['sha256'] === hash('sha256', 'home') && $m[1]['size'] === 4);

echo $fail ? "\n$fail failed\n" : "\nall passed\n";
exit($fail ? 1 : 0);
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd deploy/site-staging && npx -y @php-wasm/cli@3.1.60 tests/run.php`
Expected: FAIL, `lib.php` not found. (If `@php-wasm/cli` cannot read the host file system in this version, stop and tell the user; the fallback is to run `tests/run.php` once in cPanel's Terminal after upload.)

- [ ] **Step 3: Implement lib.php**

`deploy/site-staging/_staging/lib.php`:

```php
<?php
declare(strict_types=1);

/**
 * Staging's half of the promote. The other half is services/site-promoter on
 * the AWS box; site_sign() here and signHeader() there are tested against the
 * same vector, so they cannot drift apart unnoticed.
 */

// Never promoted. Mirrors STAGING_ONLY in services/site-promoter/src/policy.js.
const SITE_STAGING_ONLY = ['_staging/', 'promote/', 'cgi-bin/'];

function site_docroot(): string
{
    return dirname(__DIR__);
}

function site_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        // One level above the staging folder: outside every web root, so the
        // secret cannot be downloaded.
        $file = dirname(__DIR__, 2) . '/site-promote-config.php';
        if (!is_file($file)) {
            throw new RuntimeException('site-promote-config.php is missing next to the staging folder');
        }
        $cfg = require $file;
    }
    return $cfg;
}

function site_sign(string $secret, int $t, string $method, string $path, string $body = ''): string
{
    return hash_hmac('sha256', $t . '.' . strtoupper($method) . '.' . $path . '.' . $body, $secret);
}

function site_path_ok(string $p): bool
{
    if ($p === '' || strlen($p) > 300 || $p[0] === '/' || str_contains($p, '\\') || str_contains($p, "\0")) {
        return false;
    }
    foreach (explode('/', $p) as $s) {
        if ($s === '' || $s === '.' || $s === '..' || $s[0] === '.') {
            return false;
        }
    }
    foreach (SITE_STAGING_ONLY as $x) {
        if (str_starts_with($p, $x)) {
            return false;
        }
    }
    return true;
}

function site_manifest(string $root): array
{
    $root = rtrim($root, '/');
    $filter = function (SplFileInfo $f) use ($root): bool {
        if ($f->isLink()) {
            return false;
        }
        $rel = substr($f->getPathname(), strlen($root) + 1);
        // A directory is tested as "<dir>/x" so the staging-only prefixes
        // ("promote/") and hidden-segment rule apply to it too.
        return $f->isDir() ? site_path_ok($rel . '/x') : (site_path_ok($rel) && basename($rel) !== 'error_log');
    };
    $it = new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), $filter));
    $out = [];
    foreach ($it as $f) {
        if (!$f->isFile()) {
            continue;
        }
        $out[] = [
            'path' => substr($f->getPathname(), strlen($root) + 1),
            'sha256' => hash_file('sha256', $f->getPathname()),
            'size' => $f->getSize(),
        ];
    }
    usort($out, fn($a, $b) => strcmp($a['path'], $b['path']));
    return $out;
}

function site_call(string $method, string $path, ?array $payload = null): array
{
    $cfg = site_config();
    $body = $payload === null ? '' : json_encode($payload, JSON_UNESCAPED_SLASHES);
    $t = time();
    $ch = curl_init($cfg['live'] . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-Site-Signature: t=' . $t . ',v1=' . site_sign($cfg['secret'], $t, $method, $path, $body),
        ],
    ]);
    if ($body !== '') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        return ['status' => 0, 'body' => ['error' => "Could not reach dwaarai.com: $err"]];
    }
    return ['status' => $code, 'body' => json_decode((string) $raw, true) ?? ['error' => "Unexpected reply ($code)"]];
}
```

- [ ] **Step 4: Run the PHP test**

Run: `cd deploy/site-staging && npx -y @php-wasm/cli@3.1.60 tests/run.php`
Expected: every line `ok`, then `all passed`.

- [ ] **Step 5: Write the endpoints**

`deploy/site-staging/_staging/manifest.php`:

```php
<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');
echo json_encode(['files' => site_manifest(site_docroot())], JSON_UNESCAPED_SLASHES);
```

`deploy/site-staging/_staging/file.php`:

```php
<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';

// Raw bytes of one site file, for the promoter. Read through PHP rather than
// fetched by URL so .htaccess redirects (/index.html -> /) never get in the way.
$p = (string) ($_GET['p'] ?? '');
$root = realpath(site_docroot());
$full = site_path_ok($p) ? realpath($root . '/' . $p) : false;
if ($full === false || !str_starts_with($full, $root . '/') || !is_file($full) || is_link($root . '/' . $p)) {
    http_response_code(404);
    exit;
}
header('Content-Type: application/octet-stream');
header('Content-Length: ' . filesize($full));
header('Cache-Control: no-store');
readfile($full);
```

`deploy/site-staging/_staging/lead.php`:

```php
<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';

// /lead on staging. The live lead mailer runs on the AWS box, so a staging
// form is relayed there with its subject marked, and sales can tell a test
// from a customer at a glance.
header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo '{"success":false}';
    exit;
}
$data = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Bad form data']);
    exit;
}
$data['subject'] = '[STAGING] ' . (string) ($data['subject'] ?? 'Website enquiry');

$ch = curl_init(site_config()['live'] . '/lead');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($data),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
]);
$raw = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);
if ($raw === false) {
    http_response_code(502);
    echo json_encode(['success' => false, 'message' => 'Could not reach the live lead mailer']);
    exit;
}
http_response_code($code ?: 502);
echo $raw;
```

`deploy/site-staging/_staging/robots.txt`:

```
User-agent: *
Disallow: /
```

- [ ] **Step 6: Write the Promote page**

`deploy/site-staging/promote/index.php`:

```php
<?php
declare(strict_types=1);
require dirname(__DIR__) . '/_staging/lib.php';

session_start();
$me = $_SERVER['REMOTE_USER'] ?? $_SERVER['REDIRECT_REMOTE_USER'] ?? $_SERVER['PHP_AUTH_USER'] ?? 'unknown';
if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($_SESSION['csrf'], (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('This form expired. Go back and reload the page.');
    }
    $action = (string) ($_POST['action'] ?? '');
    $r = match ($action) {
        'promote' => site_call('POST', '/_site/promote', ['by' => $me]),
        'rollback' => site_call('POST', '/_site/rollback', ['by' => $me, 'backup' => (string) ($_POST['backup'] ?? '')]),
        default => ['status' => 400, 'body' => ['error' => 'Unknown action']],
    };
    $_SESSION['flash'] = $r['status'] === 202
        ? 'Started. This page refreshes by itself until it finishes.'
        : 'Could not start: ' . ($r['body']['error'] ?? 'error ' . $r['status']);
    header('Location: ./', true, 303);
    exit;
}

$flash = $_SESSION['flash'] ?? null;
unset($_SESSION['flash']);

$status = site_call('GET', '/_site/status');
$liveRes = site_call('GET', '/_site/manifest');
$running = $status['status'] === 200 ? $status['body']['running'] : null;

$changes = null;
if ($liveRes['status'] === 200) {
    $l = array_column($liveRes['body']['files'], 'sha256', 'path');
    $s = array_column(site_manifest(site_docroot()), 'sha256', 'path');
    $changes = [
        'New' => array_keys(array_diff_key($s, $l)),
        'Changed' => array_keys(array_filter(array_intersect_key($s, $l), fn($h, $p) => $l[$p] !== $h, ARRAY_FILTER_USE_BOTH)),
        'Removed' => array_keys(array_diff_key($l, $s)),
    ];
}
$total = $changes ? count($changes['New']) + count($changes['Changed']) + count($changes['Removed']) : 0;
$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<?php if ($running): ?><meta http-equiv="refresh" content="3"><?php endif; ?>
<title>Promote to dwaarai.com</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 760px; margin: 32px auto; padding: 0 16px; color: #111827; background: #f9fafb; }
  h1 { font-size: 22px; } h2 { font-size: 16px; margin-top: 28px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin: 12px 0; }
  .flash { background: #ecfdf5; border-color: #a7f3d0; }
  .bad { background: #fef2f2; border-color: #fecaca; }
  button { font: inherit; padding: 10px 18px; border-radius: 8px; border: 0; cursor: pointer; }
  .go { background: #0f766e; color: #fff; font-weight: 600; } .go:disabled { opacity: .4; cursor: default; }
  .quiet { background: #fff; border: 1px solid #d1d5db; }
  ul { margin: 4px 0 0; padding-left: 20px; } li { word-break: break-all; }
  small { color: #6b7280; }
</style>
</head>
<body>
<h1>Promote staging to dwaarai.com</h1>
<p><small>Signed in as <?= $h($me) ?>.</small></p>

<?php if ($flash): ?><div class="card flash"><?= $h($flash) ?></div><?php endif; ?>

<?php if ($running): ?>
  <div class="card flash"><strong><?= $h(ucfirst($running['kind'])) ?> in progress</strong>, started by <?= $h($running['by']) ?>. This page refreshes every few seconds.</div>
<?php elseif ($changes === null): ?>
  <div class="card bad">Could not reach dwaarai.com to compare: <?= $h($liveRes['body']['error'] ?? $liveRes['status']) ?></div>
<?php else: ?>
  <div class="card">
    <?php if ($total === 0): ?>
      <p>Staging and the live site are the same. Nothing to promote.</p>
    <?php else: ?>
      <p><strong><?= $total ?> file<?= $total === 1 ? '' : 's' ?></strong> will change on the live site.</p>
      <?php foreach ($changes as $label => $paths): if (!$paths) continue; ?>
        <p><?= $h($label) ?> (<?= count($paths) ?>)</p>
        <ul><?php foreach (array_slice($paths, 0, 100) as $p): ?><li><?= $h($p) ?></li><?php endforeach; ?></ul>
      <?php endforeach; ?>
    <?php endif; ?>
    <form method="post" style="margin-top:16px">
      <input type="hidden" name="csrf" value="<?= $h($_SESSION['csrf']) ?>">
      <input type="hidden" name="action" value="promote">
      <button class="go" <?= $total === 0 ? 'disabled' : '' ?>>Promote to live</button>
      <small>&nbsp;The live site is backed up first.</small>
    </form>
  </div>
<?php endif; ?>

<?php if ($status['status'] === 200): ?>
  <h2>Recent history</h2>
  <?php foreach ($status['body']['log'] as $e): ?>
    <div class="card <?= $e['ok'] ? '' : 'bad' ?>">
      <strong><?= $h(ucfirst($e['kind'])) ?></strong> by <?= $h($e['by']) ?>, <?= $h(date('j M Y, H:i', strtotime($e['at']))) ?> UTC.
      <?php if ($e['ok']): ?>
        <?= (int) ($e['changed'] ?? 0) ?> changed, <?= (int) ($e['removed'] ?? 0) ?> removed.
      <?php else: ?>
        Failed: <?= $h($e['error']) ?>
        <?php if (!empty($e['details'])): ?><ul><?php foreach ($e['details'] as $d): ?><li><?= $h($d) ?></li><?php endforeach; ?></ul><?php endif; ?>
      <?php endif; ?>
    </div>
  <?php endforeach; ?>

  <?php if ($status['body']['backups']): ?>
    <h2>Undo</h2>
    <p><small>Each backup is the live site just before a promote. Restoring one also backs up the current site first.</small></p>
    <?php foreach ($status['body']['backups'] as $b): ?>
      <form method="post" class="card" style="display:flex;justify-content:space-between;align-items:center">
        <span><?= $h($b) ?></span>
        <input type="hidden" name="csrf" value="<?= $h($_SESSION['csrf']) ?>">
        <input type="hidden" name="action" value="rollback">
        <input type="hidden" name="backup" value="<?= $h($b) ?>">
        <button class="quiet" <?= $running ? 'disabled' : '' ?>>Restore this</button>
      </form>
    <?php endforeach; ?>
  <?php endif; ?>
<?php endif; ?>
</body>
</html>
```

- [ ] **Step 7: Write the staging .htaccess**

`deploy/site-staging/.htaccess` (cPanel's Directory Privacy appends its own `AuthType … Require valid-user` lines to this file in Task 7; leave them in place):

```apache
# staging.dwaarai.com only. Dotfiles are never promoted.

Options -Indexes
DirectoryIndex index.html

<IfModule mod_headers.c>
  Header always set X-Robots-Tag "noindex, nofollow"
</IfModule>

RewriteEngine On

# Staging machinery
RewriteRule ^robots\.txt$ _staging/robots.txt [L]
RewriteRule ^lead$ _staging/lead.php [L]

# ---- Mirror of the dwaarai.com nginx rules (communitygate.conf) ----
# Checked against live by check-routes.sh; keep the two in step.
RewriteCond %{THE_REQUEST} \s/index\.html[\s?] [NC]
RewriteRule ^index\.html$ / [R=301,L]

RewriteRule ^case-studies(\.html)?$ - [G,L]
RewriteRule ^(how-it-works|solutions|resources|partners)$ / [R=301,L]
RewriteRule ^solutions/ / [R=301,L]
RewriteRule ^about$ /about.html [R=301,L]
RewriteRule ^contact$ /contact-us.html [R=301,L]
RewriteRule ^demo$ /book-a-demo.html [R=301,L]
RewriteRule ^careers$ /careers/ [R=301,L]

RewriteCond %{THE_REQUEST} \s/gate-automation-cost\.html[\s?] [NC]
RewriteRule ^gate-automation-cost\.html$ /gate-automation-cost [R=301,L]
RewriteRule ^gate-automation-cost$ gate-automation-cost.html [L]

RewriteCond %{THE_REQUEST} \s/dwaar-ai-valet-book-a-demo\.html[\s?] [NC]
RewriteRule ^dwaar-ai-valet-book-a-demo\.html$ /dwaar-ai-valet/book-a-demo [R=301,L]
RewriteRule ^dwaar-ai-valet/book-a-demo$ dwaar-ai-valet-book-a-demo.html [L]

RewriteCond %{THE_REQUEST} \s/dwaar-ai-valet-thank-you\.html[\s?] [NC]
RewriteRule ^dwaar-ai-valet-thank-you\.html$ /dwaar-ai-valet/thank-you [R=301,L]
RewriteRule ^dwaar-ai-valet/thank-you$ dwaar-ai-valet-thank-you.html [L]

RewriteCond %{THE_REQUEST} \s/dwaar-ai-valet-blog\.html[\s?] [NC]
RewriteRule ^dwaar-ai-valet-blog\.html$ /dwaar-ai-valet/blog [R=301,L]
RewriteRule ^dwaar-ai-valet/blog/?$ dwaar-ai-valet-blog.html [L]

RewriteCond %{THE_REQUEST} \s/dwaar-ai-valet-blog-valet-parking-liability-india-hotels\.html[\s?] [NC]
RewriteRule ^dwaar-ai-valet-blog-valet-parking-liability-india-hotels\.html$ /dwaar-ai-valet/blog/valet-parking-liability-india-hotels [R=301,L]
RewriteRule ^dwaar-ai-valet/blog/valet-parking-liability-india-hotels$ dwaar-ai-valet-blog-valet-parking-liability-india-hotels.html [L]

RewriteRule ^dwaar-ai-valet/blog/images/valet-scratch-hero\.jpg$ dwaar-ai-valet-blog-valet-scratch-hero.jpg [L]
RewriteRule ^dwaar-ai-valet/blog/images/valet-four-photo-condition-record\.png$ dwaar-ai-valet-blog-valet-four-photo-condition-record.png [L]

# nginx: try_files $uri $uri.html $uri/index.html
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_FILENAME}.html -f
RewriteRule ^(.+)$ $1.html [L]
```

The six `.html → pretty URL` redirects above (index, gate-automation-cost, valet book-a-demo, thank-you, blog, blog post) are what the nginx `location = /x.html` blocks at lines 77, 205, 220, 226, 232 and 244 are inferred to do; Task 7's `check-routes.sh` compares every one against live and any mismatch is fixed here before marketing starts.

- [ ] **Step 8: Run the PHP test again and lint all PHP**

Run:
```bash
cd deploy/site-staging && npx -y @php-wasm/cli@3.1.60 tests/run.php
for f in _staging/*.php promote/index.php; do npx -y @php-wasm/cli@3.1.60 -l "$f"; done
```
Expected: `all passed`, and `No syntax errors detected` for each file.

- [ ] **Step 9: Stage for commit**

```bash
git add deploy/site-staging
```

---

### Task 6: Install site-promoter on the AWS box

**Files:**
- Create: `deploy/deploy-site-promoter.sh` (runs on the box)
- Create: `deploy/ship-site-promoter.sh` (runs on the laptop)

**Interfaces:**
- Consumes: `services/site-promoter` (Tasks 1–4).
- Produces: systemd unit `dwaarai-site-promoter.service`; nginx `location ^~ /_site/` → `127.0.0.1:3011`; `/opt/communitygate/landing-backups/`; `/var/lib/site-promoter/`.

- [ ] **Step 1: Write the on-box installer**

`deploy/deploy-site-promoter.sh`:

```bash
#!/bin/bash
#
# Installs services/site-promoter on the dwaarai.com box. Idempotent.
#
# Secrets are never written by this script from nothing: each value comes from
# this shell (forwarded by ship-site-promoter.sh) or, failing that, from the
# unit already on the box -- the same inherit-from-live rule as deploy-valet.sh,
# so a deploy from a laptop that forgot a value cannot blank it.
set -euo pipefail

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

APP=/opt/communitygate/services/site-promoter
UNIT=/etc/systemd/system/dwaarai-site-promoter.service
NGINX_CONF=/etc/nginx/conf.d/communitygate.conf

for v in SITE_PROMOTE_SECRET STAGING_USER STAGING_PASS; do
  if [ -z "${!v:-}" ] && [ -f "$UNIT" ]; then
    printf -v "$v" '%s' "$(sudo sed -n "s/^Environment=$v=//p" "$UNIT" | head -1)"
  fi
  [ -n "${!v:-}" ] || die "$v is not set and not on the box"
done

say "Folders"
sudo mkdir -p /opt/communitygate/landing-backups /var/lib/site-promoter
test -f "$APP/src/index.js" || die "$APP/src/index.js missing"

say "systemd unit"
sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=dwaarai.com website promoter (staging -> live)
After=network.target

[Service]
ExecStart=/usr/bin/node $APP/src/index.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3011
Environment=SITE_PROMOTE_SECRET=$SITE_PROMOTE_SECRET
Environment=STAGING_USER=$STAGING_USER
Environment=STAGING_PASS=$STAGING_PASS
# Writes only the website, its backups and its own log.
ProtectSystem=strict
ReadWritePaths=/opt/communitygate/landing /opt/communitygate/landing-backups /var/lib/site-promoter
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
sudo chmod 600 "$UNIT"
sudo systemctl daemon-reload
sudo systemctl enable dwaarai-site-promoter >/dev/null
sudo systemctl restart dwaarai-site-promoter
sleep 2
systemctl is-active dwaarai-site-promoter >/dev/null || die "site-promoter did not start: $(sudo journalctl -u dwaarai-site-promoter -n 20 --no-pager)"

say "nginx"
if ! grep -q 'location \^~ /_site/' "$NGINX_CONF"; then
  sudo cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%Y%m%d-%H%M%S)"
  sudo python3 - "$NGINX_CONF" <<'PYEOF'
import io, sys
path = sys.argv[1]
s = io.open(path, encoding='utf-8').read()
block = """# ---- Website promoter (staging.dwaarai.com -> this site) ----
    # Signed requests only; the service itself refuses anything unsigned.
    location ^~ /_site/ {
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 16k;
        proxy_read_timeout 60s;
    }

    """
anchor = s.index('server_name dwaarai.com;')
admin = s.index('location ^~ /admin', anchor)
s = s[:admin] + block + s[admin:]
io.open(path, 'w', encoding='utf-8').write(s)
print('nginx /_site/ block inserted')
PYEOF
  if sudo nginx -t; then
    sudo systemctl reload nginx
  else
    LATEST=$(ls -t "$NGINX_CONF".bak.* | head -1)
    sudo cp "$LATEST" "$NGINX_CONF"
    die "nginx -t failed; restored $LATEST"
  fi
else
  echo "  already wired"
fi

say "Checks"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://dwaarai.com/_site/status)
[ "$code" = "401" ] || die "/_site/status should refuse unsigned requests with 401, got $code"
echo "  /_site/ answers and refuses unsigned requests"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://dwaarai.com/)
[ "$code" = "200" ] || die "landing page answered $code"
echo "  landing still up"
```

- [ ] **Step 2: Write the laptop wrapper**

`deploy/ship-site-promoter.sh`:

```bash
#!/bin/bash
#
# Ships services/site-promoter to the dwaarai.com box and installs it. Touches
# nothing else: no api-gateway restart, no valet deploy.
#
# First run needs SITE_PROMOTE_SECRET, STAGING_USER and STAGING_PASS in this
# shell. Later runs inherit them from the box. Names are echoed, never values.
set -euo pipefail

REPO="${REPO:-$HOME/Documents/DwaarAI/dwaarai}"
PROFILE="${AWS_PROFILE:-pie-prod}"
REGION="${REGION:-us-east-1}"
INSTANCE="${INSTANCE:-i-0cef4313a47d12e03}"
HOST="${HOST:-54.235.41.163}"
KEY=/tmp/eic-site-promoter
CFG=/tmp/eic-site-promoter.cfg

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

say "Testing"
(cd "$REPO/services/site-promoter" && node --test "src/**/*.test.js")

say "Packing"
tar czf /tmp/site-promoter.tar.gz -C "$REPO" \
  --exclude node_modules --exclude '*.test.js' \
  services/site-promoter deploy/deploy-site-promoter.sh

say "Connecting"
rm -f "$KEY" "$KEY.pub"
ssh-keygen -t ed25519 -N '' -f "$KEY" -q -C site-promoter
aws ec2-instance-connect send-ssh-public-key --profile "$PROFILE" --region "$REGION" \
  --instance-id "$INSTANCE" --instance-os-user ec2-user --ssh-public-key "file://$KEY.pub" >/dev/null
cat > "$CFG" <<EOF
Host dwaarsp
  HostName $HOST
  User ec2-user
  IdentityFile $KEY
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
EOF
scp -F "$CFG" /tmp/site-promoter.tar.gz dwaarsp:/tmp/site-promoter.tar.gz

FORWARD=""
for v in SITE_PROMOTE_SECRET STAGING_USER STAGING_PASS; do
  if [ -n "${!v:-}" ]; then
    FORWARD="$FORWARD $v=$(printf %q "${!v}")"
    echo "  forwarding $v"
  fi
done

say "Installing"
ssh -F "$CFG" dwaarsp "cd /opt/communitygate && tar xzf /tmp/site-promoter.tar.gz && env$FORWARD bash deploy/deploy-site-promoter.sh"
rm -f "$KEY" "$KEY.pub" "$CFG"
```

- [ ] **Step 3: Syntax-check both scripts**

Run: `bash -n deploy/deploy-site-promoter.sh && bash -n deploy/ship-site-promoter.sh && echo ok`
Expected: `ok`.

- [ ] **Step 4: Stage for commit**

```bash
git add deploy/deploy-site-promoter.sh deploy/ship-site-promoter.sh
```

The actual run is in Task 7, after the user has created the secrets.

---

### Task 7: Seed staging, go live, prove it end to end

**Files:**
- Create: `deploy/site-staging/pull-live.sh`
- Create: `deploy/site-staging/check-routes.sh`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the seeding script**

`deploy/site-staging/pull-live.sh` (read-only on the box; produces `~/Downloads/dwaarai-site-<date>.tar.gz` holding exactly the files a promote manages):

```bash
#!/bin/bash
# Downloads the live marketing site, minus files owned by other deploys, so
# staging starts as an exact copy of dwaarai.com. Changes nothing on the box.
set -euo pipefail
KEY=/tmp/eic-pull-live; CFG=/tmp/eic-pull-live.cfg
OUT="$HOME/Downloads/dwaarai-site-$(date +%Y%m%d).tar.gz"
rm -f "$KEY" "$KEY.pub"; ssh-keygen -t ed25519 -N '' -f "$KEY" -q -C pull-live
aws ec2-instance-connect send-ssh-public-key --profile "${AWS_PROFILE:-pie-prod}" --region us-east-1 \
  --instance-id i-0cef4313a47d12e03 --instance-os-user ec2-user --ssh-public-key "file://$KEY.pub" >/dev/null
printf 'Host d\n  HostName 54.235.41.163\n  User ec2-user\n  IdentityFile %s\n  IdentitiesOnly yes\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n  LogLevel ERROR\n' "$KEY" > "$CFG"
ssh -F "$CFG" d "cd /opt/communitygate/landing && sudo tar czf - --exclude=./apps --exclude=./scripts --exclude=./install.html --exclude='./.*' ." > "$OUT"
rm -f "$KEY" "$KEY.pub" "$CFG"
ls -lh "$OUT"
tar tzf "$OUT" | grep -vE '\.(html?|css|js|mjs|json|txt|xml|webmanifest|ico|png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|eot|pdf|mp4|webm|mp3|csv|md)$' | grep -v '/$' \
  && echo "^ these files would block a promote: decide with the user whether to delete them on staging" || echo "every file is promotable"
```

- [ ] **Step 2: Write the route check**

`deploy/site-staging/check-routes.sh`:

```bash
#!/bin/bash
# Same URL on live and staging must give the same status and redirect target.
# Usage: STAGING_AUTH='user:pass' bash check-routes.sh   (the user runs it; the value is theirs)
set -uo pipefail
: "${STAGING_AUTH:?set STAGING_AUTH=user:pass for staging}"
paths=(/ /index.html /about /about.html /contact /demo /careers /careers/ /case-studies /case-studies.html
  /how-it-works /solutions /solutions/x /resources /partners /gate-automation-cost /gate-automation-cost.html
  /dwaar-ai-valet/book-a-demo /dwaar-ai-valet-book-a-demo.html /dwaar-ai-valet/thank-you /dwaar-ai-valet-thank-you.html
  /dwaar-ai-valet/blog /dwaar-ai-valet/blog/ /dwaar-ai-valet-blog.html
  /dwaar-ai-valet/blog/valet-parking-liability-india-hotels /dwaar-ai-valet-blog-valet-parking-liability-india-hotels.html
  /dwaar-ai-valet/blog/images/valet-scratch-hero.jpg /dwaar-ai-valet/blog/images/valet-four-photo-condition-record.png
  /book-a-demo /privacy-policy /no-such-page)
probe() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 "$@"; }
bad=0
for p in "${paths[@]}"; do
  live=$(probe "https://dwaarai.com$p" | sed 's#https://dwaarai.com##')
  stg=$(probe -u "$STAGING_AUTH" "https://staging.dwaarai.com$p" | sed 's#https://staging.dwaarai.com##')
  if [ "$live" = "$stg" ]; then printf 'same  %-60s %s\n' "$p" "$live"; else printf 'DIFF  %-60s live=[%s] staging=[%s]\n' "$p" "$live" "$stg"; bad=1; fi
done
exit $bad
```

- [ ] **Step 3: User steps on BigRock cPanel** (the user does these; Claude can open the pages in Chrome and point, but does not type credentials or secrets)

1. **Domains → Create a New Domain**: `staging.dwaarai.com`, untick "Share document root", document root `staging.dwaarai.com` (i.e. `/home/<user>/staging.dwaarai.com`, outside `public_html`). cPanel adds the DNS record.
2. **SSL/TLS Status → Run AutoSSL**, and wait until `staging.dwaarai.com` shows a valid certificate.
3. **MultiPHP Manager**: set `staging.dwaarai.com` to PHP 8.1 or newer.
4. Generate the shared secret on the Mac with `! openssl rand -hex 32` and keep it in the password manager.
5. **File Manager**, in the home folder (one level above `staging.dwaarai.com`): create `site-promote-config.php` with
   `<?php return ['secret' => '<paste the secret>', 'live' => 'https://dwaarai.com'];`
6. Run `! bash deploy/site-staging/pull-live.sh`, then in File Manager upload the tarball into `staging.dwaarai.com/` and **Extract** it, then delete the tarball.
7. Upload `deploy/site-staging/.htaccess`, `_staging/` and `promote/` into `staging.dwaarai.com/`.
8. **Directory Privacy → staging.dwaarai.com**: tick "Password protect", name "DwaarAI staging", and add one user per marketing person plus a user named `promoter` (used only by the AWS server; long random password, kept in the password manager).
9. **Directory Privacy → staging.dwaarai.com/promote**: tick "Password protect", name "Promote to live", and add only the people allowed to promote.

- [ ] **Step 4: Install site-promoter** (the user runs it, because it carries the secrets)

```
! SITE_PROMOTE_SECRET='<secret>' STAGING_USER=promoter STAGING_PASS='<promoter password>' bash deploy/ship-site-promoter.sh
```
Expected tail: `/_site/ answers and refuses unsigned requests` and `landing still up`.

- [ ] **Step 5: Check routes**

`! STAGING_AUTH='<a marketing user>:<password>' bash deploy/site-staging/check-routes.sh`
Expected: every line `same`. For any `DIFF`, fix the matching rule in `deploy/site-staging/.htaccess`, re-upload it, and run again until there are none.

- [ ] **Step 6: Prove the promote end to end**

1. Open `https://staging.dwaarai.com/promote/` in Chrome and sign in (user). Expected: "Staging and the live site are the same. Nothing to promote." If it lists differences instead, they are real differences between the tarball and live (for example files changed on live since step 6); show them to the user before going further.
2. In File Manager, add a file `staging-check.txt` containing `staging works` (user).
3. Reload Promote. Expected: "1 file will change", `New (1) staging-check.txt`. Click **Promote to live**. Expected: the page refreshes, then history shows `Promote by <user> … 1 changed, 0 removed`.
4. Run `curl -s https://dwaarai.com/staging-check.txt`. Expected: `staging works`.
5. Under **Undo**, click **Restore this** on the backup just made. Expected: history shows `Rollback … 0 changed, 1 removed`, and `curl -s -o /dev/null -w '%{http_code}' https://dwaarai.com/staging-check.txt` prints `404`.
6. Delete `staging-check.txt` on staging.

- [ ] **Step 7: Prove the forms**

1. On `https://staging.dwaarai.com/contact-us.html`, submit the form with obviously fake details ("Staging test"). Expected: the success message, and an email in the sales inbox whose subject starts `[STAGING]`. If the form shows an error instead, read `/opt/communitygate/leadmailer/index.js` (read-only) to see what the lead mailer rejects (for example an Origin check), and adjust `lead.php` to satisfy it.
2. Zoho Forms (Task 8 first): submit the quote form on `https://staging.dwaarai.com/gate-automation-cost` with fake details. Expected: the entry in Zoho shows the Referrer URL `https://staging.dwaarai.com/...`. Delete the test lead in Zoho CRM.

- [ ] **Step 8: Stage for commit**

```bash
git add deploy/site-staging/pull-live.sh deploy/site-staging/check-routes.sh
```

---

### Task 8: Zoho and Analytics settings (user, in their own accounts)

No code. Claude can open each page in Chrome and point to the setting; the user clicks Save.

- [ ] **Zoho Forms**: for each form used on the site (`DwaarGateAutomationQuoteRequest`, `DwaarRangeRevealEmailCapture`, `DwaarAIValetBookaDemo`, and any careers form): **Edit → Add Field → Hidden Field**, field type **Referrer URL**, name it "Page". In **Integrations → Zoho CRM**, map "Page" to a Lead field (e.g. a custom "Website page" field). Sales filters leads whose page contains `staging.dwaarai.com`.
- [ ] **Google Analytics 4** (via Google Tag Manager, because GA4's own internal-traffic filter is IP-based and cannot match a hostname): **Triggers → New → Page View, Some Page Views, Page Hostname equals `staging.dwaarai.com`**, name it "Staging pages". On the GA4 Configuration (Google tag) and every GA4 event tag, add it under **Exceptions**. Then **Submit → Publish**.
- [ ] **Search engines**: nothing to do; staging is behind a password and sends `noindex`.

---

## Handover notes for the user (put in the final message, not the repo)

- **Marketing workflow:** edit in cPanel File Manager on `staging.dwaarai.com` → check in the browser → open `staging.dwaarai.com/promote` → **Promote to live**. **Restore this** undoes a promote.
- Files that never move: the valet APK (`apps/`), `install.html`, `scripts/`.
- Nginx rules for pretty URLs live on the AWS box. A brand-new page `foo.html` works as `/foo` on both sides automatically; a new *redirect* still needs a developer (both `.htaccess` and nginx).
- `scripts/*.py` on the live site are publicly downloadable today (`location /` serves any file). Worth moving out of the web root in a later change.
