import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api } from './helpers.js';

let s;
before(async () => { s = await startServer({ authLimit: { windowMs: 60_000, max: 8 } }); });
after(() => s.stop());

test('register, login, me', async () => {
  const r = await api(s.base, 'POST', '/api/auth/register', { body: { username: 'alice', password: 'secret123' } });
  assert.equal(r.status, 201);
  assert.ok(r.json.token);
  assert.equal(r.json.user.username, 'alice');
  assert.equal(r.json.user.passHash, undefined);

  const dup = await api(s.base, 'POST', '/api/auth/register', { body: { username: 'ALICE', password: 'secret123' } });
  assert.equal(dup.status, 409);

  const bad = await api(s.base, 'POST', '/api/auth/login', { body: { username: 'alice', password: 'nope-nope' } });
  assert.equal(bad.status, 401);

  const ok = await api(s.base, 'POST', '/api/auth/login', { body: { username: 'Alice', password: 'secret123' } });
  assert.equal(ok.status, 200);

  const me = await api(s.base, 'GET', '/api/me', { token: ok.json.token });
  assert.equal(me.json.username, 'alice');
});

test('validation and unauthenticated access', async () => {
  const short = await api(s.base, 'POST', '/api/auth/register', { body: { username: 'ab', password: 'secret123' } });
  assert.equal(short.status, 400);
  const weird = await api(s.base, 'POST', '/api/auth/register', { body: { username: 'bob<script>', password: 'secret123' } });
  assert.equal(weird.status, 400);
  const pw = await api(s.base, 'POST', '/api/auth/register', { body: { username: 'bobby', password: '123' } });
  assert.equal(pw.status, 400);
  assert.equal((await api(s.base, 'GET', '/api/me')).status, 401);
  assert.equal((await api(s.base, 'GET', '/api/me', { token: 'garbage' })).status, 401);
  assert.equal((await api(s.base, 'GET', '/api/health')).status, 200);
});

test('auth endpoints are rate limited', async () => {
  let last;
  for (let i = 0; i < 10; i++) last = await api(s.base, 'POST', '/api/auth/login', { body: { username: 'x', password: 'y' } });
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
});
