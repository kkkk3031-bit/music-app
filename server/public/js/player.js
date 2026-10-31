// Playback engine around a single <audio>. Emits 'change' (track / queue /
// modes changed), 'state' (play/pause), 'time' (progress).
//
// Room mode: when `room` is set, the room is the source of truth. Host actions
// are sent to the server (room.control) and applied when the state comes back;
// members just follow via syncTo().
import { post, streamSrc } from './api.js';
import { toast } from './dom.js';

const DRIFT_TOLERANCE = 1.0; // seconds before a member re-seeks
const VOL_KEY = 'cadence.volume';

export class Player extends EventTarget {
  constructor(audio) {
    super();
    this.audio = audio;
    this.queue = [];
    this.index = -1;
    this.unshuffled = null;
    this.repeat = 'off'; // off | all | one
    this.context = null; // { playlistId? }
    this.room = null; // { isHost, control(event, payload) }
    this.roomPlayback = null;
    this.clockOffset = 0; // serverTime - Date.now()
    this.needsGesture = false;

    const v = Number(localStorage.getItem(VOL_KEY));
    audio.volume = Number.isFinite(v) && localStorage.getItem(VOL_KEY) !== null ? v : 0.8;

    this.preloader = new Audio();
    this.preloader.preload = 'auto';
    this.preloader.muted = true;
    this.preloadedId = null;
    audio.addEventListener('timeupdate', () => {
      this.emit('time');
      this.maybePreload();
    });
    audio.addEventListener('durationchange', () => this.emit('time'));
    audio.addEventListener('play', () => this.emit('state'));
    audio.addEventListener('pause', () => this.emit('state'));
    audio.addEventListener('volumechange', () => {
      localStorage.setItem(VOL_KEY, String(audio.volume));
      this.emit('time');
    });
    audio.addEventListener('ended', () => this.onEnded());
    audio.addEventListener('error', () => {
      if (!audio.getAttribute('src')) return;
      toast(`Can't play "${this.current?.title || 'this track'}"`, 'error');
      if (!this.room && this.index < this.queue.length - 1) setTimeout(() => this.next(), 800);
    });
    this.setupMediaSession();
    setInterval(() => this.room && this.correctDrift(), 2000);
  }

  emit(type) {
    this.dispatchEvent(new Event(type));
  }

  get current() {
    if (this.room) return this.roomPlayback?.track || null;
    return this.queue[this.index] || null;
  }

  get playing() {
    return !this.audio.paused;
  }

  get shuffle() {
    return Boolean(this.unshuffled);
  }

  // ---------- local queue ----------
  playList(tracks, start = 0, context = null) {
    if (!tracks.length) return;
    if (this.room) return this.roomPick(tracks[start]);
    this.unshuffled = null;
    this.queue = [...tracks];
    this.index = start;
    this.context = context;
    this.load(true);
  }

  playTrack(track) {
    this.playList([track], 0);
  }

  addToQueue(track) {
    if (this.room) return this.roomPick(track, true);
    if (this.index < 0) return this.playTrack(track);
    this.queue.push(track);
    this.unshuffled?.push(track);
    toast('Added to queue');
    this.emit('change');
  }

  playNext(track) {
    if (this.room) return this.roomPick(track, true);
    if (this.index < 0) return this.playTrack(track);
    this.queue.splice(this.index + 1, 0, track);
    this.unshuffled?.push(track);
    toast('Playing next');
    this.emit('change');
  }

  removeAt(i) {
    if (i === this.index || i < 0 || i >= this.queue.length) return;
    const [t] = this.queue.splice(i, 1);
    if (this.unshuffled) this.unshuffled.splice(this.unshuffled.indexOf(t), 1);
    if (i < this.index) this.index--;
    this.emit('change');
  }

