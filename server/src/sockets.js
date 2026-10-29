// Socket.IO wiring: auth handshake, per-user channel (download progress) and
// listen-together rooms. Every room event replies through an ack callback:
// { ok: true, ... } or { ok: false, error }.
export function attachSockets({ io, auth, rooms, store, publicTrack }) {
  io.use((socket, next) => {
    const user = auth.verify(socket.handshake.auth?.token || socket.handshake.query?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });

  const snapshot = (room, user) => rooms.snapshot(room, (id) => publicTrack(store.track(id), user));
  // Liked flags are per-viewer, so each socket gets its own snapshot.
  async function broadcast(room) {
    for (const s of await io.in(`room:${room.code}`).fetchSockets()) {
      s.emit('room:state', snapshot(room, store.user(s.data.userId)));
    }
  }

  io.on('connection', (socket) => {
    const user = () => store.user(socket.data.userId);
    socket.join(`user:${socket.data.userId}`);

    function leaveCurrent() {
      const code = socket.data.roomCode;
      if (!code) return;
      socket.leave(`room:${code}`);
      socket.data.roomCode = null;
      const { room, deleted } = rooms.leave(code, socket.id);
      if (room && !deleted) broadcast(room);
    }

    // Wrap a handler: resolve current room, catch errors, reply via ack.
    const on = (event, needsRoom, fn) => {
      socket.on(event, async (payload = {}, ack = () => {}) => {
        if (typeof payload === 'function') [ack, payload] = [payload, {}];
        if (typeof ack !== 'function') ack = () => {};
        try {
          const u = user();
          if (!u) throw new Error('Account no longer exists');
          let room = null;
          if (needsRoom) {
            room = rooms.get(socket.data.roomCode);
            if (!room) throw new Error('You are not in a room');
          }
          const result = await fn({ u, room, payload: payload || {} });
          if (room && rooms.get(room.code)) await broadcast(room);
          ack({ ok: true, ...result });
        } catch (err) {
          ack({ ok: false, error: err.message });
        }
      });
    };

    const trackOrThrow = (id) => {
      if (!store.track(id)) throw new Error('Unknown track');
      return id;
    };

    socket.on('time', (ack) => typeof ack === 'function' && ack(Date.now()));

    on('room:create', false, ({ u, payload }) => {
      leaveCurrent();
      const room = rooms.create(u, payload.name);
      rooms.join(room.code, socket.id, u);
      socket.join(`room:${room.code}`);
      socket.data.roomCode = room.code;
      return { room: snapshot(room, u) };
    });

    on('room:join', false, async ({ u, payload }) => {
      const room = rooms.get(payload.code);
      if (!room) throw new Error('Room not found — check the code');
      if (socket.data.roomCode !== room.code) leaveCurrent();
      rooms.join(room.code, socket.id, u);
      socket.join(`room:${room.code}`);
      socket.data.roomCode = room.code;
      await broadcast(room);
      return { room: snapshot(room, u), chat: room.chat };
    });

    on('room:leave', false, () => {
      leaveCurrent();
      return {};
    });

    on('room:play', true, ({ u, room, payload }) => rooms.play(room, u.id, trackOrThrow(payload.trackId), payload.position));
    on('room:pause', true, ({ u, room, payload }) => rooms.pause(room, u.id, payload.position));
    on('room:resume', true, ({ u, room, payload }) => rooms.resume(room, u.id, payload.position));
    on('room:seek', true, ({ u, room, payload }) => rooms.seek(room, u.id, payload.position));
    on('room:next', true, ({ u, room }) => rooms.next(room, u.id));
    on('room:queue:add', true, ({ u, room, payload }) => rooms.queueAdd(room, u, trackOrThrow(payload.trackId)));
    on('room:queue:remove', true, ({ u, room, payload }) => rooms.queueRemove(room, u.id, payload.id));
    on('room:chat', true, ({ u, room, payload }) => {
      const msg = rooms.chat(room, u, payload.text);
      io.to(`room:${room.code}`).emit('room:chat', msg);
      return {};
    });

    socket.on('disconnect', leaveCurrent);
  });
}
