// Page views. Each is async (root, params) → optional cleanup function.
import { h, icon, iconBtn, fmtTotal, coverEl, avatarEl, toast, toastError, clear, confirmDialog, debounce, menu, modal, hueOf } from './dom.js';
import { get, post, patch, del, uploadFiles, uploadImage, session } from './api.js';
import { state, on, emit, refreshPlaylists } from './state.js';
import {
  trackList, card, emptyState, playItems, remoteItem, createPlaylist,
  savePlaylistOrder, markPlaying, albumKey, trackMenu,
} from './components.js';

const go = (hash) => (location.hash = hash);
// Element.append() stringifies arrays/null; views build conditional lists, so flatten first.
const put = (el, ...kids) => { el.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); return el; };
const loading = () => h('div', { class: 'empty' }, h('div', { class: 'spinner', style: { margin: '0 auto' } }));

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

async function shufflePlay(tracks, context) {
  if (!tracks.length) return;
  await playItems(tracks, Math.floor(Math.random() * tracks.length), context);
  if (!state.player.shuffle) state.player.toggleShuffle();
}

function likedCover() {
  return h('div', { class: 'cover liked-cover' }, icon('heartFill'));
}

function rail(title, nodes, more) {
  if (!nodes.length) return null;
  return h('section', { class: 'shelf-sec' },
    h('div', { class: 'shelf-head' }, h('h2', {}, title), more || null),
    h('div', { class: 'shelf' }, nodes));
}

const showAll = (href) => h('a', { class: 'show-all', href }, 'Show all');

// ---------------------------------------------------------------- home
const HOME_FILTERS = [['all', 'All'], ['music', 'Music'], ['playlists', 'Playlists']];

export async function homeView(root, params) {
  put(root, loading());
  const d = await get('/home');
  const f = new URLSearchParams(params.query || '').get('f');
  const filter = HOME_FILTERS.some(([k]) => k === f) ? f : 'all';
  clear(root);
  // Spotify-style color wash behind the header, tinted per user.
  const hue = hueOf(state.user.username);
  const main = document.getElementById('main');
  main.style.setProperty('--top-tint', `hsl(${hue} 42% 22%)`);

  const trackCard = (list, sub) => (t, i) => card({
    title: t.title, sub: sub(t), cover: t.cover,
    onOpen: () => playItems(list, i), onPlay: () => playItems(list, i),
  });
  const quickTile = (cover, label, onclick, extra) => h('div', { class: 'quick', onclick }, cover, h('span', {}, label), extra || null);
  const quick = [
    quickTile(likedCover(), 'Liked Songs', () => go('#/liked'), h('span', { class: 'dim', style: { flex: 'none' } }, String(d.likedCount))),
    ...[...d.jumpBackIn, ...d.playlists.filter((p) => !d.jumpBackIn.some((j) => j.id === p.id))].slice(0, 5)
      .map((p) => quickTile(coverEl(p.cover, '', 'music', p.name), p.name, () => go(`#/playlist/${p.id}`))),
    ...d.recentlyPlayed.slice(0, 7).map((t, i) => quickTile(coverEl(t.cover, '', 'music', t.title), t.title, () => playItems(d.recentlyPlayed, i))),
  ].slice(0, 8);

  const music = filter !== 'playlists';
  const lists = filter !== 'music';
  put(root,
    h('div', { class: 'home-head' },
      h('div', { class: 'chips', role: 'tablist' }, HOME_FILTERS.map(([k, label]) =>
        h('button', { class: `chip${k === filter ? ' active' : ''}`, role: 'tab', 'aria-selected': String(k === filter), onclick: () => go(k === 'all' ? '#/home' : `#/home?f=${k}`) }, label))),
      h('h1', {}, `${greeting()}, ${state.user.username}`),
      filter === 'all' ? h('div', { class: 'quick-grid' }, quick) : null),
    music && rail('Recently played', d.recentlyPlayed.map(trackCard(d.recentlyPlayed, (t) => t.artist))),
    music && rail('From people you follow', d.fromFollowing.map(trackCard(d.fromFollowing, (t) => `${t.artist} · @${t.owner.username}`))),
    lists && rail('Jump back in', d.jumpBackIn.map((p) => playlistCard(p))),
    music && rail('Popular artists', (d.artists || []).map((a) => card({
      title: a.name, sub: 'Artist', cover: a.cover, round: true, fallbackIcon: 'user',
      onOpen: () => go(`#/artist/${encodeURIComponent(a.name)}`),
    })), showAll('#/library/artists')),
    music && rail('New uploads', d.newUploads.map(trackCard(d.newUploads, (t) => `${t.artist} · @${t.owner.username}`)), showAll('#/library/songs')),
    lists && rail('Your playlists', d.playlists.map((p) => playlistCard(p)), showAll('#/library/playlists')),
  );
  if (lists && !music && !d.playlists.length && !d.jumpBackIn.length) {
    put(root, emptyState('library', 'No playlists yet.', h('button', { class: 'btn primary', onclick: async () => {
      try { go(`#/playlist/${(await createPlaylist()).id}`); } catch (err) { toastError(err); }
    } }, icon('plus'), 'Create playlist')));
  }
  if (music && !d.newUploads.length && !d.recentlyPlayed.length) {
    put(root, emptyState('music', 'Your library is empty. Upload songs or search for free music to get started.',
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('a', { class: 'btn primary', href: '#/import' }, icon('upload'), 'Upload music'),
        h('a', { class: 'btn', href: '#/search' }, icon('search'), 'Search'))));
  }
  return () => main.style.removeProperty('--top-tint');
}

function playlistCard(p) {
  return card({
    title: p.name,
    sub: `${p.trackCount} songs · ${p.owner.username}`,
    cover: p.cover,
    onOpen: () => go(`#/playlist/${p.id}`),
    onPlay: async () => {
      const full = await get(`/playlists/${p.id}`);
      if (!full.tracks.length) return toast('This playlist is empty');
      playItems(full.tracks, 0, { playlistId: p.id });
    },
  });
}

