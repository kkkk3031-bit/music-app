import { h, icon, iconBtn, fmtTime, coverEl, menu, toast, toastError, confirmDialog, prompt, modal } from './dom.js';
import { post, put, del } from './api.js';
import { state, emit, refreshPlaylists } from './state.js';

// Online search results aren't library tracks until saved; this turns one
// into a real (proxied) track on demand.
export async function ensureTrack(item) {
  if (!item.remote) return item;
  const t = await post('/tracks/remote', item.remote);
  Object.assign(item, t, { remote: null });
  return item;
}

export async function playItems(items, start, context) {
  try {
    const tracks = await Promise.all(items.map(ensureTrack));
    state.player.playList(tracks, start, context);
  } catch (err) {
    toastError(err);
  }
}

export function remoteItem(r) {
  return {
    id: `remote:${r.url}`,
    title: r.title,
    artist: r.artist,
    album: r.album,
    duration: r.duration,
    cover: r.cover,
    source: r.source,
    remote: r,
  };
}

export async function toggleLike(track, btn) {
  try {
    const t = await ensureTrack(track);
    const liked = !t.liked;
    await (liked ? put(`/tracks/${t.id}/like`) : del(`/tracks/${t.id}/like`));
    t.liked = liked;
    state.player.setLiked(t.id, liked);
    if (btn) setLikeBtn(btn, liked);
    emit('likes');
    toast(liked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
  } catch (err) {
    toastError(err);
  }
}

export function likeButton(track) {
  const btn = iconBtn('heart', 'Like', (e) => { e.stopPropagation(); toggleLike(track, btn); });
  setLikeBtn(btn, track.liked);
  return btn;
}

function setLikeBtn(btn, liked) {
  btn.classList.toggle('liked', Boolean(liked));
  btn.replaceChildren(icon(liked ? 'heartFill' : 'heart'));
  btn.title = liked ? 'Remove from Liked Songs' : 'Save to Liked Songs';
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-pressed', String(Boolean(liked)));
}

export async function addToPlaylist(track, playlist) {
  try {
    const t = await ensureTrack(track);
    await post(`/playlists/${playlist.id}/tracks`, { trackId: t.id });
    toast(`Added to ${playlist.name}`);
    refreshPlaylists();
    emit('playlist-changed', playlist.id);
  } catch (err) {
    toastError(err);
  }
}

export async function createPlaylist(name) {
  const p = await post('/playlists', name ? { name } : {});
  await refreshPlaylists();
  return p;
}

function playlistPicker(anchor, track) {
  const items = state.playlists.map((p) => ({ label: p.name, icon: 'music', onClick: () => addToPlaylist(track, p) }));
  menu(anchor, [
    {
      label: 'New playlist',
      icon: 'plus',
      onClick: async () => {
        const name = await prompt('New playlist', { placeholder: 'Playlist name', okLabel: 'Create' });
        if (name === null) return;
        try {
          const p = await createPlaylist(name);
          await addToPlaylist(track, p);
        } catch (err) { toastError(err); }
      },
    },
    items.length ? 'sep' : null,
    ...items,
  ]);
}

export async function downloadToLibrary(item) {
  const r = item.remote;
  const url = r.source === 'jamendo' ? `https://www.jamendo.com/track/${r.sourceId}` : r.url;
  try {
    await post('/downloads', { url });
    toast('Download started — see Import');
  } catch (err) {
    toastError(err);
  }
}

/** LRC text → [{ time, text }] sorted by time; lines may carry several stamps. */
export function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ time: Number(m[1]) * 60 + Number(m[2].replace(':', '.')), text: words });
  }
  return out.sort((a, b) => a.time - b.time);
}

