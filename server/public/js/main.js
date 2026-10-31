import { h, icon, iconBtn, fmtTime, coverEl, avatarEl, toast, toastError, clear, menu, prompt, setRangeFill } from './dom.js';
import { get, post, session, setUnauthorizedHandler } from './api.js';
import { state, on, emit, refreshPlaylists } from './state.js';
import { Player } from './player.js';
import { RoomClient } from './rooms.js';
import { likeButton, makeSortable, markPlaying, createPlaylist, trackMenu, parseLrc, editLyrics } from './components.js';
import * as V from './views.js';

const $ = (id) => document.getElementById(id);
const NAV = [
  ['home', 'Home', '#/home'],
  ['search', 'Search', '#/search'],
  ['library', 'Your Library', '#/library'],
  ['rooms', 'Rooms', '#/rooms'],
  ['upload', 'Import', '#/import'],
];

// ---------------------------------------------------------------- auth screen
function showAuth(mode = 'login') {
  $('shell').hidden = true;
  const root = $('auth');
  root.hidden = false;
  const user = h('input', { class: 'input', name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 24, autofocus: true });
  const pass = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minlength: 6 });
  const err = h('div', { class: 'form-error' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? 'Log in' : 'Create account');
  clear(root).append(h('div', { class: 'auth-card' },
    h('div', { class: 'brand' }, h('img', { src: '/img/logo.svg', alt: '' }), h('span', {}, 'Cadence')),
    h('p', {}, mode === 'login' ? 'Welcome back. Your music is waiting.' : 'Create an account to start listening.'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      err.textContent = '';
      try {
        const r = await post(`/auth/${mode === 'login' ? 'login' : 'register'}`, { username: user.value, password: pass.value });
        session.set(r.token, r.user);
        root.hidden = true;
        boot();
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
      }
    } },
      h('label', {}, 'Username', user),
      h('label', {}, 'Password', pass),
      err, btn),
    h('div', { class: 'switch' }, mode === 'login' ? 'New here? ' : 'Have an account? ',
      h('button', { type: 'button', onclick: () => showAuth(mode === 'login' ? 'register' : 'login') }, mode === 'login' ? 'Create an account' : 'Log in'))));
  setTimeout(() => user.focus());
}

function logout() {
  state.rooms?.disconnect();
  state.player?.leaveRoom();
  session.clear();
  sessionStorage.clear();
  location.hash = '#/home';
  location.reload();
}

// ---------------------------------------------------------------- shell
function renderNav() {
  const route = (location.hash.slice(2).split(/[/?]/)[0]) || 'home';
  const active = (k) => k === route || (k === 'library' && ['playlist', 'album', 'artist', 'liked', 'user'].includes(route)) || (k === 'rooms' && route === 'room') || (k === 'upload' && route === 'import');
  const make = (cls) => NAV.map(([k, label, href]) => h('a', { href, class: active(k) ? 'active' : '', 'aria-current': active(k) ? 'page' : null }, icon(k), h('span', {}, cls === 'bottom' && k === 'library' ? 'Library' : label)));
  clear($('nav')).append(...make('side'));
  clear($('bottom-nav')).append(...make('bottom'));
  $('sidebar-playlists').querySelectorAll('.side-pl').forEach((a) => a.classList.toggle('active', location.hash === a.getAttribute('href')));
}

function renderSidebarPlaylists() {
  const el = clear($('sidebar-playlists'));
  el.append(h('a', { class: 'side-pl', href: '#/liked' }, h('div', { class: 'cover liked-cover' }, icon('heartFill')), h('div', { class: 'meta' }, h('div', { class: 'name' }, 'Liked Songs'), h('div', { class: 'sub' }, 'Playlist'))));
  for (const p of state.playlists) {
    el.append(h('a', { class: 'side-pl', href: `#/playlist/${p.id}` }, coverEl(p.cover), h('div', { class: 'meta' }, h('div', { class: 'name' }, p.name), h('div', { class: 'sub' }, `${p.trackCount} songs`))));
  }
  renderNav();
}