// ---------------------------------------------------------------- search
export async function searchView(root, params) {
  const q0 = new URLSearchParams(params.query || '').get('q') || '';
  const input = h('input', { class: 'input', type: 'search', placeholder: 'What do you want to listen to?', value: q0, autofocus: true, 'aria-label': 'Search' });
  const results = h('div');
  let seq = 0;

  async function run(q) {
    const mySeq = ++seq;
    history.replaceState(null, '', q ? `#/search?q=${encodeURIComponent(q)}` : '#/search');
    if (!q) {
      put(clear(results), searchHints());
      return;
    }
    put(clear(results), loading());
    try {
      const r = await get(`/search?q=${encodeURIComponent(q)}`);
      if (mySeq !== seq) return;
      clear(results);
      renderResults(results, r);
    } catch (err) {
      if (mySeq === seq) put(clear(results), emptyState('search', err.message));
    }
  }

  input.addEventListener('input', debounce(() => run(input.value.trim()), 450));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && run(input.value.trim()));
  put(root, h('div', { class: 'search-box', style: { margin: '8px 0 24px' } }, icon('search'), input));
  put(root, results);
  run(q0);
  setTimeout(() => input.focus());
}

function searchHints() {
  const f = state.health.features || {};
  return h('div', { class: 'panel' },
    h('h3', { style: { marginTop: 0 } }, 'Search everywhere'),
    h('p', { class: 'muted' }, 'One search covers your server\'s library and free, legal online catalogues. Online results stream through the server and can be saved to playlists or downloaded into the library.'),
    h('div', { class: 'row wrap' },
      h('span', { class: 'pill' }, 'Library ✓'),
      h('span', { class: 'pill' }, 'Internet Archive ✓'),
      h('span', { class: 'pill' }, f.jamendo ? 'Jamendo ✓' : 'Jamendo — not configured')));
}

function renderResults(root, r) {
  const total = r.local.length + r.playlists.length + r.archive.length + r.jamendo.length;
  if (!total) {
    put(root, emptyState('search', 'No results. Try a different spelling or a broader term.'));
  }
  if (r.local.length) put(root, h('h2', {}, 'Songs in your library'), trackList(r.local.slice(0, 20)));
  if (r.playlists.length) put(root, h('h2', {}, 'Playlists'), h('div', { class: 'grid' }, r.playlists.map(playlistCard)));
  if (r.archive.length) {
    put(root, h('h2', {}, 'Internet Archive'), trackList(r.archive.map(remoteItem)));
  }
  if (r.jamendo.length) put(root, h('h2', {}, 'Jamendo'), trackList(r.jamendo.map(remoteItem)));
  const errs = Object.entries(r.errors || {}).filter(([k]) => k !== 'jamendo' || state.health.features?.jamendo);
  if (errs.length) put(root, h('p', { class: 'dim', style: { marginTop: '24px' } }, errs.map(([k, v]) => `${k}: ${v}`).join(' · ')));
}

// ---------------------------------------------------------------- library
export async function libraryView(root, params) {
  const tab = params.tab || 'playlists';
  const tabs = [['playlists', 'Playlists'], ['uploads', 'Uploads'], ['songs', 'Songs'], ['albums', 'Albums'], ['artists', 'Artists']];
  put(root, 
    h('div', { class: 'row' }, h('h1', { style: { flex: 1 } }, 'Your Library'),
      h('a', { class: 'btn sm', href: '#/import' }, icon('upload'), 'Import')),
    h('div', { class: 'tabs' }, tabs.map(([k, label]) => h('a', { class: `tab${k === tab ? ' active' : ''}`, href: `#/library/${k}` }, label))));
  const body = h('div');
  put(root, body);
  put(body, loading());

  if (tab === 'playlists') {
    const [mine, all] = await Promise.all([refreshPlaylists(), get('/playlists?scope=all')]);
    const others = all.filter((p) => p.owner.id !== state.user.id);
    put(clear(body), 
      h('div', { class: 'grid' },
        card({ title: 'Liked Songs', sub: 'Your favourites', coverNode: likedCover(), onOpen: () => go('#/liked') }),
        card({
          title: 'Create playlist', sub: 'Start something new', coverNode: h('div', { class: 'cover' }, icon('plus')),
          onOpen: async () => { const p = await createPlaylist(); go(`#/playlist/${p.id}`); },
        }),
        mine.map(playlistCard)),
      others.length ? [h('h2', {}, 'From other listeners'), h('div', { class: 'grid' }, others.map(playlistCard))] : null);
  } else if (tab === 'uploads') {
    const [mine, users] = await Promise.all([get(`/users/${encodeURIComponent(state.user.username)}`), get('/users')]);
    const others = users.filter((u) => u.id !== state.user.id);
    const reload = () => libraryView(clear(root), params);
    put(clear(body),
      h('h2', {}, `Your uploads · ${mine.uploads.length}`),
      mine.uploads.length
        ? [h('div', { class: 'action-bar' },
            h('button', { class: 'play-fab', 'aria-label': 'Play your uploads', onclick: () => playItems(mine.uploads, 0) }, icon('play')),
            iconBtn('shuffle', 'Shuffle play', () => shufflePlay(mine.uploads)),
            h('div', { class: 'spacer' }),
            h('a', { class: 'btn sm', href: '#/import' }, icon('upload'), 'Upload more')),
          trackList(mine.uploads, { onDeleted: reload })]
        : emptyState('upload', 'You haven\'t uploaded any music yet.', h('a', { class: 'btn primary', href: '#/import' }, 'Upload your music')),
      others.length ? [h('h2', {}, 'Uploads by other listeners'), h('div', { class: 'grid' }, others.map(uploaderCard))] : null);
  } else if (tab === 'songs') {
    const sortSel = h('select', { class: 'input', style: { width: 'auto', height: '36px' }, 'aria-label': 'Sort' },
      h('option', { value: 'recent' }, 'Recently added'), h('option', { value: 'title' }, 'Title'), h('option', { value: 'artist' }, 'Artist'));
    const listWrap = h('div');
    const load = async () => {
      const tracks = await get(`/tracks?sort=${sortSel.value}`);
      put(clear(listWrap), tracks.length
        ? [h('div', { class: 'action-bar' }, h('button', { class: 'play-fab', 'aria-label': 'Play all', onclick: () => playItems(tracks, 0) }, icon('play')),
            iconBtn('shuffle', 'Shuffle play', () => shufflePlay(tracks)),
            h('span', { class: 'muted' }, `${tracks.length} songs`), h('div', { class: 'spacer' }), sortSel),
          trackList(tracks, { onDeleted: load })]
        : emptyState('music', 'No songs yet.', h('a', { class: 'btn primary', href: '#/import' }, 'Upload music')));
    };
    sortSel.onchange = load;
    put(clear(body), listWrap);
    await load();
  } else if (tab === 'albums') {
    const albums = await get('/albums');
    put(clear(body), albums.length
      ? h('div', { class: 'grid' }, albums.map((a) => card({
          title: a.album, sub: `${a.year ? a.year + ' · ' : ''}${a.artist}`, cover: a.cover,
          onOpen: () => go(`#/album/${a.key}`),
          onPlay: async () => { const d = await get(`/albums/${a.key}`); playItems(d.tracks, 0); },
        })))
      : emptyState('library', 'No albums yet.'));
  } else if (tab === 'artists') {
    const artists = await get('/artists');
    put(clear(body), artists.length
      ? h('div', { class: 'grid' }, artists.map((a) => card({
          title: a.name, sub: `${a.trackCount} songs`, cover: a.cover, round: true,
          onOpen: () => go(`#/artist/${encodeURIComponent(a.name)}`),
        })))
      : emptyState('user', 'No artists yet.'));
  }
}