export function editLyrics(track, current, after) {
  const area = h('textarea', { class: 'input lyrics-edit', rows: 14, maxlength: 20000, placeholder: 'Paste lyrics. LRC timestamps like [01:23.45] make them sync with the song.' }, current || '');
  modal(`Lyrics · ${track.title}`, area, [
    { label: 'Cancel', cls: 'ghost', onClick: (c) => c() },
    { label: 'Save', cls: 'primary', onClick: async (close) => {
      try {
        const r = await put(`/tracks/${track.id}/lyrics`, { lyrics: area.value });
        track.hasLyrics = Boolean(r.lyrics);
        close();
        after?.(r);
      } catch (err) { toastError(err); }
    } },
  ]);
}

export function trackMenu(anchor, track, { onRemove, onDeleted } = {}) {
  const inRoom = Boolean(state.player.room);
  const mine = track.owner?.id === state.user?.id && track.type === 'local';
  menu(anchor, [
    { label: inRoom ? 'Add to room queue' : 'Add to queue', icon: 'queue', onClick: async () => state.player.addToQueue(await ensureTrack(track)) },
    !inRoom && { label: 'Play next', icon: 'next', onClick: async () => state.player.playNext(await ensureTrack(track)) },
    { label: 'Add to playlist…', icon: 'plus', onClick: () => setTimeout(() => playlistPicker(anchor, track)) },
    { label: track.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs', icon: 'heart', onClick: () => toggleLike(track) },
    track.remote && { label: 'Download to library', icon: 'download', onClick: () => downloadToLibrary(track) },
    track.album && track.type === 'local' && { label: 'Go to album', icon: 'library', onClick: () => (location.hash = `#/album/${albumKey(track)}`) },
    track.type === 'local' && { label: 'Go to artist', icon: 'user', onClick: () => (location.hash = `#/artist/${encodeURIComponent(track.artist)}`) },
    onRemove && 'sep',
    onRemove && { label: 'Remove from this playlist', icon: 'trash', onClick: onRemove },
    mine && 'sep',
    mine && {
      label: 'Delete from library',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        if (!(await confirmDialog('Delete song?', `"${track.title}" will be removed from the library and every playlist.`))) return;
        try {
          await del(`/tracks/${track.id}`);
          toast('Deleted');
          refreshPlaylists();
          onDeleted?.();
        } catch (err) { toastError(err); }
      },
    },
  ]);
}

