import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isProtected, checkPath, STAGING_ONLY } from './policy.js';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// What the live folder's website is: everything except other deploys' files,
// staging's own folders, and dotfiles. Promote and rollback only ever see,
// change or delete this set. A file staging could never hold (odd name, a type
// the policy refuses) is not part of it either, or every promote would delete it.
// Directories (trailing slash) are only probed, never path-checked.
export const liveSkip = (rel) =>
  isProtected(rel) ||
  STAGING_ONLY.some((x) => rel.startsWith(x)) ||
  rel.split('/').some((s) => s.startsWith('.')) ||
  (!rel.endsWith('/') && checkPath(rel) !== null);

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
