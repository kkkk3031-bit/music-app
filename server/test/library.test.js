import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, newUser, makeWav, upload } from './helpers.js';

let s, alice, bob, track;
before(async () => {
  s = await startServer();
  alice = await newUser(s.base, 'alice');
  bob = await newUser(s.base, 'bob');
});
after(() => s.stop());

test('upload reads tags and lists the track', async () => {
  const r = await upload(s.base, alice.token, [{ name: 'tone.wav', data: makeWav({ title: 'Sine', artist: 'Osc', album: 'Waves', seconds: 2 }) }]);
  assert.equal(r.status, 201, r.text);
  track = r.json.tracks[0];
  assert.equal(track.title, 'Sine');
  assert.equal(track.artist, 'Osc');
  assert.equal(track.album, 'Waves');
  assert.equal(track.duration, 2);
  const list = await api(s.base, 'GET', '/api/tracks', { token: bob.token });
  assert.equal(list.json.length, 1);
  const albums = await api(s.base, 'GET', '/api/albums', { token: bob.token });
  assert.equal(albums.json[0].album, 'Waves');
  const album = await api(s.base, 'GET', `/api/albums/${albums.json[0].key}`, { token: bob.token });
  assert.equal(album.json.tracks.length, 1);
  const artist = await api(s.base, 'GET', '/api/artists/Osc', { token: bob.token });
  assert.equal(artist.json.tracks[0].id, track.id);
});

test('rejects non-audio content even with an audio extension', async () => {
  const r = await upload(s.base, alice.token, [{ name: 'fake.mp3', data: Buffer.from('<html>not audio</html>'), type: 'audio/mpeg' }]);
  assert.equal(r.status, 415);
  assert.equal(r.json.errors.length, 1);
  const r2 = await upload(s.base, alice.token, [{ name: 'evil.exe', data: Buffer.from('MZ'), type: 'application/octet-stream' }]);
  assert.equal(r2.status, 400);
});

test('streams with HTTP Range (206)', async () => {
  const full = await fetch(`${s.base}${track.streamUrl}?t=${alice.token}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const size = Number(full.headers.get('content-length'));
  await full.arrayBuffer();

  const part = await fetch(`${s.base}${track.streamUrl}`, { headers: { authorization: `Bearer ${alice.token}`, range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${size}`);
  assert.equal((await part.arrayBuffer()).byteLength, 100);

  const noAuth = await fetch(`${s.base}${track.streamUrl}`);
  assert.equal(noAuth.status, 401);
});

test('no path traversal through static or track routes', async () => {
  for (const p of ['/covers/..%2fdb.json', '/covers/../db.json', '/images/..%2f..%2fdb.json', '/covers/%2e%2e/secret.key']) {
    const r = await fetch(s.base + p);
    const body = await r.text();
    assert.ok(!body.includes('passHash') && !/^[0-9a-f]{96}$/.test(body.trim()), `${p} leaked data`);
  }
  const r = await api(s.base, 'GET', '/api/tracks/..%2f..%2fdb.json/stream', { token: alice.token });
  assert.equal(r.status, 404);
});

test('likes, recents and home', async () => {
  assert.equal((await api(s.base, 'PUT', `/api/tracks/${track.id}/like`, { token: bob.token })).status, 200);
  const likes = await api(s.base, 'GET', '/api/me/likes', { token: bob.token });
  assert.equal(likes.json[0].id, track.id);
  assert.equal(likes.json[0].liked, true);
  await api(s.base, 'POST', '/api/me/played', { token: bob.token, body: { trackId: track.id } });
  const home = await api(s.base, 'GET', '/api/home', { token: bob.token });
  assert.equal(home.json.recentlyPlayed[0].id, track.id);
  assert.equal(home.json.likedCount, 1);
});

test('remote tracks only accept allowlisted https hosts', async () => {
  const bad = await api(s.base, 'POST', '/api/tracks/remote', { token: bob.token, body: { source: 'archive', url: 'http://127.0.0.1/x.mp3', title: 'x' } });
  assert.equal(bad.status, 400);
  const evil = await api(s.base, 'POST', '/api/tracks/remote', { token: bob.token, body: { source: 'archive', url: 'https://archive.org.evil.com/x.mp3' } });
  assert.equal(evil.status, 400);
  const ok = await api(s.base, 'POST', '/api/tracks/remote', { token: bob.token, body: { source: 'archive', url: 'https://archive.org/download/x/y.mp3', title: 'Y', cover: 'https://evil.com/c.jpg' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.cover, null);
  const again = await api(s.base, 'POST', '/api/tracks/remote', { token: bob.token, body: { source: 'archive', url: 'https://archive.org/download/x/y.mp3' } });
  assert.equal(again.json.id, ok.json.id);
});

test('downloader refuses private addresses', async () => {
  for (const url of ['http://127.0.0.1:3020/api/health', 'http://localhost/x.mp3', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'not a url']) {
    const r = await api(s.base, 'POST', '/api/downloads', { token: bob.token, body: { url } });
    assert.equal(r.status, 400, `${url} → ${r.status} ${r.text}`);
  }
});

test('only the uploader can delete; delete cleans references', async () => {
  assert.equal((await api(s.base, 'DELETE', `/api/tracks/${track.id}`, { token: bob.token })).status, 403);
  assert.equal((await api(s.base, 'DELETE', `/api/tracks/${track.id}`, { token: alice.token })).status, 204);
  const likes = await api(s.base, 'GET', '/api/me/likes', { token: bob.token });
  assert.equal(likes.json.length, 0);
  assert.equal((await api(s.base, 'GET', `/api/tracks/${track.id}/stream`, { token: alice.token })).status, 404);
});
