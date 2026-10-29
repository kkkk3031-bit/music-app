import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { RoomManager, expectedPosition } from '../src/rooms.js';
import { startServer, newUser, makeWav, upload } from './helpers.js';

test('expectedPosition follows the clock only while playing', () => {
  assert.equal(expectedPosition({ trackId: 't', position: 10, playing: true, at: 1000 }, 3500), 12.5);
  assert.equal(expectedPosition({ trackId: 't', position: 10, playing: false, at: 1000 }, 9000), 10);
  assert.equal(expectedPosition({ trackId: null, position: 10, playing: true, at: 0 }, 9000), 0);
});

test('room state machine: host control, queue, host hand-off', () => {
  let now = 0;
  const rm = new RoomManager({ now: () => now });
  const alice = { id: 'a', username: 'alice' };
  const bob = { id: 'b', username: 'bob' };
  const room = rm.create(alice);
  rm.join(room.code, 's1', alice);
  rm.join(room.code.toLowerCase(), 's2', bob);

  assert.throws(() => rm.play(room, 'b', 't1'), /host/);
  rm.play(room, 'a', 't1', 5);
  now = 4000;
  rm.pause(room, 'a');
  assert.equal(room.playback.position, 9);
  assert.equal(room.playback.playing, false);
  rm.resume(room, 'a');
  rm.seek(room, 'a', 30);
  now = 5000;
  assert.equal(expectedPosition(room.playback, now), 31);

  rm.queueAdd(room, bob, 't2');
  rm.queueAdd(room, alice, 't3');
  assert.throws(() => rm.queueRemove(room, 'b', room.queue[1].id), /own/);
  rm.next(room, 'a');
  assert.equal(room.playback.trackId, 't2');
  assert.equal(room.queue.length, 1);

  const msg = rm.chat(room, bob, '  hi  ');
  assert.equal(msg.text, 'hi');
  assert.throws(() => rm.chat(room, bob, '   '));

  const r1 = rm.leave(room.code, 's1');
  assert.equal(r1.hostChanged, true);
  assert.equal(room.hostId, 'b');
  const r2 = rm.leave(room.code, 's2');
  assert.equal(r2.deleted, true);
  assert.equal(rm.get(room.code), null);
});

let s, alice, bob, trackId;
before(async () => {
  s = await startServer();
  alice = await newUser(s.base, 'alice');
  bob = await newUser(s.base, 'bob');
  trackId = (await upload(s.base, alice.token, [{ name: 'a.wav', data: makeWav() }])).json.tracks[0].id;
});
after(() => s.stop());

const client = (token) => new Promise((resolve, reject) => {
  const c = connect(s.base, { auth: { token }, transports: ['websocket'], forceNew: true });
  c.on('connect', () => resolve(c));
  c.on('connect_error', reject);
});
const emit = (c, ev, payload) => new Promise((r) => c.emit(ev, payload, r));
const nextState = (c, pred = () => true) => new Promise((r) => {
  const h = (st) => { if (pred(st)) { c.off('room:state', h); r(st); } };
  c.on('room:state', h);
});

test('sockets: bad token is rejected', async () => {
  await assert.rejects(client('nope'), /unauthorized/);
});

test('sockets: two listeners stay in sync and chat', async () => {
  const a = await client(alice.token);
  const b = await client(bob.token);
  try {
    const created = await emit(a, 'room:create', { name: 'Party' });
    assert.equal(created.ok, true);
    const code = created.room.code;

    const joined = await emit(b, 'room:join', { code: code.toLowerCase() });
    assert.equal(joined.ok, true);
    assert.equal(joined.room.members.length, 2);

    const denied = await emit(b, 'room:play', { trackId });
    assert.equal(denied.ok, false);

    const playing = nextState(b, (st) => st.playback.playing);
    assert.equal((await emit(a, 'room:play', { trackId, position: 0 })).ok, true);
    const st = await playing;
    assert.equal(st.playback.track.id, trackId);
    assert.ok(Math.abs(st.serverTime - Date.now()) < 2000);

    const chatMsg = new Promise((r) => b.once('room:chat', r));
    await emit(a, 'room:chat', { text: 'hello room' });
    assert.equal((await chatMsg).text, 'hello room');

    const handoff = nextState(b, (st2) => st2.members.length === 1);
    a.disconnect();
    assert.equal((await handoff).hostId, bob.user.id);
  } finally {
    a.disconnect();
    b.disconnect();
  }
});
