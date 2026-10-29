// Listen-together rooms. Pure state machine (no sockets) so it can be unit
// tested; sockets.js wires it to Socket.IO.
//
// Playback is described by { trackId, position, playing, at } where `position`
// was the playhead (seconds) at server time `at` (ms). Clients compute the
// live position with expectedPosition() and correct drift against it.
import crypto from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_QUEUE = 200;
const MAX_CHAT = 100;

export function expectedPosition(playback, now) {
  if (!playback || !playback.trackId) return 0;
  if (!playback.playing) return playback.position;
  return playback.position + Math.max(0, now - playback.at) / 1000;
}

function fail(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export class RoomManager {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.rooms = new Map();
  }

  newCode() {
    for (;;) {
      let code = '';
      for (const b of crypto.randomBytes(6)) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (!this.rooms.has(code)) return code;
    }
  }

  create(user, name) {
    const code = this.newCode();
    const room = {
      code,
      name: String(name || `${user.username}'s room`).slice(0, 60),
      hostId: user.id,
      members: new Map(), // socketId -> { userId, username, joinedAt }
      queue: [],
      playback: { trackId: null, position: 0, playing: false, at: this.now() },
      chat: [],
      createdAt: this.now(),
    };
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase().trim()) || null;
  }

  join(code, socketId, user) {
    const room = this.get(code);
    if (!room) throw fail('Room not found');
    if (!room.members.has(socketId)) {
      room.members.set(socketId, { userId: user.id, username: user.username, joinedAt: this.now() });
    }
    return room;
  }

  /** Returns { room, deleted, hostChanged }. Host passes to the longest-present member. */
  leave(code, socketId) {
    const room = this.get(code);
    if (!room || !room.members.delete(socketId)) return { room, deleted: false, hostChanged: false };
    if (room.members.size === 0) {
      this.rooms.delete(room.code);
      return { room, deleted: true, hostChanged: false };
    }
    const hostStillHere = [...room.members.values()].some((m) => m.userId === room.hostId);
    if (!hostStillHere) {
      const next = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      room.hostId = next.userId;
      return { room, deleted: false, hostChanged: true };
    }
    return { room, deleted: false, hostChanged: false };
  }

  assertHost(room, userId) {
    if (room.hostId !== userId) throw fail('Only the host can control playback');
  }

  play(room, userId, trackId, position = 0) {
    this.assertHost(room, userId);
    room.playback = { trackId, position: Math.max(0, Number(position) || 0), playing: true, at: this.now() };
  }

  pause(room, userId, position) {
    this.assertHost(room, userId);
    const pos = position ?? expectedPosition(room.playback, this.now());
    room.playback = { ...room.playback, position: Math.max(0, Number(pos) || 0), playing: false, at: this.now() };
  }

  resume(room, userId, position) {
    this.assertHost(room, userId);
    if (!room.playback.trackId) throw fail('Nothing to resume');
    const pos = position ?? room.playback.position;
    room.playback = { ...room.playback, position: Math.max(0, Number(pos) || 0), playing: true, at: this.now() };
  }

  seek(room, userId, position) {
    this.assertHost(room, userId);
    room.playback = { ...room.playback, position: Math.max(0, Number(position) || 0), at: this.now() };
  }

  /** Advance to the next queued track; stops when the queue is empty. */
  next(room, userId) {
    this.assertHost(room, userId);
    const item = room.queue.shift();
    room.playback = item
      ? { trackId: item.trackId, position: 0, playing: true, at: this.now() }
      : { ...room.playback, position: 0, playing: false, trackId: null, at: this.now() };
  }

  queueAdd(room, user, trackId) {
    if (room.queue.length >= MAX_QUEUE) throw fail('Queue is full');
    room.queue.push({ id: crypto.randomBytes(4).toString('hex'), trackId, addedBy: user.username });
  }

  queueRemove(room, userId, itemId) {
    const i = room.queue.findIndex((q) => q.id === itemId);
    if (i < 0) return;
    const item = room.queue[i];
    const byName = [...room.members.values()].find((m) => m.userId === userId)?.username;
    if (room.hostId !== userId && item.addedBy !== byName) throw fail('You can only remove your own songs');
    room.queue.splice(i, 1);
  }

  chat(room, user, text) {
    const body = String(text || '').trim().slice(0, 500);
    if (!body) throw fail('Empty message');
    const msg = { id: crypto.randomBytes(4).toString('hex'), userId: user.id, username: user.username, text: body, at: this.now() };
    room.chat.push(msg);
    if (room.chat.length > MAX_CHAT) room.chat.splice(0, room.chat.length - MAX_CHAT);
    return msg;
  }

  /** JSON-safe view. resolveTrack(id) → public track or null. */
  snapshot(room, resolveTrack = () => null) {
    const seen = new Map();
    for (const m of room.members.values()) if (!seen.has(m.userId)) seen.set(m.userId, m.username);
    return {
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      members: [...seen].map(([id, username]) => ({ id, username })),
      queue: room.queue.map((q) => ({ ...q, track: resolveTrack(q.trackId) })),
      playback: { ...room.playback, track: room.playback.trackId ? resolveTrack(room.playback.trackId) : null },
      serverTime: this.now(),
    };
  }
}
