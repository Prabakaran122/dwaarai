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

test('the live view also leaves out staging-only folders', async () => {
  const root = await tree({
    'index.html': 'home', '_staging/x.php': 'p', 'promote/y.txt': 'q', 'cgi-bin/z.cgi': 'c',
  });
  const paths = (await buildManifest(root, { skip: liveSkip })).map((f) => f.path);
  assert.deepEqual(paths, ['index.html']);
});

test('symlinks are ignored, so nothing outside the folder is ever read', async () => {
  const root = await tree({ 'index.html': 'home' });
  await fs.symlink('/etc/hosts', path.join(root, 'hosts.txt'));
  assert.deepEqual((await buildManifest(root)).map((f) => f.path), ['index.html']);
});
