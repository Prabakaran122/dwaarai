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
