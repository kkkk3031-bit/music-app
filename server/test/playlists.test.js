import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, newUser, makeWav, upload } from './helpers.js';

let s, alice, bob, ids;
before(async () => {
  s = await startServer();
  alice = await newUser(s.base, 'alice');
  bob = await newUser(s.base, 'bob');
  const r = await upload(s.base, alice.token, ['A', 'B', 'C'].map((t) => ({ name: `${t}.wav`, data: makeWav({ title: t }) })));
  ids = r.json.tracks.map((t) => t.id);
});
after(() => s.stop());

test('playlist lifecycle', async () => {
  const p = (await api(s.base, 'POST', '/api/playlists', { token: alice.token, body: { name: 'Mix' } })).json;
  assert.equal(p.name, 'Mix');

  let r = await api(s.base, 'POST', `/api/playlists/${p.id}/tracks`, { token: alice.token, body: { trackIds: ids } });
  assert.deepEqual(r.json.tracks.map((t) => t.title), ['A', 'B', 'C']);
  r = await api(s.base, 'POST', `/api/playlists/${p.id}/tracks`, { token: alice.token, body: { trackId: ids[0] } });
  assert.equal(r.json.trackCount, 4, 'duplicates allowed');

  r = await api(s.base, 'PUT', `/api/playlists/${p.id}/tracks`, { token: alice.token, body: { trackIds: [ids[2], ids[0], ids[1], ids[0]] } });
  assert.deepEqual(r.json.tracks.map((t) => t.title), ['C', 'A', 'B', 'A']);

  r = await api(s.base, 'PUT', `/api/playlists/${p.id}/tracks`, { token: alice.token, body: { trackIds: [ids[2], ids[0], ids[1], ids[1]] } });
  assert.equal(r.status, 400, 'reorder must be a permutation');

  r = await api(s.base, 'DELETE', `/api/playlists/${p.id}/tracks/3`, { token: alice.token });
  assert.deepEqual(r.json.tracks.map((t) => t.title), ['C', 'A', 'B']);
  assert.equal((await api(s.base, 'DELETE', `/api/playlists/${p.id}/tracks/9`, { token: alice.token })).status, 400);

  r = await api(s.base, 'PATCH', `/api/playlists/${p.id}`, { token: alice.token, body: { name: 'Renamed', description: 'hi' } });
  assert.equal(r.json.name, 'Renamed');

  // Bob can view but not edit.
  assert.equal((await api(s.base, 'GET', `/api/playlists/${p.id}`, { token: bob.token })).status, 200);
  assert.equal((await api(s.base, 'PATCH', `/api/playlists/${p.id}`, { token: bob.token, body: { name: 'x' } })).status, 403);
  assert.equal((await api(s.base, 'POST', `/api/playlists/${p.id}/tracks`, { token: bob.token, body: { trackId: ids[0] } })).status, 403);
  assert.equal((await api(s.base, 'DELETE', `/api/playlists/${p.id}`, { token: bob.token })).status, 403);

  // Cover: real PNG accepted, fake image rejected.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c10000000049454e44ae426082', 'hex');
  let fd = new FormData();
  fd.append('image', new Blob([png], { type: 'image/png' }), 'c.png');
  r = await api(s.base, 'POST', `/api/playlists/${p.id}/cover`, { token: alice.token, body: fd });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.cover, /^\/images\/.+\.png$/);
  assert.equal((await fetch(s.base + r.json.cover)).status, 200);
  fd = new FormData();
  fd.append('image', new Blob(['<svg onload=alert(1)>'], { type: 'image/png' }), 'c.png');
  assert.equal((await api(s.base, 'POST', `/api/playlists/${p.id}/cover`, { token: alice.token, body: fd })).status, 415);

  const mine = await api(s.base, 'GET', '/api/playlists', { token: alice.token });
  assert.equal(mine.json.length, 1);
  const search = await api(s.base, 'GET', '/api/search?q=renamed&sources=local', { token: bob.token });
  assert.equal(search.json.playlists[0].id, p.id);

  assert.equal((await api(s.base, 'DELETE', `/api/playlists/${p.id}`, { token: alice.token })).status, 204);
  assert.equal((await api(s.base, 'GET', `/api/playlists/${p.id}`, { token: alice.token })).status, 404);
});