// ---------------------------------------------------------------- playlist
export async function playlistView(root, params) {
  put(root, loading());
  let p;
  const render = async () => {
    p = await get(`/playlists/${params.id}`);
    const mine = p.owner.id === state.user.id;
    clear(root);

    const coverNode = coverEl(p.cover, mine ? 'editable' : '');
    if (mine) {
      coverNode.title = 'Change cover';
      coverNode.onclick = () => pickImage(async (file) => {
        try { await uploadImage(`/playlists/${p.id}/cover`, file); await refreshPlaylists(); render(); } catch (err) { toastError(err); }
      });
    }
    const title = h('h1', { class: mine ? 'editable' : '', title: mine ? 'Rename' : '' }, p.name);
    if (mine) title.onclick = () => editDetails(p, render);

    put(root, h('div', { class: 'hero', style: { '--hero': '#4a2a3a' } }, coverNode,
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'kind' }, 'Playlist'),
        title,
        p.description ? h('div', { class: 'desc' }, p.description) : null,
        h('div', { class: 'meta' }, h('b', {}, p.owner.username), ` · ${p.trackCount} songs`, p.duration ? `, ${fmtTotal(p.duration)}` : ''))));

    put(root, h('div', { class: 'action-bar' },
      h('button', { class: 'play-fab', 'aria-label': 'Play', disabled: !p.tracks.length, onclick: () => playItems(p.tracks, 0, { playlistId: p.id }) }, icon('play')),
      iconBtn('shuffle', 'Shuffle play', () => shufflePlay(p.tracks, { playlistId: p.id })),
      iconBtn('link', 'Copy link', () => copyLink(`${location.origin}/#/playlist/${p.id}`)),
      mine ? iconBtn('more', 'More options', (e) => menu(e.currentTarget, [
        { label: 'Edit details', icon: 'edit', onClick: () => editDetails(p, render) },
        { label: 'Change cover', icon: 'upload', onClick: () => coverNode.click() },
        'sep',
        { label: 'Delete playlist', icon: 'trash', danger: true, onClick: async () => {
          if (!(await confirmDialog('Delete playlist?', `"${p.name}" will be deleted. Songs stay in the library.`))) return;
          await del(`/playlists/${p.id}`);
          await refreshPlaylists();
          go('#/library');
        } },
      ])) : null));

    if (!p.tracks.length) {
      put(root, emptyState('music', mine ? 'This playlist is empty. Find songs in Search or your Library and add them with ⋯ → Add to playlist.' : 'This playlist is empty.',
        mine ? h('a', { class: 'btn', href: '#/search' }, 'Find songs') : null));
      return;
    }
    put(root, trackList(p.tracks, {
      context: { playlistId: p.id },
      onRemove: mine ? async (i) => {
        try { await del(`/playlists/${p.id}/tracks/${i}`); refreshPlaylists(); render(); } catch (err) { toastError(err); }
      } : null,
      onReorder: mine ? async (from, to) => {
        try { await savePlaylistOrder(p, from, to); render(); } catch (err) { toastError(err); render(); }
      } : null,
      onDeleted: render,
    }));
  };
  await render();
  return on('playlist-changed', (e) => e.detail === params.id && render());
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Anyone signed in can listen; only you can edit.');
  } catch {
    window.prompt('Copy this link:', url);
  }
}

function editDetails(p, after) {
  const name = h('input', { class: 'input', value: p.name, maxlength: 100, 'aria-label': 'Name' });
  const desc = h('textarea', { class: 'input', rows: 3, maxlength: 300, placeholder: 'Add an optional description', style: { height: 'auto', padding: '10px 16px', resize: 'vertical' } }, p.description || '');
  const save = async (close) => {
    try {
      await patch(`/playlists/${p.id}`, { name: name.value, description: desc.value });
      close();
      await refreshPlaylists();
      after();
    } catch (err) { toastError(err); }
  };
  modal('Edit details', h('div', { style: { display: 'grid', gap: '10px' } }, name, desc), [
    { label: 'Cancel', cls: 'ghost', onClick: (c) => c() },
    { label: 'Save', cls: 'primary', onClick: save },
  ]);
}