function renderUserChip() {
  const chip = clear($('user-chip'));
  chip.append(avatarEl(state.user), h('span', {}, state.user.username), icon('chevronDown'));
  chip.onclick = () => menu(chip, [
    { label: 'Your profile', icon: 'user', onClick: () => (location.hash = `#/user/${encodeURIComponent(state.user.username)}`) },
    { label: 'Messages', icon: 'message', onClick: () => (location.hash = '#/messages') },
    { label: 'Account settings', icon: 'edit', onClick: () => (location.hash = '#/profile') },
    { label: 'Log out', icon: 'logout', onClick: logout },
  ]);
}

// Instagram-style DM button in the top bar with an unread badge.
async function refreshUnread() {
  const btn = $('dm-btn');
  try {
    const { count } = await get('/dms/unread');
    const badge = btn.querySelector('.badge');
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.hidden = !count;
    btn.setAttribute('aria-label', count ? `Messages, ${count} unread` : 'Messages');
  } catch { /* offline: keep the old count */ }
}

function setupMessages() {
  const btn = $('dm-btn');
  btn.append(icon('message'), h('span', { class: 'badge', hidden: true }));
  on('dm', (e) => {
    const m = e.detail;
    const chatOpen = location.hash === `#/messages/${encodeURIComponent(m.fromUser?.username || '')}`;
    if (m.from !== state.user.id && !chatOpen) toast(`${m.fromUser.username}: ${m.text.slice(0, 80)}`);
    refreshUnread();
  });
  on('dm:seen', refreshUnread);
  on('dm:read', refreshUnread);
  refreshUnread();
}

function renderRoomBadge() {
  const badge = $('room-badge');
  const room = state.rooms?.room;
  badge.hidden = !room;
  if (!room) return;
  clear(badge).append(h('span', { class: 'dot' }), h('a', { href: `#/room/${room.code}` }, `Room ${room.code}`, h('span', { class: 'hide-sm' }, ` · ${room.members.length} listening`)));
}

