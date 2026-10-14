import { describe, it, expect } from 'vitest';

/**
 * The preflight has to advertise every verb the routes actually answer.
 *
 * This is not theoretical. The header said "GET, POST, DELETE, OPTIONS" while
 * six routes answered PATCH, so a browser refused the preflight and every
 * PATCH in the admin portal failed before it was sent -- pausing a valet
 * point, saving property details, running a promotion, editing a staff member.
 * Nothing 500s and no request reaches the service, so the server logs are
 * clean and the service tests all pass: the whole failure lives in the
 * browser. curl never reproduces it, because curl does not preflight.
 *
 * Asserted against the route table rather than a hard-coded list, so a seventh
 * verb added tomorrow fails here instead of in somebody's browser.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..');

function allowedMethods() {
  const index = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  const m = /Access-Control-Allow-Methods', '([^']+)'/.exec(index);
  if (!m) throw new Error('no Access-Control-Allow-Methods header found');
  return m[1].split(',').map((s) => s.trim().toUpperCase());
}

function verbsTheRoutesAnswer() {
  const dir = path.join(SRC, 'routes');
  const verbs = new Set();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/router\.(get|post|patch|put|delete)\s*\(/g)) {
      verbs.add(m[1].toUpperCase());
    }
  }
  return [...verbs].sort();
}

describe('CORS preflight', () => {
  it('advertises every verb the routes answer', () => {
    const allowed = allowedMethods();
    const missing = verbsTheRoutesAnswer().filter((v) => !allowed.includes(v));

    expect(missing).toEqual([]);
  });

  it('still allows OPTIONS itself, or no preflight can succeed at all', () => {
    expect(allowedMethods()).toContain('OPTIONS');
  });
});