function pickImage(cb) {
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  input.onchange = () => input.files[0] && cb(input.files[0]);
  input.click();
}

// ---------------------------------------------------------------- uploaders
function uploaderCard(u) {
  return card({
    title: u.username, sub: `${u.uploadCount} upload${u.uploadCount === 1 ? '' : 's'}`,
    coverNode: avatarEl(u, 'card-avatar'),
    onOpen: () => go(`#/user/${encodeURIComponent(u.username)}`),
  });
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Instagram-style profile: avatar + counts, bio, follow/message, tabbed square grid.
export async function userView(root, params) {
  put(root, loading());
  const d = await get(`/users/${encodeURIComponent(params.name)}`);
  const u = d.user;
  const me = u.id === state.user.id;
  const tab = new URLSearchParams(params.query || '').get('tab') === 'playlists' ? 'playlists' : 'songs';
  const href = (t) => `#/user/${encodeURIComponent(u.username)}${t === 'songs' ? '' : `?tab=${t}`}`;
  clear(root);

  const followersN = h('b', {}, String(d.followers));
  const stat = (n, label, onclick) => h('button', { class: 'ig-stat', onclick, disabled: !onclick }, typeof n === 'object' ? n : h('b', {}, String(n)), h('span', {}, label));

  const followBtn = h('button', { class: 'btn sm' });
  const paintFollow = (on) => {
    followBtn.className = `btn sm ${on ? '' : 'primary'}`;
    followBtn.textContent = on ? 'Following' : d.followsYou ? 'Follow back' : 'Follow';
    followBtn.setAttribute('aria-pressed', String(on));
  };
  paintFollow(d.isFollowing);
  followBtn.onclick = async () => {
    followBtn.disabled = true;
    try {
      const r = await (d.isFollowing ? del : post)(`/users/${encodeURIComponent(u.username)}/follow`);
      d.isFollowing = r.isFollowing;
      followersN.textContent = String(r.followers);
      paintFollow(r.isFollowing);
    } catch (err) { toastError(err); }
    followBtn.disabled = false;
  };

  const actions = me
    ? [h('button', { class: 'btn sm', onclick: () => editProfile(u, () => userView(clear(root), params)) }, 'Edit profile'),
      h('a', { class: 'btn sm', href: '#/import' }, icon('upload'), 'Upload')]
    : [followBtn, h('a', { class: 'btn sm', href: `#/messages/${encodeURIComponent(u.username)}` }, 'Message')];
  if (d.uploads.length) {
    actions.push(h('button', { class: 'btn sm icon-only', 'aria-label': 'Shuffle play', title: 'Shuffle play', onclick: () => shufflePlay(d.uploads) }, icon('shuffle')));
  }

  put(root,
    h('header', { class: 'ig-head' },
      h('div', { class: 'ig-ring' }, avatarEl(u, 'ig-avatar')),
      h('div', { class: 'ig-name' }, h('h1', {}, u.username), h('div', { class: 'ig-actions' }, actions)),
      h('div', { class: 'ig-stats' },
        stat(d.uploads.length, d.uploads.length === 1 ? 'song' : 'songs', null),
        stat(followersN, 'followers', () => peopleList(`${u.username}'s followers`, `/users/${encodeURIComponent(u.username)}/followers`)),
        stat(d.following, 'following', () => peopleList(`${u.username} follows`, `/users/${encodeURIComponent(u.username)}/following`))),
      h('div', { class: 'ig-bio' },
        d.followsYou && !me ? h('span', { class: 'pill' }, 'Follows you') : null,
        u.bio ? h('p', {}, u.bio) : me ? h('p', { class: 'dim' }, 'Add a bio so people know what you play.') : null,
        h('div', { class: 'dim small' }, `Joined ${new Date(u.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`))),
    h('nav', { class: 'ig-tabs' },
      h('a', { href: href('songs'), class: tab === 'songs' ? 'active' : '' }, icon('grid'), h('span', {}, 'Songs')),
      h('a', { href: href('playlists'), class: tab === 'playlists' ? 'active' : '' }, icon('library'), h('span', {}, 'Playlists'))));

  if (tab === 'songs') {
    if (!d.uploads.length) {
      put(root, emptyState('music', me ? 'Share your first song.' : 'No songs yet.',
        me ? h('a', { class: 'btn primary', href: '#/import' }, 'Upload your music') : null));
      return;
    }
    const grid = h('div', { class: 'ig-grid' }, d.uploads.map((t, i) => {
      const tile = h('div', { class: 'ig-tile', dataset: { id: t.id }, tabindex: 0, role: 'button', 'aria-label': `Play ${t.title}`,
        onclick: () => playItems(d.uploads, i),
        onkeydown: (e) => e.key === 'Enter' && playItems(d.uploads, i) },
      coverEl(t.cover, '', 'music', t.title),
      h('div', { class: 'ig-over' }, icon('play')),
      h('div', { class: 'ig-cap' }, h('b', {}, t.title), h('span', {}, t.artist)),
      h('button', { class: 'ig-more', 'aria-label': `More options for ${t.title}`, onclick: (e) => {
        e.stopPropagation();
        trackMenu(e.currentTarget, t, { onDeleted: () => userView(clear(root), params) });
      } }, icon('more')));
      return tile;
    }));
    const mark = () => grid.querySelectorAll('.ig-tile').forEach((el) => el.classList.toggle('playing', el.dataset.id === state.player?.current?.id));
    mark();
    put(root, grid);
    state.player.addEventListener('change', mark);
    return () => state.player.removeEventListener('change', mark);
  }
  put(root, d.playlists.length
    ? h('div', { class: 'grid' }, d.playlists.map(playlistCard))
    : emptyState('library', me ? 'You haven\'t made any playlists yet.' : 'No playlists yet.'));
}

function peopleList(title, url) {
  const body = h('div', { class: 'people' }, loading());
  const m = modal(title, body, [{ label: 'Close', cls: 'ghost', onClick: (close) => close() }]);
  get(url).then((people) => {
    put(clear(body), people.length
      ? people.map((p) => h('a', { class: 'person', href: `#/user/${encodeURIComponent(p.username)}`, onclick: () => m.close() },
        avatarEl(p), h('div', { class: 'meta' }, h('b', {}, p.username), p.bio ? h('span', { class: 'dim' }, p.bio) : null)))
      : h('div', { class: 'empty' }, 'Nobody here yet.'));
  }).catch((err) => { m.close(); toastError(err); });
}

function editProfile(u, after) {
  const bio = h('textarea', { class: 'input bio-input', maxlength: 150, rows: 3, placeholder: 'Bio' });
  bio.value = u.bio || '';
  const count = h('div', { class: 'dim small', style: { textAlign: 'right' } });
  const upd = () => (count.textContent = `${bio.value.length}/150`);
  bio.addEventListener('input', upd);
  upd();
  const photo = h('button', { class: 'btn sm', type: 'button', onclick: () => pickImage(async (file) => {
    try {
      const nu = await uploadImage('/me/avatar', file);
      state.user = nu;
      session.set(null, nu);
      emit('user');
      toast('Photo updated');
    } catch (err) { toastError(err); }
  }) }, 'Change photo');
  modal('Edit profile', h('div', { class: 'edit-profile' }, photo, bio, count), [
    { label: 'Cancel', cls: 'ghost', onClick: (close) => close() },
    { label: 'Save', cls: 'primary', onClick: async (close) => {
      try {
        const nu = await patch('/me', { bio: bio.value });
        state.user = nu;
        session.set(null, nu);
        close();
        after();
      } catch (err) { toastError(err); }
    } },
  ]);
}

// ---------------------------------------------------------------- album / artist / liked
export async function albumView(root, params) {
  put(root, loading());
  const a = await get(`/albums/${params.key}`);
  put(clear(root), 
    h('div', { class: 'hero', style: { '--hero': '#2a3a4a' } }, coverEl(a.cover),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'kind' }, 'Album'), h('h1', {}, a.album),
        h('div', { class: 'meta' }, h('a', { href: `#/artist/${encodeURIComponent(a.artist)}` }, h('b', {}, a.artist)),
          a.year ? ` · ${a.year}` : '', ` · ${a.tracks.length} songs, ${fmtTotal(a.tracks.reduce((s, t) => s + t.duration, 0))}`))),
    h('div', { class: 'action-bar' }, h('button', { class: 'play-fab', 'aria-label': 'Play', onclick: () => playItems(a.tracks, 0) }, icon('play'))),
    trackList(a.tracks, { showAlbum: false, showCover: false }));
}

