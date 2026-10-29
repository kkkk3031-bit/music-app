import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import multer from 'multer';
import { Server as IOServer } from 'socket.io';
import { Store, newId } from './db.js';
import { createAuth, loadSecret, publicUser, rateLimit } from './auth.js';
import { createRequire } from 'node:module';
import { ingestAudio, audioExt, IMAGE_TYPES, cleanLyrics, isSyncedLyrics, hashFile } from './media.js';
import { safeFetch, hostAllowed } from './net.js';
import { searchArchive, searchJamendo, STREAM_HOSTS } from './sources.js';
import { Downloader } from './downloader.js';
import { RoomManager } from './rooms.js';
import { attachSockets } from './sockets.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_UPLOAD = 200 * 1024 * 1024;
const MAX_RECENT = 50;
const { version: VERSION } = createRequire(import.meta.url)('../package.json');

const httpError = (status, message) => Object.assign(new Error(message), { status });

export function createApp({ dataDir, authLimit = { windowMs: 60_000, max: 20 }, ytdlpPath } = {}) {
  const dirs = {
    data: dataDir,
    media: path.join(dataDir, 'media'),
    covers: path.join(dataDir, 'covers'),
    images: path.join(dataDir, 'images'),
    tmp: path.join(dataDir, 'tmp'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

  const store = new Store(dataDir);
  const auth = createAuth({ store, secret: loadSecret(dataDir) });
  const app = express();
  const server = http.createServer(app);
  const io = new IOServer(server, { cors: { origin: true } });
  const rooms = new RoomManager();
  // Byte-identical uploads/downloads reuse the existing library track.
  const findByHash = (hash) => store.tracks.find((t) => t.type === 'local' && t.hash === hash) || null;
  // Tracks from before hashing existed get one in the background.
  (async () => {
    for (const t of store.tracks.filter((x) => x.type === 'local' && !x.hash)) {
      t.hash = await hashFile(path.join(dirs.media, path.basename(t.file))).catch(() => null);
    }
    store.save();
  })();
  const downloader = new Downloader({
    store,
    dirs,
    ytdlpPath: ytdlpPath ?? process.env.YTDLP_PATH ?? '/home/dev/bin/yt-dlp',
    onUpdate: (job) => io.to(`user:${job.userId}`).emit('download:update', job),
    findByHash,
  });

  // ---------- serializers ----------
  const userName = (id) => store.user(id)?.username || 'unknown';

  function publicTrack(t, viewer) {
    if (!t) return null;
    return {
      id: t.id,
      type: t.type,
      source: t.source,
      title: t.title,
      artist: t.artist,
      album: t.album,
      year: t.year || null,
      trackNo: t.trackNo || null,
      duration: t.duration,
      cover: t.cover,
      owner: { id: t.ownerId, username: userName(t.ownerId) },
      liked: viewer ? viewer.likes.includes(t.id) : false,
      hasLyrics: Boolean(t.lyrics),
      streamUrl: `/api/tracks/${t.id}/stream`,
      createdAt: t.createdAt,
    };
  }

  function publicPlaylist(p, viewer, withTracks = false) {
    const tracks = p.trackIds.map((id) => store.track(id)).filter(Boolean);
    const out = {
      id: p.id,
      name: p.name,
      description: p.description || '',
      cover: p.cover || tracks.find((t) => t.cover)?.cover || null,
      owner: { id: p.ownerId, username: userName(p.ownerId) },
      trackCount: tracks.length,
      duration: tracks.reduce((s, t) => s + (t.duration || 0), 0),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
    if (withTracks) out.tracks = tracks.map((t) => publicTrack(t, viewer));
    return out;
  }

  const albumKey = (t) => Buffer.from(`${t.artist}\u0000${t.album}`).toString('base64url');
  const byNewest = (a, b) => b.createdAt - a.createdAt;
  const localTracks = () => store.tracks.filter((t) => t.type === 'local');

  // ---------- middleware ----------
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/stream') && compression.filter(req, res) }));
  app.use(express.json({ limit: '256kb' }));
  // Android's HttpURLConnection can't send PATCH; allow POST + override header.
  app.use((req, _res, next) => {
    const override = String(req.get('x-http-method-override') || '').toUpperCase();
    if (req.method === 'POST' && ['PATCH', 'PUT', 'DELETE'].includes(override)) req.method = override;
    next();
  });
  const staticOpts = { dotfiles: 'deny', index: false, maxAge: '30d', immutable: true };
  app.use('/covers', express.static(dirs.covers, staticOpts));
  app.use('/images', express.static(dirs.images, staticOpts));
  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

  const tmpName = (_req, file, cb) => cb(null, `up-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase().slice(0, 6)}`);
  const audioUpload = multer({
    storage: multer.diskStorage({ destination: dirs.tmp, filename: tmpName }),
    limits: { fileSize: MAX_UPLOAD, files: 20 },
    fileFilter: (_req, file, cb) => cb(null, Boolean(audioExt(file.originalname, file.mimetype))),
  });
  const imageUpload = multer({
    storage: multer.diskStorage({ destination: dirs.tmp, filename: tmpName }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Boolean(IMAGE_TYPES[ext]) && file.mimetype.startsWith('image/'));
    },
  });

  // Images are checked by magic bytes, not just the claimed extension.
  async function saveImage(file) {
    if (!file) throw httpError(400, 'Send a JPEG, PNG or WebP image');
    const head = Buffer.alloc(12);
    const fh = await fsp.open(file.path);
    await fh.read(head, 0, 12, 0);
    await fh.close();
    const ext =
      head[0] === 0xff && head[1] === 0xd8 ? '.jpg'
      : head.toString('latin1', 1, 4) === 'PNG' ? '.png'
      : head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP' ? '.webp'
      : null;
    if (!ext) {
      await fsp.rm(file.path, { force: true });
      throw httpError(415, 'Send a JPEG, PNG or WebP image');
    }
    const name = newId() + ext;
    await fsp.rename(file.path, path.join(dirs.images, name));
    return `/images/${name}`;
  }

  async function removeImage(url) {
    if (url?.startsWith('/images/')) await fsp.rm(path.join(dirs.images, path.basename(url)), { force: true });
  }

  const api = express.Router();
  const limiter = rateLimit(authLimit);

  api.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'Cadence',
      version: VERSION,
      uptime: Math.round(process.uptime()),
      features: { jamendo: Boolean(process.env.JAMENDO_CLIENT_ID), ytdlp: Boolean(downloader.ytdlpPath) },
    });
  });

  // ---------- auth ----------
  api.post('/auth/register', limiter, async (req, res) => {
    res.status(201).json(await auth.register(req.body?.username, req.body?.password));
  });
  api.post('/auth/login', limiter, async (req, res) => {
    res.json(await auth.login(req.body?.username, req.body?.password));
  });

  api.use(auth.requireUser);

  // ---------- me ----------
  api.get('/me', (req, res) => res.json(publicUser(req.user)));

  api.post('/me/avatar', imageUpload.single('image'), async (req, res) => {
    const url = await saveImage(req.file);
    await removeImage(req.user.avatar);
    req.user.avatar = url;
    store.save();
    res.json(publicUser(req.user));
  });

  api.post('/me/password', limiter, async (req, res) => {
    await auth.changePassword(req.user, req.body?.currentPassword, req.body?.newPassword);
    res.status(204).end();
  });

  api.get('/me/likes', (req, res) => {
    const tracks = req.user.likes.map((id) => store.track(id)).filter(Boolean).reverse();
    res.json(tracks.map((t) => publicTrack(t, req.user)));
  });

  api.post('/me/played', (req, res) => {
    const { trackId, playlistId } = req.body || {};
    const u = req.user;
    if (trackId && store.track(trackId)) {
      u.recent = [trackId, ...u.recent.filter((id) => id !== trackId)].slice(0, MAX_RECENT);
    }
    if (playlistId && store.playlist(playlistId)) {
      u.recentPlaylists = [playlistId, ...u.recentPlaylists.filter((id) => id !== playlistId)].slice(0, 20);
    }
    store.save();
    res.status(204).end();
  });

  api.get('/home', (req, res) => {
    const u = req.user;
    const recent = u.recent.map((id) => store.track(id)).filter(Boolean).slice(0, 12);
    const jumpBack = u.recentPlaylists.map((id) => store.playlist(id)).filter(Boolean).slice(0, 6);
    res.json({
      recentlyPlayed: recent.map((t) => publicTrack(t, u)),
      jumpBackIn: jumpBack.map((p) => publicPlaylist(p, u)),
      playlists: store.playlists.filter((p) => p.ownerId === u.id).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map((p) => publicPlaylist(p, u)),
      newUploads: localTracks().sort(byNewest).slice(0, 12).map((t) => publicTrack(t, u)),
      likedCount: u.likes.filter((id) => store.track(id)).length,
    });
  });

  // ---------- tracks ----------
  api.get('/tracks', (req, res) => {
    let list = localTracks();
    if (req.query.scope === 'mine') list = list.filter((t) => t.ownerId === req.user.id);
    const sort = req.query.sort || 'recent';
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'artist') list.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    else list.sort(byNewest);
    res.json(list.map((t) => publicTrack(t, req.user)));
  });

  api.post('/tracks', audioUpload.array('files', 20), async (req, res) => {
    const files = req.files || [];
    if (!files.length) throw httpError(400, 'No audio files received (mp3, m4a, aac, ogg, opus, webm, flac, wav)');
    const tracks = [];
    const errors = [];
    const duplicates = [];
    for (const f of files) {
      try {
        const t = await ingestAudio({ tmpPath: f.path, originalName: f.originalname, mime: f.mimetype, ownerId: req.user.id, dirs, findByHash });
        if (store.track(t.id)) duplicates.push({ file: f.originalname, trackId: t.id });
        else store.tracks.push(t);
        tracks.push(publicTrack(t, req.user));
      } catch (err) {
        errors.push({ file: f.originalname, error: err.message });
      }
    }
    store.save();
    res.status(tracks.length ? 201 : 415).json({ tracks, errors, duplicates });
  });

  // Save an online search result as a playable (proxied) track.
  api.post('/tracks/remote', (req, res) => {
    const b = req.body || {};
    let url;
    try {
      url = new URL(String(b.url));
    } catch {
      throw httpError(400, 'Invalid url');
    }
    if (url.protocol !== 'https:' || !hostAllowed(url.hostname, STREAM_HOSTS)) throw httpError(400, 'Unsupported source');
    if (!['archive', 'jamendo'].includes(b.source)) throw httpError(400, 'Unsupported source');
    let cover = null;
    try {
      const c = new URL(String(b.cover));
      if (c.protocol === 'https:' && hostAllowed(c.hostname, STREAM_HOSTS)) cover = c.toString();
    } catch { /* no cover */ }

    const existing = store.tracks.find((t) => t.type === 'remote' && t.url === url.toString());
    if (existing) return res.json(publicTrack(existing, req.user));
    const t = {
      id: newId(),
      type: 'remote',
      source: b.source,
      sourceId: String(b.sourceId || '').slice(0, 300),
      ownerId: req.user.id,
      title: String(b.title || 'Untitled').slice(0, 200),
      artist: String(b.artist || 'Unknown artist').slice(0, 200),
      album: String(b.album || '').slice(0, 200),
      duration: Math.max(0, Math.round(Number(b.duration) || 0)),
      cover,
      url: url.toString(),
      createdAt: Date.now(),
    };
    store.tracks.push(t);
    store.save();
    res.status(201).json(publicTrack(t, req.user));
  });

  api.get('/tracks/:id', (req, res) => {
    const t = store.track(req.params.id);
    if (!t) throw httpError(404, 'Track not found');
    res.json(publicTrack(t, req.user));
  });

  // Range-capable streaming. Local files use express's sendFile (handles Range
  // + 206 + ETag); remote tracks are proxied with the Range header forwarded.
  api.get('/tracks/:id/stream', async (req, res) => {
    const t = store.track(req.params.id);
    if (!t) throw httpError(404, 'Track not found');
    if (t.type === 'local') {
      return res.sendFile(t.file, { root: dirs.media, dotfiles: 'deny', headers: { 'Content-Type': t.mime, 'Cache-Control': 'private, max-age=86400' } });
    }
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const headers = {};
    if (req.headers.range) headers.range = req.headers.range;
    const up = await safeFetch(t.url, { allowlist: STREAM_HOSTS, headers, signal: ac.signal });
    if (!up.ok || !up.body) throw httpError(502, `Source returned ${up.status}`);
    res.status(up.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = up.headers.get(h);
      if (v) res.set(h, v);
    }
    Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
  });

  api.get('/tracks/:id/lyrics', (req, res) => {
    const t = store.track(req.params.id);
    if (!t) throw httpError(404, 'Track not found');
    res.json({ lyrics: t.lyrics || null, synced: isSyncedLyrics(t.lyrics) });
  });

  api.put('/tracks/:id/lyrics', (req, res) => {
    const t = store.track(req.params.id);
    if (!t) throw httpError(404, 'Track not found');
    if (t.ownerId !== req.user.id) throw httpError(403, 'Only the uploader can edit lyrics');
    const raw = req.body?.lyrics;
    if (raw !== null && typeof raw !== 'string') throw httpError(400, 'lyrics must be a string or null');
    t.lyrics = cleanLyrics(raw);
    store.save();
    res.json({ lyrics: t.lyrics, synced: isSyncedLyrics(t.lyrics) });
  });

  api.delete('/tracks/:id', async (req, res) => {
    const t = store.track(req.params.id);
    if (!t) throw httpError(404, 'Track not found');
    if (t.ownerId !== req.user.id) throw httpError(403, 'Only the uploader can delete this track');
    store.data.tracks = store.tracks.filter((x) => x.id !== t.id);
    for (const p of store.playlists) p.trackIds = p.trackIds.filter((id) => id !== t.id);
    for (const u of store.users) {
      u.likes = u.likes.filter((id) => id !== t.id);
      u.recent = u.recent.filter((id) => id !== t.id);
    }
    store.save();
    if (t.type === 'local') {
      await fsp.rm(path.join(dirs.media, path.basename(t.file)), { force: true });
      if (t.cover?.startsWith('/covers/')) await fsp.rm(path.join(dirs.covers, path.basename(t.cover)), { force: true });
    }
    res.status(204).end();
  });

  api.put('/tracks/:id/like', (req, res) => {
    if (!store.track(req.params.id)) throw httpError(404, 'Track not found');
    if (!req.user.likes.includes(req.params.id)) req.user.likes.push(req.params.id);
    store.save();
    res.json({ liked: true });
  });

  api.delete('/tracks/:id/like', (req, res) => {
    req.user.likes = req.user.likes.filter((id) => id !== req.params.id);
    store.save();
    res.json({ liked: false });
  });

  // ---------- albums / artists ----------
  api.get('/albums', (req, res) => {
    const groups = new Map();
    for (const t of localTracks()) {
      const k = albumKey(t);
      const g = groups.get(k) || { key: k, album: t.album, artist: t.artist, year: t.year, cover: null, trackCount: 0, createdAt: 0 };
      g.trackCount++;
      g.cover ||= t.cover;
      g.createdAt = Math.max(g.createdAt, t.createdAt);
      groups.set(k, g);
    }
    res.json([...groups.values()].sort((a, b) => a.album.localeCompare(b.album)));
  });

  api.get('/albums/:key', (req, res) => {
    const tracks = localTracks()
      .filter((t) => albumKey(t) === req.params.key)
      .sort((a, b) => (a.trackNo || 999) - (b.trackNo || 999) || a.title.localeCompare(b.title));
    if (!tracks.length) throw httpError(404, 'Album not found');
    res.json({
      key: req.params.key,
      album: tracks[0].album,
      artist: tracks[0].artist,
      year: tracks[0].year,
      cover: tracks.find((t) => t.cover)?.cover || null,
      tracks: tracks.map((t) => publicTrack(t, req.user)),
    });
  });

  api.get('/artists', (_req, res) => {
    const groups = new Map();
    for (const t of localTracks()) {
      const g = groups.get(t.artist) || { name: t.artist, trackCount: 0, cover: null };
      g.trackCount++;
      g.cover ||= t.cover;
      groups.set(t.artist, g);
    }
    res.json([...groups.values()].sort((a, b) => a.name.localeCompare(b.name)));
  });

  api.get('/artists/:name', (req, res) => {
    const tracks = localTracks().filter((t) => t.artist === req.params.name).sort((a, b) => a.album.localeCompare(b.album) || (a.trackNo || 0) - (b.trackNo || 0));
    if (!tracks.length) throw httpError(404, 'Artist not found');
    res.json({ name: req.params.name, cover: tracks.find((t) => t.cover)?.cover || null, tracks: tracks.map((t) => publicTrack(t, req.user)) });
  });

  // ---------- users: everyone's own uploads ----------
  api.get('/users', (_req, res) => {
    const counts = new Map();
    for (const t of localTracks()) counts.set(t.ownerId, (counts.get(t.ownerId) || 0) + 1);
    const list = [...counts].map(([id, uploadCount]) => ({ ...publicUser(store.user(id) || { id, username: 'unknown' }), uploadCount }));
    res.json(list.sort((a, b) => b.uploadCount - a.uploadCount || a.username.localeCompare(b.username)));
  });

  api.get('/users/:username', (req, res) => {
    const lower = req.params.username.toLowerCase();
    const u = store.users.find((x) => x.username.toLowerCase() === lower);
    if (!u) throw httpError(404, 'User not found');
    res.json({
      user: publicUser(u),
      uploads: localTracks().filter((t) => t.ownerId === u.id).sort(byNewest).map((t) => publicTrack(t, req.user)),
      playlists: store.playlists.filter((p) => p.ownerId === u.id).sort((a, b) => b.updatedAt - a.updatedAt).map((p) => publicPlaylist(p, req.user)),
    });
  });

  // ---------- playlists ----------
  function ownPlaylist(req) {
    const p = store.playlist(req.params.id);
    if (!p) throw httpError(404, 'Playlist not found');
    if (p.ownerId !== req.user.id) throw httpError(403, 'Not your playlist');
    return p;
  }

  api.get('/playlists', (req, res) => {
    const list = req.query.scope === 'all' ? store.playlists : store.playlists.filter((p) => p.ownerId === req.user.id);
    res.json([...list].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => publicPlaylist(p, req.user)));
  });

  api.post('/playlists', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100) || `My Playlist #${store.playlists.filter((p) => p.ownerId === req.user.id).length + 1}`;
    const p = { id: newId(), ownerId: req.user.id, name, description: String(req.body?.description || '').slice(0, 300), cover: null, trackIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    store.playlists.push(p);
    store.save();
    res.status(201).json(publicPlaylist(p, req.user, true));
  });

  api.get('/playlists/:id', (req, res) => {
    const p = store.playlist(req.params.id);
    if (!p) throw httpError(404, 'Playlist not found');
    res.json(publicPlaylist(p, req.user, true));
  });

  api.patch('/playlists/:id', (req, res) => {
    const p = ownPlaylist(req);
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 100);
      if (!name) throw httpError(400, 'Name cannot be empty');
      p.name = name;
    }
    if (req.body?.description !== undefined) p.description = String(req.body.description).slice(0, 300);
    p.updatedAt = Date.now();
    store.save();
    res.json(publicPlaylist(p, req.user, true));
  });

  api.delete('/playlists/:id', async (req, res) => {
    const p = ownPlaylist(req);
    store.data.playlists = store.playlists.filter((x) => x.id !== p.id);
    for (const u of store.users) u.recentPlaylists = u.recentPlaylists.filter((id) => id !== p.id);
    store.save();
    await removeImage(p.cover);
    res.status(204).end();
  });

  api.post('/playlists/:id/tracks', (req, res) => {
    const p = ownPlaylist(req);
    const ids = [].concat(req.body?.trackIds || req.body?.trackId || []);
    if (!ids.length || ids.some((id) => !store.track(id))) throw httpError(400, 'Unknown track');
    if (p.trackIds.length + ids.length > 5000) throw httpError(400, 'Playlist is full');
    p.trackIds.push(...ids);
    p.updatedAt = Date.now();
    store.save();
    res.json(publicPlaylist(p, req.user, true));
  });

  // Index-based so duplicate songs in one playlist can be removed individually.
  api.delete('/playlists/:id/tracks/:index', (req, res) => {
    const p = ownPlaylist(req);
    const i = Number(req.params.index);
    if (!Number.isInteger(i) || i < 0 || i >= p.trackIds.length) throw httpError(400, 'Bad index');
    p.trackIds.splice(i, 1);
    p.updatedAt = Date.now();
    store.save();
    res.json(publicPlaylist(p, req.user, true));
  });

  // Reorder: body.trackIds must be a permutation of the current list.
  api.put('/playlists/:id/tracks', (req, res) => {
    const p = ownPlaylist(req);
    const next = req.body?.trackIds;
    const sorted = (a) => [...a].sort().join(',');
    if (!Array.isArray(next) || next.length !== p.trackIds.length || sorted(next) !== sorted(p.trackIds)) {
      throw httpError(400, 'trackIds must contain exactly the playlist\'s current songs');
    }
    p.trackIds = next.map(String);
    p.updatedAt = Date.now();
    store.save();
    res.json(publicPlaylist(p, req.user, true));
  });

  api.post('/playlists/:id/cover', imageUpload.single('image'), async (req, res) => {
    const p = ownPlaylist(req);
    const url = await saveImage(req.file);
    await removeImage(p.cover);
    p.cover = url;
    p.updatedAt = Date.now();
    store.save();
    res.json(publicPlaylist(p, req.user, true));
  });

  // ---------- search ----------
  api.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) return res.json({ local: [], playlists: [], archive: [], jamendo: [], errors: {} });
    const wanted = new Set(String(req.query.sources || 'local,archive,jamendo').split(','));
    const needle = q.toLowerCase();
    const match = (...fields) => fields.some((f) => f && f.toLowerCase().includes(needle));

    const local = wanted.has('local')
      ? localTracks().filter((t) => match(t.title, t.artist, t.album)).sort(byNewest).slice(0, 50).map((t) => publicTrack(t, req.user))
      : [];
    const playlists = wanted.has('local')
      ? store.playlists.filter((p) => match(p.name, p.description)).slice(0, 20).map((p) => publicPlaylist(p, req.user))
      : [];

    const errors = {};
    const run = async (name, fn) => {
      if (!wanted.has(name)) return [];
      try {
        return await fn(q);
      } catch (err) {
        errors[name] = err.message;
        return [];
      }
    };
    const [archive, jamendo] = await Promise.all([run('archive', searchArchive), run('jamendo', searchJamendo)]);
    if (jamendo === null) errors.jamendo = 'Not configured (set JAMENDO_CLIENT_ID)';
    res.json({ local, playlists, archive, jamendo: jamendo || [], errors });
  });

  // ---------- downloads ----------
  api.get('/downloads', (req, res) => res.json(downloader.list(req.user.id)));
  api.post('/downloads', async (req, res) => {
    res.status(202).json(await downloader.enqueue(req.user.id, req.body?.url));
  });
  api.post('/downloads/:id/cancel', (req, res) => res.json(downloader.cancel(req.user.id, req.params.id)));
  api.post('/downloads/:id/retry', (req, res) => res.json(downloader.retry(req.user.id, req.params.id)));

  // ---------- rooms (REST view; live control is over Socket.IO) ----------
  api.get('/rooms/:code', (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) throw httpError(404, 'Room not found');
    res.json(rooms.snapshot(room, (id) => publicTrack(store.track(id), req.user)));
  });

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // SPA fallback for client-side routes.
  app.get(/^\/(?!api\/|covers\/|images\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (req.files) for (const f of req.files) fsp.rm(f.path, { force: true });
    if (req.file) fsp.rm(req.file.path, { force: true });
    let status = err.status || err.statusCode || 500;
    let message = err.message || 'Server error';
    if (err.code === 'LIMIT_FILE_SIZE') [status, message] = [413, 'File is too large'];
    else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') [status, message] = [400, 'Too many files'];
    if (status >= 500) console.error(err);
    if (res.headersSent) return res.destroy();
    res.status(status).json({ error: status >= 500 && !err.expose && !err.status ? 'Server error' : message });
  });

  attachSockets({ io, auth, rooms, store, publicTrack });

  async function close() {
    store.flush();
    io.close();
    await new Promise((r) => server.close(() => r()));
  }

  return { app, server, io, store, rooms, downloader, dirs, close };
}
