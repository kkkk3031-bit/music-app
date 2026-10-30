import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { startServer, api, newUser, makeWav, upload } from './helpers.js';

let s, alice, bob, carol;
before(async () => {
  s = await startServer({ dmLimit: { windowMs: 60_000, max: 5 } });
  alice = await newUser(s.base, 'alice');
  bob = await newUser(s.base, 'bob');
  carol = await newUser(s.base, 'carol');
});
after(() => s.stop());

test('bio: saved, trimmed to 150, shown on profile', async () => {
  const r = await api(s.base, 'PATCH', '/api/me', { token: alice.token, body: { bio: `  ${'x'.repeat(200)}  ` } });
  assert.equal(r.status, 200);
  assert.equal(r.json.bio.length, 150);
  const p = await api(s.base, 'GET', '/api/users/alice', { token: bob.token });
  assert.equal(p.json.user.bio.length, 150);
});

test('follow / unfollow updates counts, lists and home feed', async () => {
  await upload(s.base, alice.token, [{ name: 'f.wav', data: makeWav({ title: 'Followed Song' }) }]);
  const self = await api(s.base, 'POST', '/api/users/bob/follow', { token: bob.token });
  assert.equal(self.status, 400);

  const f = await api(s.base, 'POST', '/api/users/ALICE/follow', { token: bob.token });
  assert.deepEqual(f.json, { followers: 1, isFollowing: true });
  await api(s.base, 'POST', '/api/users/alice/follow', { token: bob.token }); // idempotent
  const p = await api(s.base, 'GET', '/api/users/alice', { token: bob.token });
  assert.equal(p.json.followers, 1);
  assert.equal(p.json.isFollowing, true);
  const mine = await api(s.base, 'GET', '/api/users/bob', { token: alice.token });
  assert.equal(mine.json.following, 1);
  assert.equal(mine.json.followsYou, true);

  const followers = await api(s.base, 'GET', '/api/users/alice/followers', { token: carol.token });
  assert.deepEqual(followers.json.map((u) => u.username), ['bob']);
  const following = await api(s.base, 'GET', '/api/users/bob/following', { token: carol.token });
  assert.deepEqual(following.json.map((u) => u.username), ['alice']);

  const home = await api(s.base, 'GET', '/api/home', { token: bob.token });
  assert.ok(home.json.fromFollowing.some((t) => t.title === 'Followed Song'));
  assert.ok(Array.isArray(home.json.artists));
  const carolHome = await api(s.base, 'GET', '/api/home', { token: carol.token });
  assert.equal(carolHome.json.fromFollowing.length, 0);

  const u = await api(s.base, 'DELETE', '/api/users/alice/follow', { token: bob.token });
  assert.deepEqual(u.json, { followers: 0, isFollowing: false });
  assert.equal((await api(s.base, 'GET', '/api/users/nobody/follow', { token: bob.token })).status, 404);
});

test('direct messages: send, realtime, inbox, unread, privacy', async () => {
  const sock = io(s.base, { auth: { token: bob.token }, transports: ['websocket'] });
  await new Promise((r, j) => { sock.on('connect', r); sock.on('connect_error', j); });
  const got = new Promise((r) => sock.once('dm', r));

  assert.equal((await api(s.base, 'POST', '/api/dms/alice', { token: alice.token, body: { text: 'hi me' } })).status, 400);
  assert.equal((await api(s.base, 'POST', '/api/dms/bob', { token: alice.token, body: { text: '   ' } })).status, 400);
  const sent = await api(s.base, 'POST', '/api/dms/bob', { token: alice.token, body: { text: ' hey bob ' } });
  assert.equal(sent.status, 201, sent.text);
  assert.equal(sent.json.text, 'hey bob');

  const live = await got;
  assert.equal(live.text, 'hey bob');
  assert.equal(live.fromUser.username, 'alice');
  sock.close();

  assert.equal((await api(s.base, 'GET', '/api/dms/unread', { token: bob.token })).json.count, 1);
  const inbox = await api(s.base, 'GET', '/api/dms', { token: bob.token });
  assert.equal(inbox.json.length, 1);
  assert.equal(inbox.json[0].user.username, 'alice');
  assert.equal(inbox.json[0].unread, 1);

  const thread = await api(s.base, 'GET', '/api/dms/alice', { token: bob.token });
  assert.deepEqual(thread.json.messages.map((m) => m.text), ['hey bob']);
  assert.equal((await api(s.base, 'GET', '/api/dms/unread', { token: bob.token })).json.count, 0);

  // carol can't see alice↔bob
  assert.equal((await api(s.base, 'GET', '/api/dms', { token: carol.token })).json.length, 0);
  assert.equal((await api(s.base, 'GET', '/api/dms/alice', { token: carol.token })).json.messages.length, 0);

  const long = await api(s.base, 'POST', '/api/dms/alice', { token: bob.token, body: { text: 'y'.repeat(5000) } });
  assert.equal(long.json.text.length, 2000);
});

test('direct messages are rate limited per user', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await api(s.base, 'POST', '/api/dms/bob', { token: carol.token, body: { text: `m${i}` } });
  assert.equal(last.status, 429);
});