export async function artistView(root, params) {
  put(root, loading());
  const name = decodeURIComponent(params.name);
  const a = await get(`/artists/${encodeURIComponent(name)}`);
  const albums = [...new Map(a.tracks.map((t) => [t.album, t])).values()];
  put(clear(root), 
    h('div', { class: 'hero', style: { '--hero': '#3a3a2a' } }, coverEl(a.cover, 'round', 'user'),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'kind' }, 'Artist'), h('h1', {}, a.name), h('div', { class: 'meta' }, `${a.tracks.length} songs`))),
    h('div', { class: 'action-bar' }, h('button', { class: 'play-fab', 'aria-label': 'Play', onclick: () => playItems(a.tracks, 0) }, icon('play'))),
    h('h2', {}, 'Songs'),
    trackList(a.tracks),
    albums.length > 1 || albums[0]?.album !== 'Unknown album'
      ? [h('h2', {}, 'Albums'), h('div', { class: 'grid' }, albums.map((t) => card({ title: t.album, sub: t.year || 'Album', cover: t.cover, onOpen: () => go(`#/album/${albumKey(t)}`) })))]
      : null);
}

export async function likedView(root) {
  const render = async () => {
    const tracks = await get('/me/likes');
    put(clear(root), 
      h('div', { class: 'hero', style: { '--hero': '#3b2f7a' } }, likedCover(),
        h('div', {}, h('div', { class: 'kind' }, 'Playlist'), h('h1', {}, 'Liked Songs'), h('div', { class: 'meta' }, h('b', {}, state.user.username), ` · ${tracks.length} songs`))),
      h('div', { class: 'action-bar' }, h('button', { class: 'play-fab', 'aria-label': 'Play', disabled: !tracks.length, onclick: () => playItems(tracks, 0) }, icon('play'))),
      tracks.length ? trackList(tracks) : emptyState('heart', 'Songs you like will appear here. Tap the heart on any song.'));
  };
  put(root, loading());
  await render();
  return on('likes', debounce(render, 300));
}