// ---------------------------------------------------------------- player bar
function buildPlayerBar() {
  const p = state.player;
  const bar = $('player');
  const seek = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Seek' });
  const cur = h('span', {}, '0:00');
  const dur = h('span', {}, '0:00');
  const vol = h('input', { type: 'range', class: 'vol', min: 0, max: 1, step: 0.01, value: p.audio.volume, 'aria-label': 'Volume' });
  const mini = h('div');
  let seeking = false;

  seek.addEventListener('input', () => { seeking = true; cur.textContent = fmtTime(Number(seek.value)); setRangeFill(seek); });
  seek.addEventListener('change', () => { seeking = false; p.seek(Number(seek.value)); });
  vol.addEventListener('input', () => { p.setVolume(Number(vol.value)); setRangeFill(vol); });

  const nowEl = h('div', { class: 'p-now' });
  const playBtn = h('button', { class: 'p-play', 'aria-label': 'Play', onclick: () => p.toggle() }, icon('play'));
  const playBtnMobile = iconBtn('play', 'Play', () => p.toggle());
  const shuffleBtn = iconBtn('shuffle', 'Shuffle', () => p.toggleShuffle());
  const repeatBtn = iconBtn('repeat', 'Repeat', () => p.cycleRepeat());
  const prevBtn = iconBtn('prev', 'Previous', () => p.prev());
  const nextBtn = iconBtn('next', 'Next', () => p.next());
  const muteBtn = iconBtn('volume', 'Mute', () => p.toggleMute(), 'hide-sm');
  const queueBtn = iconBtn('queue', 'Queue', () => toggleQueue(), 'hide-sm');
  const syncNote = h('div', { class: 'sync-note' });

  bar.append(
    nowEl,
    h('div', { class: 'p-center' },
      h('div', { class: 'p-controls' }, shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn),
      h('div', { class: 'p-seek' }, cur, seek, dur),
      syncNote),
    h('div', { class: 'p-right' }, playBtnMobile, queueBtn, muteBtn, vol, iconBtn('chevronDown', 'Now playing', () => openNowPlaying(), 'hide-sm np-open')),
    h('div', { class: 'mini-progress' }, mini));
  bar.querySelector('.np-open svg').style.transform = 'rotate(180deg)';
  playBtnMobile.style.display = 'none';
  const mq = matchMedia('(max-width: 760px)');
  const applyMq = () => (playBtnMobile.style.display = mq.matches ? '' : 'none');
  mq.addEventListener('change', applyMq);
  applyMq();

  const renderNow = () => {
    const t = p.current;
    clear(nowEl);
    if (!t) return nowEl.append(h('div', { class: 'muted', style: { paddingLeft: '8px' } }, p.room ? 'Room is quiet' : 'Pick something to play'));
    nowEl.append(
      h('div', { onclick: openNowPlaying }, coverEl(t.cover)),
      h('div', { class: 't-text', onclick: () => matchMedia('(max-width: 760px)').matches && openNowPlaying() },
        h('div', { class: 't-title', onclick: (e) => { if (!matchMedia('(max-width: 760px)').matches && t.type === 'local') { e.stopPropagation(); location.hash = `#/artist/${encodeURIComponent(t.artist)}`; } } }, t.title),
        h('div', { class: 't-artist' }, t.artist)),
      likeButton(t));
  };

  const onChange = () => {
    renderNow();
    const room = p.room;
    const ctl = !room || room.isHost;
    shuffleBtn.disabled = Boolean(room);
    repeatBtn.disabled = Boolean(room);
    prevBtn.disabled = !ctl;
    nextBtn.disabled = !ctl;
    seek.disabled = !ctl;
    shuffleBtn.classList.toggle('on', p.shuffle);
    repeatBtn.classList.toggle('on', p.repeat !== 'off');
    repeatBtn.title = `Repeat: ${p.repeat}`;
    repeatBtn.replaceChildren(icon('repeat'));
    if (p.repeat === 'one') repeatBtn.append(h('span', { style: { position: 'absolute', fontSize: '9px', fontWeight: 800, marginTop: '1px' } }, '1'));
    repeatBtn.style.position = 'relative';
    syncNote.textContent = room ? (p.needsGesture ? 'Tap ▶ to join room playback' : room.isHost ? 'You are hosting · everyone hears this' : 'Synced to room host') : '';
    renderRoomBadge();
    markPlaying(document);
    onState();
    renderQueue();
  };
  const onState = () => {
    const playing = p.playing;
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    playBtnMobile.replaceChildren(icon(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    document.querySelectorAll('.track.playing .eq').forEach((e) => e.classList.toggle('paused', !playing));
    document.title = p.current ? `${p.current.title} · ${p.current.artist}` : 'Cadence';
  };
  const onTime = () => {
    const d = p.audio.duration || p.current?.duration || 0;
    seek.max = d || 1;
    if (!seeking) {
      seek.value = p.audio.currentTime;
      cur.textContent = fmtTime(p.audio.currentTime);
    }
    dur.textContent = fmtTime(d);
    setRangeFill(seek);
    mini.style.width = `${d ? (p.audio.currentTime / d) * 100 : 0}%`;
    vol.value = p.audio.muted ? 0 : p.audio.volume;
    setRangeFill(vol);
    muteBtn.replaceChildren(icon(p.audio.muted || p.audio.volume === 0 ? 'mute' : 'volume'));
  };
  p.addEventListener('change', onChange);
  p.addEventListener('state', onState);
  p.addEventListener('time', onTime);
  onChange();
  onTime();

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'Space') { e.preventDefault(); p.toggle(); }
    else if (e.key === 'ArrowRight' && e.shiftKey) p.next();
    else if (e.key === 'ArrowLeft' && e.shiftKey) p.prev();
    else if (e.key === 'ArrowRight' && !p.room) p.seek(p.audio.currentTime + 5);
    else if (e.key === 'ArrowLeft' && !p.room) p.seek(Math.max(0, p.audio.currentTime - 5));
    else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); p.setVolume(Math.min(1, p.audio.volume + 0.05)); }
    else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); p.setVolume(Math.max(0, p.audio.volume - 0.05)); }
    else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) p.toggleMute();
  });
}

// ---------------------------------------------------------------- queue panel
function toggleQueue(force) {
  const panel = $('queue-panel');
  panel.hidden = force !== undefined ? !force : !panel.hidden;
  renderQueue();
}

