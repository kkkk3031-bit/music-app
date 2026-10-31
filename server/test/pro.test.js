import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, api, newUser, makeWav, upload } from './helpers.js';

let s, alice, bob;
before(async () => {
  s = await startServer();
  alice = await newUser(s.base, 'alice');
  bob = await newUser(s.base, 'bob');
});
after(() => s.stop());

test('identical uploads reuse the existing track', async () => {
  const wav = makeWav({ title: 'Same' });
  const first = await upload(s.base, alice.token, [{ name: 'a.wav', data: wav }]);
  const second = await upload(s.base, bob.token, [{ name: 'b.wav', data: wav }]);
  assert.equal(second.status, 201, second.text);
  assert.equal(second.json.tracks[0].id, first.json.tracks[0].id);
  assert.deepEqual(second.json.duplicates, [{ file: 'b.wav', trackId: first.json.tracks[0].id }]);
  const list = await api(s.base, 'GET', '/api/tracks', { token: alice.token });
  assert.equal(list.json.filter((t) => t.title === 'Same').length, 1);
});

test('lyrics: owner edits, others read, LRC detected', async () => {
  const up = await upload(s.base, alice.token, [{ name: 'l.wav', data: makeWav({ title: 'Words' }) }]);
  const id = up.json.tracks[0].id;
  assert.equal(up.json.tracks[0].hasLyrics, false);
  const none = await api(s.base, 'GET', `/api/tracks/${id}/lyrics`, { token: bob.token });
  assert.deepEqual(none.json, { lyrics: null, synced: false });

  const forbidden = await api(s.base, 'PUT', `/api/tracks/${id}/lyrics`, { token: bob.token, body: { lyrics: 'x' } });
  assert.equal(forbidden.status, 403);
  const bad = await api(s.base, 'PUT', `/api/tracks/${id}/lyrics`, { token: alice.token, body: { lyrics: 5 } });
  assert.equal(bad.status, 400);

  const lrc = '[00:01.00]Hello\r\n[00:02.50]World';
  const put = await api(s.base, 'PUT', `/api/tracks/${id}/lyrics`, { token: alice.token, body: { lyrics: lrc } });
  assert.deepEqual(put.json, { lyrics: '[00:01.00]Hello\n[00:02.50]World', synced: true });
  const t = await api(s.base, 'GET', `/api/tracks/${id}`, { token: bob.token });
  assert.equal(t.json.hasLyrics, true);

  const plain = await api(s.base, 'PUT', `/api/tracks/${id}/lyrics`, { token: alice.token, body: { lyrics: 'just words' } });
  assert.equal(plain.json.synced, false);
  const cleared = await api(s.base, 'PUT', `/api/tracks/${id}/lyrics`, { token: alice.token, body: { lyrics: '  ' } });
  assert.equal(cleared.json.lyrics, null);
});

test('change password', async () => {
  const u = await newUser(s.base, 'carol');
  const wrong = await api(s.base, 'POST', '/api/me/password', { token: u.token, body: { currentPassword: 'nope', newPassword: 'newpass1' } });
  assert.equal(wrong.status, 403);
  const short = await api(s.base, 'POST', '/api/me/password', { token: u.token, body: { currentPassword: 'secret123', newPassword: '123' } });
  assert.equal(short.status, 400);
  const ok = await api(s.base, 'POST', '/api/me/password', { token: u.token, body: { currentPassword: 'secret123', newPassword: 'newpass1' } });
  assert.equal(ok.status, 204);
  await s.store.flush();
  const oldLogin = await api(s.base, 'POST', '/api/auth/login', { body: { username: 'carol', password: 'secret123' } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await api(s.base, 'POST', '/api/auth/login', { body: { username: 'carol', password: 'newpass1' } });
  assert.equal(newLogin.status, 200);
});

// Pushes a hand-made job so the test controls the source (a local slow server).
function addJob(userId, url) {
  const job = {
    id: `job${Math.random().toString(36).slice(2)}`, userId, url, status: 'queued', progress: 0, bytes: 0, total: 0,
    title: 'slow', error: null, trackId: null, createdAt: Date.now(),
    spec: { kind: 'http', url, allowlist: ['127.0.0.1'], hints: { title: 'slow' }, source: 'link' },
  };
  s.downloader.jobs.unshift(job);
  return job;
}

const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('downloads can be canceled (queued and mid-transfer) and retried', async () => {
  // Never finishes: sends a few bytes then stalls.
  const slow = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': '1000000' });
    res.write(Buffer.alloc(1000));
  });
  await new Promise((r) => slow.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${slow.address().port}/slow.wav`;
  try {
    const queued = addJob(alice.user.id, url);
    const c1 = await api(s.base, 'POST', `/api/downloads/${queued.id}/cancel`, { token: alice.token });
    assert.equal(c1.json.status, 'canceled');
    assert.equal(c1.json.abort, undefined);

    const other = await api(s.base, 'POST', `/api/downloads/${queued.id}/retry`, { token: bob.token });
    assert.equal(other.status, 404);

    const r = await api(s.base, 'POST', `/api/downloads/${queued.id}/retry`, { token: alice.token });
    assert.equal(r.status, 200);
    await waitFor(() => queued.status === 'downloading' && queued.bytes > 0);

    const c2 = await api(s.base, 'POST', `/api/downloads/${queued.id}/cancel`, { token: alice.token });
    assert.equal(c2.status, 200);
    await waitFor(() => queued.status === 'canceled');
    assert.equal(queued.error, null);

    const again = await api(s.base, 'POST', `/api/downloads/${queued.id}/cancel`, { token: alice.token });
    assert.equal(again.status, 409);
  } finally {
    slow.closeAllConnections();
    slow.close();
  }
});

test('health reports package version', async () => {
  const r = await api(s.base, 'GET', '/api/health');
  assert.equal(r.json.version, '0.2.0');
});

test('each user has their own uploads list', async () => {
  const dave = await newUser(s.base, 'dave');
  await upload(s.base, dave.token, [{ name: 'd1.wav', data: makeWav({ title: 'Dave One', seconds: 2 }) }, { name: 'd2.wav', data: makeWav({ title: 'Dave Two', seconds: 3 }) }]);
  const page = await api(s.base, 'GET', '/api/users/DAVE', { token: bob.token });
  assert.equal(page.status, 200);
  assert.equal(page.json.user.username, 'dave');
  assert.equal(page.json.user.passHash, undefined);
  assert.deepEqual(page.json.uploads.map((t) => t.title).sort(), ['Dave One', 'Dave Two']);
  assert.ok(page.json.uploads.every((t) => t.owner.id === dave.user.id));

  const users = await api(s.base, 'GET', '/api/users', { token: bob.token });
  assert.equal(users.json.find((u) => u.username === 'dave').uploadCount, 2);
  assert.equal(users.json.find((u) => u.username === 'bob'), undefined, 'only uploaders are listed');

  const none = await api(s.base, 'GET', '/api/users/bob', { token: alice.token });
  assert.deepEqual(none.json.uploads, []);
  assert.equal((await api(s.base, 'GET', '/api/users/nobody', { token: alice.token })).status, 404);
  assert.equal((await api(s.base, 'GET', '/api/users')).status, 401);
});