// ---------------------------------------------------------------- import (upload + downloader)
export async function importView(root) {
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'audio/*,.mp3,.m4a,.aac,.ogg,.opus,.flac,.wav,.webm', hidden: true });
  const status = h('div', { style: { marginTop: '12px' } });
  const zone = h('div', { class: 'dropzone', tabindex: 0, onclick: () => fileInput.click(), onkeydown: (e) => e.key === 'Enter' && fileInput.click() },
    icon('upload'), h('div', { style: { fontWeight: 700 } }, 'Drop audio files here or click to choose'),
    h('div', { class: 'dim' }, 'MP3, M4A, AAC, OGG, Opus, FLAC, WAV · up to 200 MB each, 20 at a time'));

  async function doUpload(files) {
    files = [...files];
    if (!files.length) return;
    const bar = h('div');
    const label = h('div', { class: 'muted' }, `Uploading ${files.length} file(s)…`);
    put(clear(status), label, h('div', { class: 'progress', style: { marginTop: '8px' } }, bar));
    try {
      const r = await uploadFiles(files, (p) => { bar.style.width = `${Math.round(p * 100)}%`; label.textContent = p < 1 ? `Uploading… ${Math.round(p * 100)}%` : 'Reading tags…'; });
      clear(status);
      if (r.tracks?.length) {
        const fresh = r.tracks.length - (r.duplicates?.length || 0);
        put(status, fresh ? h('p', { style: { color: 'var(--ok)' } }, `Added ${fresh} song(s).`) : null,
          r.duplicates?.length ? h('p', { class: 'muted' }, `${r.duplicates.length} already in the library: ${r.duplicates.map((d) => d.file).join(', ')}`) : null,
          trackList(r.tracks));
        emit('library');
      }
      for (const e of r.errors || []) put(status, h('p', { style: { color: 'var(--danger)' } }, `${e.file}: ${e.error}`));
    } catch (err) {
      put(clear(status), h('p', { style: { color: 'var(--danger)' } }, err.message));
    }
  }
  fileInput.onchange = () => { doUpload(fileInput.files); fileInput.value = ''; };
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); doUpload(e.dataTransfer.files); });

  const urlInput = h('input', { class: 'input', type: 'url', placeholder: 'https://archive.org/details/…  or a direct .mp3 link', 'aria-label': 'Link to download' });
  const jobsEl = h('div', { style: { marginTop: '16px' } });
  const jobs = new Map();

  const renderJob = (j) => {
    const pct = j.status === 'done' ? 100 : Math.round((j.progress || 0) * 100);
    const statusText = j.status === 'downloading' ? (j.total ? `${pct}%` : `${(j.bytes / 1048576).toFixed(1)} MB`) : j.status;
    const act = (path, label, ic) => iconBtn(ic, label, async () => {
      try { renderJob(await post(`/downloads/${j.id}/${path}`)); } catch (err) { toastError(err); }
    }, 'small');
    const action = ['queued', 'downloading'].includes(j.status) ? act('cancel', 'Cancel download', 'close')
      : ['error', 'canceled'].includes(j.status) ? act('retry', 'Retry download', 'sync') : null;
    const el = h('div', { class: 'job', dataset: { id: j.id } },
      h('div', { class: 'title', title: j.url }, j.title || j.url),
      h('div', { class: 'job-right' }, h('div', { class: `status ${j.status}` }, statusText), action),
      !['error', 'canceled'].includes(j.status) ? h('div', { class: 'progress' }, h('div', { style: { width: `${j.status === 'processing' ? 100 : pct}%` } })) : null,
      j.error ? h('div', { class: 'err' }, j.error) : null);
    const old = jobsEl.querySelector(`[data-id="${CSS.escape(j.id)}"]`);
    if (old) old.replaceWith(el);
    else jobsEl.prepend(el);
  };

  const submit = async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    try {
      const created = await post('/downloads', { url });
      urlInput.value = '';
      created.forEach((j) => { jobs.set(j.id, j); renderJob(j); });
      toast(created.length > 1 ? `Queued ${created.length} songs` : 'Download queued');
    } catch (err) { toastError(err); }
  };

  const ytNote = state.health.features?.ytdlp
    ? 'Other pages go through yt-dlp. YouTube blocks this server\'s IP, so YouTube links usually fail.'
    : '';
  put(root, 
    h('h1', {}, 'Import music'),
    h('div', { class: 'two-col' },
      h('section', { class: 'panel' }, h('h2', { style: { marginTop: 0 } }, 'Upload from this device'), zone, fileInput, status),
      h('section', { class: 'panel' }, h('h2', { style: { marginTop: 0 } }, 'Download from a link'),
        h('p', { class: 'muted' }, 'Paste an archive.org item (all its MP3s are imported), a Jamendo track link, or any direct audio file link. ', ytNote),
        h('form', { class: 'link-form', onsubmit: submit }, urlInput, h('button', { class: 'btn primary', type: 'submit' }, icon('download'), 'Get')),
        jobsEl)));

  const list = await get('/downloads');
  list.reverse().forEach((j) => { jobs.set(j.id, j); renderJob(j); });
  return on('download', (e) => {
    jobs.set(e.detail.id, e.detail);
    renderJob(e.detail);
    if (e.detail.status === 'done') emit('library');
  });
}

// ---------------------------------------------------------------- rooms
export async function roomsView(root) {
  const rc = state.rooms;
  if (rc.room) return go(`#/room/${rc.room.code}`);
  const name = h('input', { class: 'input', placeholder: `${state.user.username}'s room`, maxlength: 60, 'aria-label': 'Room name' });
  const code = h('input', { class: 'input', placeholder: 'ROOM CODE', maxlength: 6, style: { textTransform: 'uppercase', letterSpacing: '.2em', fontWeight: 700 }, 'aria-label': 'Room code' });
  put(root, 
    h('h1', {}, 'Listen together'),
    h('p', { class: 'muted', style: { maxWidth: '640px' } }, 'Start a room and share the code. Everyone in the room hears the same song at the same moment. The host controls playback, anyone can add to the queue, and there is live chat.'),
    h('div', { class: 'two-col', style: { marginTop: '20px' } },
      h('form', { class: 'panel', onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await rc.create(name.value.trim()); go(`#/room/${r.code}`); } catch (err) { toastError(err); }
      } }, h('h2', { style: { marginTop: 0 } }, 'Start a room'), name, h('button', { class: 'btn primary', style: { marginTop: '12px' } }, icon('rooms'), 'Create room')),
      h('form', { class: 'panel', onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await rc.join(code.value.trim()); go(`#/room/${r.code}`); } catch (err) { toastError(err); }
      } }, h('h2', { style: { marginTop: 0 } }, 'Join a room'), code, h('button', { class: 'btn', style: { marginTop: '12px' } }, 'Join'))));
}

