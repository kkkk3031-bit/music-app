// Socket.IO client: listen-together rooms + live download progress.
import { io } from '/socket.io/socket.io.esm.min.js';
import { toast } from './dom.js';
import { emit } from './state.js';

const ROOM_KEY = 'cadence.room';

export class RoomClient extends EventTarget {
  constructor({ token, player, userId }) {
    super();
    this.player = player;
    this.userId = userId;
    this.room = null;
    this.chat = [];
    this.socket = io({ auth: { token }, transports: ['websocket', 'polling'] });

    this.socket.on('connect', async () => {
      await this.syncClock();
      const code = sessionStorage.getItem(ROOM_KEY);
      if (code) this.join(code, { quiet: true });
    });
    this.socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') this.socket.disconnect();
    });
    this.socket.on('room:state', (st) => this.applyState(st));
    this.socket.on('room:chat', (msg) => {
      this.chat.push(msg);
      if (this.chat.length > 200) this.chat.shift();
      this.dispatchEvent(new CustomEvent('chat', { detail: msg }));
    });
    this.socket.on('download:update', (job) => emit('download', job));
  }

  get isHost() {
    return Boolean(this.room && this.room.hostId === this.userId);
  }

  /** NTP-style estimate: keep the sample with the smallest round trip. */
  async syncClock() {
    let best = null;
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const server = await new Promise((r) => this.socket.timeout(3000).emit('time', (err, ts) => r(err ? null : ts)));
      const t1 = Date.now();
      if (server == null) continue;
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: server - (t0 + t1) / 2 };
    }
    if (best) this.player.clockOffset = best.offset;
  }

  call(event, payload = {}) {
    return new Promise((resolve) => {
      this.socket.timeout(8000).emit(event, payload, (err, res) => {
        if (err) res = { ok: false, error: 'Server did not respond' };
        resolve(res);
      });
    });
  }

  async control(event, payload) {
    const res = await this.call(event, payload);
    if (!res.ok) toast(res.error, 'error');
    return res;
  }

  applyState(st) {
    const wasHost = this.isHost;
    this.room = st;
    sessionStorage.setItem(ROOM_KEY, st.code);
    const client = this;
    this.player.enterRoom({
      get isHost() { return client.isHost; },
      control: (ev, p) => client.control(ev, p),
    });
    this.player.syncTo(st.playback);
    if (!wasHost && this.isHost && st.members.length > 0) toast('You are now the host');
    this.dispatchEvent(new Event('state'));
  }

  async create(name) {
    const res = await this.call('room:create', { name });
    if (!res.ok) throw new Error(res.error);
    this.chat = [];
    this.applyState(res.room);
    return res.room;
  }

  async join(code, { quiet = false } = {}) {
    const res = await this.call('room:join', { code });
    if (!res.ok) {
      sessionStorage.removeItem(ROOM_KEY);
      if (!quiet) throw new Error(res.error);
      return null;
    }
    this.chat = res.chat || [];
    this.applyState(res.room);
    this.dispatchEvent(new Event('chat-reset'));
    return res.room;
  }

  async leave() {
    await this.call('room:leave');
    sessionStorage.removeItem(ROOM_KEY);
    this.room = null;
    this.chat = [];
    this.player.leaveRoom();
    this.dispatchEvent(new Event('state'));
  }

  sendChat(text) {
    return this.control('room:chat', { text });
  }

  disconnect() {
    this.socket.disconnect();
  }
}