function renderQueue() {
  const panel = $('queue-panel');
  if (panel.hidden) return;
  const p = state.player;
  clear(panel).append(h('div', { class: 'row' }, h('h3', { style: { flex: 1 } }, p.room ? 'Room queue' : 'Queue'), iconBtn('close', 'Close queue', () => toggleQueue(false))));

  if (p.room) {
    const st = state.rooms.room;
    if (p.current) panel.append(h('div', { class: 'label' }, 'Now playing'), qRow(p.current, true));
    panel.append(h('div', { class: 'label' }, 'Up next'));
    if (!st?.queue.length) panel.append(h('p', { class: 'muted' }, 'Nothing queued.'));
    st?.queue.forEach((q) => q.track && panel.append(qRow(q.track, false, null, q.addedBy)));
    return;
  }
  if (!p.current) {
    panel.append(h('p', { class: 'muted' }, 'Your queue is empty.'));
    return;
  }
  panel.append(h('div', { class: 'label' }, 'Now playing'), qRow(p.current, true));
  const upNext = p.queue.slice(p.index + 1);
  const list = h('div');
  panel.append(h('div', { class: 'label' }, upNext.length ? `Next up · ${upNext.length}` : 'Next up'), list);
  if (!upNext.length) list.append(h('p', { class: 'muted' }, p.repeat === 'all' ? 'Queue will repeat.' : 'Nothing after this song.'));
  upNext.forEach((t, k) => list.append(qRow(t, false, p.index + 1 + k)));
  makeSortable(list, '.q-item', '.drag-handle', (from, to) => p.move(p.index + 1 + from, p.index + 1 + to));
  if (p.index > 0) {
    panel.append(h('div', { class: 'label' }, 'Played'));
    p.queue.slice(0, p.index).forEach((t, k) => panel.append(qRow(t, false, k)));
  }
}

function qRow(t, current, index = null, addedBy = null) {
  const p = state.player;
  return h('div', { class: `q-item${current ? ' current' : ''}` },
    index !== null && index > p.index ? h('span', { class: 'drag-handle' }, icon('drag')) : h('span'),
    coverEl(t.cover),
    h('div', { class: 't-text', onclick: () => index !== null && p.jumpTo(index) },
      h('div', { class: 't-title' }, t.title),
      h('div', { class: 't-artist' }, addedBy ? `${t.artist} · ${addedBy}` : t.artist)),
    index !== null && !current ? iconBtn('close', 'Remove from queue', () => p.removeAt(index), 'small') : h('span'));
}