export async function roomView(root, params) {
  const rc = state.rooms;
  if (!rc.room || rc.room.code !== params.code.toUpperCase()) {
    try { await rc.join(params.code); } catch (err) {
      put(root, emptyState('rooms', err.message, h('a', { class: 'btn', href: '#/rooms' }, 'Back to rooms')));
      return;
    }
  }
  const main = h('div', { style: { minWidth: 0 } });
  const log = h('div', { class: 'chat-log' });
  const chatInput = h('input', { class: 'input', placeholder: 'Say something…', maxlength: 500, 'aria-label': 'Chat message' });
  const chat = h('section', { class: 'chat' },
    h('div', { class: 'chat-head' }, 'Room chat'),
    log,
    h('form', { class: 'chat-form', onsubmit: async (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = '';
      await rc.sendChat(text);
    } }, chatInput, h('button', { class: 'icon-btn', 'aria-label': 'Send' }, icon('send'))));
  put(root, h('div', { class: 'room-layout', style: { marginTop: '8px' } }, main, chat));

  const addMsg = (m) => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    put(log, h('div', { class: 'chat-msg' },
      h('div', { class: 'who' }, m.username, h('time', {}, new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))),
      h('div', { class: 'body' }, m.text)));
    if (atBottom) log.scrollTop = log.scrollHeight;
  };
  const resetChat = () => { clear(log); rc.chat.forEach(addMsg); log.scrollTop = log.scrollHeight; };
  resetChat();

  const picker = h('div');
  const pickInput = h('input', { class: 'input', type: 'search', placeholder: 'Search songs to play or queue…', 'aria-label': 'Search songs for the room' });
  pickInput.addEventListener('input', debounce(async () => {
    const q = pickInput.value.trim();
    if (!q) return clear(picker);
    try {
      const r = await get(`/search?q=${encodeURIComponent(q)}`);
      const items = [...r.local, ...r.archive.map(remoteItem), ...r.jamendo.map(remoteItem)].slice(0, 15);
      put(clear(picker), items.length ? trackList(items) : h('p', { class: 'muted' }, 'No results'));
    } catch (err) { toastError(err); }
  }, 450));

  const render = () => {
    const st = rc.room;
    if (!st) return go('#/rooms');
    const pb = st.playback;
    const t = pb.track;
    put(clear(main), 
      h('div', { class: 'row wrap', style: { marginBottom: '16px' } },
        h('div', { style: { flex: 1, minWidth: '200px' } }, h('div', { class: 'kind muted', style: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' } }, 'Listening room'), h('h1', { style: { margin: '4px 0' } }, st.name)),
        h('div', { class: 'room-code', title: 'Share this code' }, st.code),
        iconBtn('link', 'Copy invite link', async () => {
          try { await navigator.clipboard.writeText(`${location.origin}/#/room/${st.code}`); toast('Invite link copied'); } catch { toast(`Code: ${st.code}`); }
        }),
        h('button', { class: 'btn ghost sm', onclick: async () => { await rc.leave(); go('#/rooms'); } }, 'Leave')),
      h('div', { class: 'room-now' },
        coverEl(t?.cover),
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('div', { class: 'muted', style: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' } }, t ? (pb.playing ? 'Now playing' : 'Paused') : 'Nothing playing'),
          h('div', { style: { fontSize: '24px', fontWeight: 800, margin: '4px 0' } }, t ? t.title : rc.isHost ? 'Pick a song below to start' : 'Waiting for the host'),
          t ? h('div', { class: 'muted' }, t.artist) : null,
          state.player.needsGesture ? h('button', { class: 'btn primary sm', style: { marginTop: '12px' }, onclick: () => { state.player.unlock(); render(); } }, icon('sync'), 'Tap to join playback') : null,
          rc.isHost && t ? h('div', { class: 'row', style: { marginTop: '12px' } },
            h('button', { class: 'btn sm', onclick: () => state.player.toggle() }, icon(pb.playing ? 'pause' : 'play'), pb.playing ? 'Pause' : 'Play'),
            h('button', { class: 'btn sm', onclick: () => state.player.next() }, icon('next'), 'Skip')) : null)),
      h('h2', {}, 'Listeners'),
      h('div', { class: 'members' }, st.members.map((m) => h('div', { class: 'member' }, avatarEl(m), m.username, m.id === st.hostId ? h('span', { class: 'host' }, 'HOST') : null))),
      h('h2', {}, `Up next${st.queue.length ? ` · ${st.queue.length}` : ''}`),
      st.queue.length
        ? h('div', {}, st.queue.map((q) => h('div', { class: 'q-item' },
            h('span'), coverEl(q.track?.cover),
            h('div', { class: 't-text' }, h('div', { class: 't-title' }, q.track?.title || 'Unavailable'), h('div', { class: 't-artist' }, `${q.track?.artist || ''} · added by ${q.addedBy}`)),
            rc.isHost || q.addedBy === state.user.username ? iconBtn('close', 'Remove', () => rc.control('room:queue:remove', { id: q.id }), 'small') : h('span'))))
        : h('p', { class: 'muted' }, 'The queue is empty. Search below to add songs.'),
      h('h2', {}, rc.isHost ? 'Play or queue a song' : 'Add songs to the queue'),
      h('p', { class: 'muted', style: { marginTop: '-6px' } }, rc.isHost ? 'Click ▶ to play now, or ⋯ → Add to room queue.' : 'Click ▶ or ⋯ to add a song to the room queue.'),
      pickInput, h('div', { style: { marginTop: '12px' } }, picker));
  };
  render();
  const onState = () => render();
  const onChat = (e) => addMsg(e.detail);
  rc.addEventListener('state', onState);
  rc.addEventListener('chat', onChat);
  rc.addEventListener('chat-reset', resetChat);
  const onPlayerChange = () => markPlaying(picker);
  state.player.addEventListener('change', onPlayerChange);
  return () => {
    rc.removeEventListener('state', onState);
    rc.removeEventListener('chat', onChat);
    rc.removeEventListener('chat-reset', resetChat);
    state.player.removeEventListener('change', onPlayerChange);
  };
}

// ---------------------------------------------------------------- profile
export async function profileView(root) {
  const me = await get('/me');
  const render = (u) => {
    const av = h('div', { class: 'avatar-wrap', title: 'Change photo', onclick: () => pickImage(async (file) => {
      try {
        const nu = await uploadImage('/me/avatar', file);
        state.user = nu;
        session.set(null, nu);
        emit('user');
        render(nu);
      } catch (err) { toastError(err); }
    }) }, avatarEl(u, 'lg'));
    put(clear(root), 
      h('div', { class: 'profile-head' }, av,
        h('div', {}, h('div', { class: 'muted', style: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' } }, 'Profile'),
          h('h1', { style: { margin: '4px 0' } }, u.username),
          h('div', { class: 'muted' }, `Member since ${new Date(u.createdAt).toLocaleDateString()} · ${state.playlists.length} playlists`))),
      h('a', { class: 'btn', href: `#/user/${encodeURIComponent(u.username)}`, style: { marginTop: '16px' } }, icon('upload'), 'Your uploads'),
      passwordForm(),
      h('button', { class: 'btn ghost', onclick: () => emit('logout') }, icon('logout'), 'Log out'));
  };
  const passwordForm = () => {
    const field = (label, auto) => h('input', { class: 'input', type: 'password', placeholder: label, 'aria-label': label, autocomplete: auto, required: true, minlength: 6, maxlength: 128 });
    const cur = field('Current password', 'current-password');
    const next = field('New password', 'new-password');
    const again = field('Repeat new password', 'new-password');
    const submit = async (e) => {
      e.preventDefault();
      if (next.value !== again.value) return toast('New passwords don\'t match', 'error');
      try {
        await post('/me/password', { currentPassword: cur.value, newPassword: next.value });
        e.target.reset();
        toast('Password changed');
      } catch (err) { toastError(err); }
    };
    return h('form', { class: 'panel pw-form', onsubmit: submit },
      h('h2', { style: { marginTop: 0 } }, 'Change password'), cur, next, again,
      h('button', { class: 'btn primary', type: 'submit' }, 'Update password'));
  };
  render(me);
}


// ---------------------------------------------------------------- direct messages
const timeAgo = (ts) => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString();
};

export async function messagesView(root) {
  put(root, loading());
  const render = async () => {
    const convos = await get('/dms');
    put(clear(root), h('div', { class: 'dm-title' }, h('h1', {}, 'Messages')),
      convos.length
        ? h('div', { class: 'inbox' }, convos.map((c) => h('a', { class: `convo${c.unread ? ' unread' : ''}`, href: `#/messages/${encodeURIComponent(c.user.username)}` },
          avatarEl(c.user, 'convo-av'),
          h('div', { class: 'meta' },
            h('b', {}, c.user.username),
            h('span', { class: 'last' }, c.last.from === state.user.id ? `You: ${c.last.text}` : c.last.text, h('span', { class: 'dim' }, ` · ${timeAgo(c.last.createdAt)}`))),
          c.unread ? h('span', { class: 'badge' }, String(c.unread)) : null)))
        : emptyState('message', 'No messages yet. Open someone\'s profile and tap Message to start a chat.',
          h('a', { class: 'btn', href: '#/library/uploads' }, 'Find people')));
  };
  await render();
  return on('dm', () => render().catch(() => {}));
}

export async function chatView(root, params) {
  put(root, loading());
  const name = decodeURIComponent(params.name);
  const d = await get(`/dms/${encodeURIComponent(name)}`);
  const other = d.user;
  if (other.id === state.user.id) return go('#/messages');
  emit('dm:seen');
  const log = h('div', { class: 'dm-log' });
  const seen = new Set();
  let lastDay = '';
  const addMsg = (m) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      log.append(h('div', { class: 'dm-day' }, day === new Date().toDateString() ? 'Today' : new Date(m.createdAt).toLocaleDateString()));
    }
    log.append(h('div', { class: `bubble ${m.from === state.user.id ? 'mine' : 'theirs'}`, title: new Date(m.createdAt).toLocaleString() }, m.text));
  };
  const scroll = () => (log.scrollTop = log.scrollHeight);
  d.messages.forEach(addMsg);

  const input = h('textarea', { class: 'input dm-input', rows: 1, maxlength: 2000, placeholder: 'Message…', 'aria-label': 'Message' });
  const sendBtn = h('button', { class: 'icon-btn dm-send', type: 'submit', 'aria-label': 'Send' }, icon('send'));
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    try {
      addMsg(await post(`/dms/${encodeURIComponent(other.username)}`, { text }));
      input.value = '';
      scroll();
    } catch (err) { toastError(err); }
    sendBtn.disabled = false;
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  put(clear(root), h('div', { class: 'dm' },
    h('div', { class: 'dm-head' },
      h('a', { class: 'icon-btn', href: '#/messages', 'aria-label': 'Back to messages' }, icon('back')),
      h('a', { class: 'dm-who', href: `#/user/${encodeURIComponent(other.username)}` }, avatarEl(other), h('b', {}, other.username))),
    log.childElementCount ? log : put(log, h('div', { class: 'dm-empty' }, avatarEl(other, 'lg'), h('b', {}, other.username), h('span', { class: 'dim' }, 'Say hi 👋'))),
    h('form', { class: 'dm-form', onsubmit: (e) => { e.preventDefault(); send(); } }, input, sendBtn)));
  scroll();
  input.focus();

  return on('dm', (e) => {
    const m = e.detail;
    const mine = m.from === state.user.id && m.to === other.id;
    const theirs = m.from === other.id && m.to === state.user.id;
    if (!mine && !theirs) return;
    log.querySelector('.dm-empty')?.remove();
    addMsg(m);
    scroll();
    // Mark as read while the chat is open.
    if (theirs) get(`/dms/${encodeURIComponent(other.username)}`).then(() => emit('dm:seen')).catch(() => {});
  });
}