  move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.queue.length || to >= this.queue.length) return;
    const cur = this.queue[this.index];
    const [t] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, t);
    this.index = this.queue.indexOf(cur);
    this.emit('change');
  }

  jumpTo(i) {
    if (this.room || i < 0 || i >= this.queue.length) return;
    this.index = i;
    this.load(true);
  }

  load(autoplay) {
    const t = this.current;
    if (!t) return;
    this.audio.src = streamSrc(t);
    if (autoplay) this.tryPlay();
    post('/me/played', { trackId: t.id, playlistId: this.context?.playlistId }).catch(() => {});
    this.updateMediaSession();
    this.emit('change');
  }

  // Warm the browser cache for the next song ~20s before this one ends, so
  // the transition starts without a buffering gap.
  maybePreload() {
    if (this.room || this.repeat === 'one') return;
    const left = (this.audio.duration || 0) - this.audio.currentTime;
    if (!(left > 0 && left < 20)) return;
    const nextIdx = this.index < this.queue.length - 1 ? this.index + 1 : this.repeat === 'all' ? 0 : -1;
    const next = this.queue[nextIdx];
    if (!next || next.id === this.preloadedId || next.id === this.current?.id) return;
    this.preloadedId = next.id;
    this.preloader.src = streamSrc(next);
    this.preloader.load();
  }

  tryPlay() {
    const p = this.audio.play();
    p?.then(() => { this.needsGesture = false; this.emit('change'); }).catch((err) => {
      if (err.name === 'NotAllowedError') {
        this.needsGesture = true;
        this.emit('change');
      }
    });
  }

  // ---------- transport ----------
  toggle() {
    if (this.room) {
      if (this.needsGesture) return this.unlock();
      if (!this.room.isHost) return toast('Only the room host controls playback');
      if (!this.roomPlayback?.trackId) return;
      return this.room.control(this.roomPlayback.playing ? 'room:pause' : 'room:resume', { position: this.audio.currentTime });
    }
    if (!this.current) return;
    if (this.audio.paused) this.tryPlay();
    else this.audio.pause();
  }

  next() {
    if (this.room) {
      if (!this.room.isHost) return toast('Only the room host controls playback');
      return this.room.control('room:next');
    }
    if (!this.queue.length) return;
    if (this.index < this.queue.length - 1) this.index++;
    else if (this.repeat === 'all') this.index = 0;
    else return;
    this.load(true);
  }

  prev() {
    if (this.room) return this.seek(0);
    if (this.audio.currentTime > 3 || this.index <= 0) {
      this.audio.currentTime = 0;
      return;
    }
    this.index--;
    this.load(true);
  }

  seek(sec) {
    if (this.room) {
      if (!this.room.isHost) return toast('Only the room host controls playback');
      return this.room.control('room:seek', { position: sec });
    }
    if (Number.isFinite(sec)) this.audio.currentTime = sec;
  }

  setVolume(v) {
    this.audio.volume = Math.min(1, Math.max(0, v));
    this.audio.muted = false;
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this.emit('time');
  }

  toggleShuffle() {
    if (this.room) return;
    const cur = this.current;
    if (this.unshuffled) {
      this.queue = this.unshuffled;
      this.unshuffled = null;
    } else {
      this.unshuffled = [...this.queue];
      const rest = this.queue.filter((_, i) => i !== this.index);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      this.queue = cur ? [cur, ...rest] : rest;
    }
    this.index = cur ? this.queue.indexOf(cur) : -1;
    this.emit('change');
  }

  cycleRepeat() {
    if (this.room) return;
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.emit('change');
  }

  onEnded() {
    if (this.room) {
      if (this.room.isHost) this.room.control('room:next');
      return;
    }
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.tryPlay();
      return;
    }
    if (this.index < this.queue.length - 1 || this.repeat === 'all') this.next();
    else this.emit('state');
  }

  /** Mark a track's liked flag everywhere it appears in the queue. */
  setLiked(id, liked) {
    for (const t of this.queue) if (t.id === id) t.liked = liked;
    if (this.roomPlayback?.track?.id === id) this.roomPlayback.track.liked = liked;
    this.emit('change');
  }

  // ---------- rooms ----------
  enterRoom(room) {
    if (!this.room) this.audio.pause();
    this.room = room;
    this.emit('change');
  }

  leaveRoom() {
    this.room = null;
    this.roomPlayback = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.emit('change');
  }

  roomPick(track, queueOnly = false) {
    if (this.room.isHost && !queueOnly) return this.room.control('room:play', { trackId: track.id, position: 0 });
    this.room.control('room:queue:add', { trackId: track.id }).then((r) => r?.ok && toast('Added to room queue'));
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }

  expected() {
    const pb = this.roomPlayback;
    if (!pb?.trackId) return 0;
    return pb.playing ? pb.position + Math.max(0, this.serverNow() - pb.at) / 1000 : pb.position;
  }

  syncTo(playback) {
    const prevId = this.roomPlayback?.trackId;
    this.roomPlayback = playback;
    if (!playback?.track) {
      this.audio.pause();
      this.emit('change');
      return;
    }
    if (playback.trackId !== prevId || !this.audio.getAttribute('src')) {
      this.audio.src = streamSrc(playback.track);
      const seekWhenReady = () => {
        this.audio.currentTime = this.expected();
        if (this.roomPlayback?.playing) this.tryPlay();
      };
      this.audio.addEventListener('loadedmetadata', seekWhenReady, { once: true });
      this.updateMediaSession();
    } else {
      this.correctDrift(true);
    }
    this.emit('change');
  }

  correctDrift(force = false) {
    const pb = this.roomPlayback;
    if (!pb?.track || this.audio.readyState < 1) return;
    const want = this.expected();
    const diff = Math.abs(this.audio.currentTime - want);
    if (pb.playing) {
      // Small drift is tolerated in the periodic check; explicit state
      // changes (force) snap tighter.
      if (diff > DRIFT_TOLERANCE || (force && diff > 0.35)) this.audio.currentTime = want;
      if (this.audio.paused && !this.needsGesture) this.tryPlay();
    } else {
      if (!this.audio.paused) this.audio.pause();
      if (diff > 0.35) this.audio.currentTime = want;
    }
  }

  unlock() {
    this.needsGesture = false;
    this.correctDrift(true);
    if (this.roomPlayback?.playing) this.tryPlay();
  }

  // ---------- Media Session (OS / lock-screen controls) ----------
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported */ } };
    set('play', () => this.toggle());
    set('pause', () => this.toggle());
    set('nexttrack', () => this.next());
    set('previoustrack', () => this.prev());
    set('seekto', (d) => this.seek(d.seekTime));
  }

  updateMediaSession() {
    const t = this.current;
    if (!('mediaSession' in navigator) || !t) return;
    const art = t.cover ? [{ src: new URL(t.cover, location.href).href, sizes: '512x512' }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork: art });
  }
}
