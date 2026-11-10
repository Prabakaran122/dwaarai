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