// Same key the server uses: base64url("artist\0album").
export function albumKey(t) {
  const bytes = new TextEncoder().encode(`${t.artist}\u0000${t.album}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Track table. opts:
 *  context      — passed to the player (e.g. { playlistId })
 *  showAlbum    — album column (default true)
 *  showCover    — cover thumbnails (default true)
 *  onRemove(i)  — adds "Remove from this playlist"
 *  onReorder(fromIndex, toIndex) — enables drag handles
 *  onDeleted()  — after a track is deleted from the library
 */
export function trackList(items, opts = {}) {
  const { context = null, showAlbum = true, showCover = true, onRemove, onReorder, onDeleted } = opts;
  const list = h('div', { class: `tracks${onReorder ? ' draggable' : ''}` });
  list.append(h('div', { class: 'tracks-head' },
    onReorder ? h('span') : null,
    h('span', { style: { textAlign: 'right' } }, '#'),
    h('span', {}, 'Title'),
    h('span', {}, showAlbum ? 'Album' : ''),
    h('span', { style: { textAlign: 'right', paddingRight: '8px' } }, 'Time')));

  items.forEach((t, i) => {
    const row = h('div', {
      class: 'track',
      dataset: { id: t.id, index: String(i) },
      ondblclick: () => playItems(items, i, context),
      oncontextmenu: (e) => { e.preventDefault(); trackMenu(e, t, { onRemove: onRemove && (() => onRemove(i)), onDeleted }); },
    },
      onReorder ? h('span', { class: 'drag-handle', title: 'Drag to reorder' }, icon('drag')) : null,
      h('span', { class: 'num' },
        h('span', { class: 'n' }, String(i + 1)),
        h('button', { class: 'hover-play', 'aria-label': `Play ${t.title}`, onclick: () => playItems(items, i, context) }, icon('play'))),
      h('div', { class: 'main-col', onclick: () => matchMedia('(max-width: 760px)').matches && playItems(items, i, context) },
        showCover ? coverEl(t.cover) : null,
        h('div', { class: 't-text' },
          h('div', { class: 't-title' }, t.title),
          h('div', { class: 't-artist' }, t.source && t.source !== 'upload' && t.source !== 'download' ? h('span', { class: 'pill', style: { marginRight: '6px' } }, t.source) : null, t.artist))),
      h('span', { class: 't-album' }, showAlbum ? t.album || '' : ''),
      h('div', { class: 'actions' },
        likeButton(t),
        h('span', { class: 'dur' }, t.duration ? fmtTime(t.duration) : ''),
        iconBtn('more', 'More options', (e) => { e.stopPropagation(); trackMenu(e.currentTarget, t, { onRemove: onRemove && (() => onRemove(i)), onDeleted }); })));
    list.append(row);
  });

  if (onReorder) makeSortable(list, '.track', '.drag-handle', onReorder);
  markPlaying(list);
  return list;
}

/** Highlight the row of the current track. Call again on player 'change'. */
export function markPlaying(root = document) {
  const cur = state.player?.current;
  root.querySelectorAll('.track').forEach((row) => {
    const on = Boolean(cur && row.dataset.id === cur.id);
    row.classList.toggle('playing', on);
    const n = row.querySelector('.num .n');
    if (!n) return;
    if (on) n.replaceChildren(h('span', { class: `eq${state.player.playing ? '' : ' paused'}` }, h('i'), h('i'), h('i')));
    else if (n.querySelector('.eq')) n.textContent = String(Number(row.dataset.index) + 1);
  });
}

/**
 * Pointer-based drag reorder (works for mouse and touch, unlike HTML5 DnD).
 * onMove(from, to) is called once on drop with indices into the item list.
 */
export function makeSortable(container, itemSel, handleSel, onMove) {
  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest(handleSel);
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest(itemSel);
    const items = () => [...container.querySelectorAll(itemSel)];
    const from = items().indexOf(item);
    if (from < 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    item.classList.add('dragging');
    let target = null;
    let after = false;

    const move = (ev) => {
      const els = items();
      els.forEach((el) => el.classList.remove('drop-before', 'drop-after'));
      target = null;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
          target = el;
          after = ev.clientY > r.top + r.height / 2;
          if (el !== item) el.classList.add(after ? 'drop-after' : 'drop-before');
          break;
        }
      }
      const scroller = container.closest('.main, .queue-panel');
      if (scroller) {
        const sr = scroller.getBoundingClientRect();
        if (ev.clientY < sr.top + 60) scroller.scrollTop -= 12;
        else if (ev.clientY > sr.bottom - 60) scroller.scrollTop += 12;
      }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const els = items();
      els.forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));
      if (!target || target === item) return;
      let to = els.indexOf(target);
      if (after && to < from) to++;
      if (!after && to > from) to--;
      if (to !== from) onMove(from, to);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

export function card({ title, sub, cover, round = false, onOpen, onPlay, coverNode }) {
  return h('div', { class: 'card', onclick: onOpen, tabindex: 0, onkeydown: (e) => e.key === 'Enter' && onOpen?.() },
    coverNode || coverEl(cover, round ? 'round' : ''),
    onPlay ? h('button', { class: 'play-fab card-play', 'aria-label': `Play ${title}`, onclick: (e) => { e.stopPropagation(); onPlay(); } }, icon('play')) : null,
    h('div', { class: 'title' }, title),
    h('div', { class: 'sub' }, sub));
}

export function emptyState(iconName, text, action) {
  return h('div', { class: 'empty' }, icon(iconName), h('div', {}, text), action ? h('div', { style: { marginTop: '16px' } }, action) : null);
}

export function reorderArray(arr, from, to) {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

export async function savePlaylistOrder(playlist, from, to) {
  const ids = reorderArray(playlist.tracks.map((t) => t.id), from, to);
  return put(`/playlists/${playlist.id}/tracks`, { trackIds: ids });
}
