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
    if (typeof p === 'string' && isProtected(p)) { errors.push(`${p}: managed by the app deploy, not the website`); continue; }
    const why = checkPath(p);
    if (why) { errors.push(`${p}: ${why}`); continue; }
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