// ---------------------------------------------------------------- now playing
function openNowPlaying() {
  const p = state.player;
  if (!p.current) return;
  const el = $('now-playing');
  el.hidden = false;
  const seek = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Seek' });
  const cur = h('span', {}, '0:00');
  const dur = h('span', {}, '0:00');
  let seeking = false;
  seek.addEventListener('input', () => { seeking = true; cur.textContent = fmtTime(Number(seek.value)); setRangeFill(seek); });
  seek.addEventListener('change', () => { seeking = false; p.seek(Number(seek.value)); });
  const bg = h('div', { class: 'np-bg' });
  const coverWrap = h('div');
  const info = h('div', { class: 'np-info' });
  const playBtn = h('button', { class: 'p-play', 'aria-label': 'Play/pause', onclick: () => p.toggle() });
  const shuffle = iconBtn('shuffle', 'Shuffle', () => p.toggleShuffle());
  const repeat = iconBtn('repeat', 'Repeat', () => p.cycleRepeat());
  // Lyrics replace the cover while toggled on; synced (LRC) lines follow playback.
  let showLyrics = false;
  let lyrics = { trackId: null, text: null, lines: [] };
  const lyricsBtn = iconBtn('lyrics', 'Lyrics', () => { showLyrics = !showLyrics; render(); });
  const loadLyrics = async (t) => {
    if (lyrics.trackId === t.id) return;
    lyrics = { trackId: t.id, text: null, lines: [], loading: true };
    try {
      const r = await get(`/tracks/${t.id}/lyrics`);
      if (lyrics.trackId !== t.id) return;
      lyrics = { trackId: t.id, text: r.lyrics, lines: r.synced ? parseLrc(r.lyrics) : [] };
    } catch {
      lyrics = { trackId: t.id, text: null, lines: [] };
    }
    if (showLyrics) render();
  };
  const lyricsPanel = (t) => {
    const mine = t.owner?.id === state.user?.id && t.type === 'local';
    const edit = mine ? h('button', { class: 'btn ghost sm', onclick: () => editLyrics(t, lyrics.text, (r) => {
      lyrics = { trackId: t.id, text: r.lyrics, lines: r.synced ? parseLrc(r.lyrics) : [] };
      render();
    }) }, icon('edit'), lyrics.text ? 'Edit' : 'Add lyrics') : null;
    let body;
    if (lyrics.loading) body = h('div', { class: 'muted' }, 'Loading…');
    else if (!lyrics.text) body = h('div', { class: 'muted' }, 'No lyrics for this song yet.');
    else if (lyrics.lines.length) body = h('div', { class: 'lrc' }, ...lyrics.lines.map((l) => h('p', { onclick: () => p.seek(l.time) }, l.text || '♪')));
    else body = h('div', { class: 'plain' }, lyrics.text);
    return h('div', { class: 'np-lyrics' }, body, edit);
  };
  let activeLine = -1;
  const syncLyrics = () => {
    if (!showLyrics || !lyrics.lines.length) return;
    const now = p.audio.currentTime + 0.25;
    let i = lyrics.lines.findIndex((l) => l.time > now) - 1;
    if (i === -2) i = lyrics.lines.length - 1;
    if (i === activeLine) return;
    activeLine = i;
    const rows = coverWrap.querySelectorAll('.lrc p');
    rows.forEach((r, j) => r.classList.toggle('on', j === i));
    // Scroll only the lyrics box; scrollIntoView would also shift the overlay.
    const row = rows[i];
    if (row) row.parentElement.scrollTo({ top: row.offsetTop - row.parentElement.clientHeight / 2 + row.offsetHeight / 2, behavior: 'smooth' });
  };

  const close = () => {
    el.hidden = true;
    p.removeEventListener('change', render);
    p.removeEventListener('state', renderState);
    p.removeEventListener('time', renderTime);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);

  clear(el).append(bg,
    h('div', { class: 'np-top' }, iconBtn('chevronDown', 'Close', close), h('div', { class: 'muted', style: { fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em' } }, p.room ? `Room ${state.rooms.room?.code}` : 'Now playing'),
      iconBtn('more', 'More', (e) => p.current && trackMenu(e.currentTarget, p.current))),
    coverWrap, info,
    h('div', { class: 'np-seek' }, seek, h('div', { class: 'times' }, cur, dur)),
    h('div', { class: 'np-controls' }, shuffle, iconBtn('prev', 'Previous', () => p.prev()), playBtn, iconBtn('next', 'Next', () => p.next()), repeat, lyricsBtn));

  function render() {
    const t = p.current;
    if (!t) return close();
    bg.style.backgroundImage = t.cover ? `url(${JSON.stringify(t.cover)})` : "none";
    lyricsBtn.classList.toggle('on', showLyrics);
    activeLine = -1;
    if (showLyrics) {
      loadLyrics(t);
      clear(coverWrap).append(lyricsPanel(t));
      syncLyrics();
    } else clear(coverWrap).append(coverEl(t.cover, 'np-cover'));
    clear(info).append(h('div', { class: 't-text' }, h('div', { class: 't-title' }, t.title), h('div', { class: 't-artist' }, t.artist)), likeButton(t));
    shuffle.disabled = repeat.disabled = Boolean(p.room);
    shuffle.classList.toggle('on', p.shuffle);
    repeat.classList.toggle('on', p.repeat !== 'off');
    seek.disabled = Boolean(p.room && !p.room.isHost);
    renderState();
  }
  function renderState() { playBtn.replaceChildren(icon(p.playing ? 'pause' : 'play')); }
  function renderTime() {
    const d = p.audio.duration || p.current?.duration || 0;
    seek.max = d || 1;
    if (!seeking) { seek.value = p.audio.currentTime; cur.textContent = fmtTime(p.audio.currentTime); }
    dur.textContent = fmtTime(d);
    setRangeFill(seek);
    syncLyrics();
  }
  p.addEventListener('change', render);
  p.addEventListener('state', renderState);
  p.addEventListener('time', renderTime);
  render();
  renderTime();
}

// ---------------------------------------------------------------- router
const ROUTES = [
  [/^\/?$|^\/home$/, V.homeView],
  [/^\/search$/, V.searchView],
  [/^\/library(?:\/(?<tab>playlists|uploads|songs|albums|artists))?$/, V.libraryView],
  [/^\/user\/(?<name>[\w.-]+)$/, V.userView],
  [/^\/playlist\/(?<id>[\w-]+)$/, V.playlistView],
  [/^\/album\/(?<key>[\w-]+)$/, V.albumView],
  [/^\/artist\/(?<name>.+)$/, V.artistView],
  [/^\/liked$/, V.likedView],
  [/^\/import$/, V.importView],
  [/^\/rooms$/, V.roomsView],
  [/^\/room\/(?<code>[A-Za-z0-9]{6})$/, V.roomView],
  [/^\/profile$/, V.profileView],
  [/^\/messages$/, V.messagesView],
  [/^\/messages\/(?<name>[\w.-]+)$/, V.chatView],
];

let cleanup = null;
let navSeq = 0;
async function route() {
  const raw = location.hash.slice(1) || '/home';
  const [path, query] = raw.split('?');
  const match = ROUTES.map(([re, view]) => [path.match(re), view]).find(([m]) => m);
  const mySeq = ++navSeq;
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  // Fresh container per navigation: a slow view that resolves after the user
  // has moved on renders into a detached node instead of over the new page.
  const view = h('div', { class: 'view-page' });
  $('view').replaceChildren(view);
  $('main').scrollTop = 0;
  renderNav();
  if (!match) {
    view.append(h('div', { class: 'empty' }, 'Page not found. ', h('a', { href: '#/home', style: { textDecoration: 'underline' } }, 'Go home')));
    return;
  }
  const [m, fn] = match;
  try {
    const c = await fn(view, { ...(m.groups || {}), query });
    if (mySeq === navSeq) cleanup = c;
    else if (typeof c === 'function') c();
  } catch (err) {
    if (mySeq !== navSeq) return;
    clear(view).append(h('div', { class: 'empty' }, err.message || 'Something went wrong'));
    if (err.status !== 404 && err.status !== 401) console.error(err);
  }
}

// ---------------------------------------------------------------- boot
let booted = false;
async function boot() {
  if (!session.token) return showAuth();
  try {
    state.user = await get('/me');
  } catch (err) {
    if (err.status === 401) return showAuth();
    toastError(err);
    return;
  }
  session.set(null, state.user);
  $('auth').hidden = true;
  $('shell').hidden = false;
  if (booted) return route();
  booted = true;

  state.health = await get('/health').catch(() => ({ features: {} }));
  state.player = new Player($('audio'));
  state.rooms = new RoomClient({ token: session.token, player: state.player, userId: state.user.id });
  state.rooms.addEventListener('state', () => { renderRoomBadge(); renderQueue(); });

  $('new-playlist').append(icon('plus'));
  $('new-playlist').onclick = async () => {
    const name = await prompt('New playlist', { placeholder: 'Playlist name', okLabel: 'Create' });
    if (name === null) return;
    try {
      const p = await createPlaylist(name);
      location.hash = `#/playlist/${p.id}`;
    } catch (err) { toastError(err); }
  };
  renderUserChip();
  setupMessages();
  buildPlayerBar();
  on('playlists', renderSidebarPlaylists);
  on('user', renderUserChip);
  on('logout', logout);
  on('download', (e) => {
    if (e.detail.status === 'done' && !location.hash.startsWith('#/import')) toast(`Downloaded: ${e.detail.title}`);
    if (e.detail.status === 'error' && !location.hash.startsWith('#/import')) toast(`Download failed: ${e.detail.error}`, 'error');
  });
  await refreshPlaylists().catch(() => {});
  window.addEventListener('hashchange', route);
  route();
}

setUnauthorizedHandler(() => {
  session.clear();
  if (booted) location.reload();
  else showAuth();
});
emit('init');
boot();
