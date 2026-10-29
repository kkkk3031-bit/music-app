// Free/legal online catalogues: Internet Archive (no key) and Jamendo (needs a
// free client id in JAMENDO_CLIENT_ID; skipped when unset). Results are plain
// "remote track" descriptors the client can play or add to playlists.
import { fetchJson } from './net.js';

export const STREAM_HOSTS = ['archive.org', 'jamendo.com'];

const IA_COLLECTIONS = 'etree OR netlabels OR audio_music OR georgeblood OR opensource_audio OR 78rpm';
const TRACKS_PER_ITEM = 4;

function parseLength(len) {
  if (!len) return 0;
  if (String(len).includes(':')) {
    return String(len).split(':').reduce((acc, part) => acc * 60 + Number(part || 0), 0);
  }
  return Math.round(Number(len) || 0);
}

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

/** All playable MP3 tracks of one archive.org item, as remote descriptors. */
export async function archiveItemTracks(identifier, limit = TRACKS_PER_ITEM) {
  const d = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
    allowlist: STREAM_HOSTS,
  });
  if (!d?.files) return [];
  const md = d.metadata || {};
  return d.files
    .filter((f) => /mp3/i.test(f.format || '') && f.name?.toLowerCase().endsWith('.mp3'))
    .slice(0, limit)
    .map((f) => ({
      source: 'archive',
      sourceId: `${identifier}/${f.name}`,
      title: f.title || f.name.replace(/\.mp3$/i, ''),
      artist: f.creator || first(md.creator) || 'Internet Archive',
      album: f.album || first(md.title) || identifier,
      duration: parseLength(f.length),
      cover: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      url: `https://archive.org/download/${encodeURIComponent(identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
    }));
}

export async function searchArchive(q, { items = 5 } = {}) {
  const term = q.replace(/[()"\\:]/g, ' ').trim();
  if (!term) return [];
  const params = new URLSearchParams({
    q: `(title:(${term}) OR creator:(${term})) AND mediatype:audio AND collection:(${IA_COLLECTIONS})`,
    rows: String(items),
    output: 'json',
  });
  params.append('fl[]', 'identifier');
  params.append('sort[]', 'downloads desc');
  const d = await fetchJson(`https://archive.org/advancedsearch.php?${params}`, { allowlist: STREAM_HOSTS });
  const ids = (d?.response?.docs || []).map((doc) => doc.identifier);
  const lists = await Promise.allSettled(ids.map((id) => archiveItemTracks(id)));
  return lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

function jamendoTrack(t) {
  return {
    source: 'jamendo',
    sourceId: String(t.id),
    title: t.name,
    artist: t.artist_name,
    album: t.album_name || 'Jamendo',
    duration: Number(t.duration) || 0,
    cover: t.album_image || t.image || null,
    url: t.audio,
    downloadUrl: t.audiodownload_allowed ? t.audiodownload : null,
  };
}

export async function searchJamendo(q, { limit = 15 } = {}) {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) return null; // "not configured", distinct from "no results"
  const params = new URLSearchParams({ client_id: clientId, format: 'json', limit: String(limit), search: q, audioformat: 'mp32' });
  const d = await fetchJson(`https://api.jamendo.com/v3.0/tracks/?${params}`, { allowlist: STREAM_HOSTS });
  if (d?.headers?.status !== 'success') {
    throw Object.assign(new Error(d?.headers?.error_message || 'Jamendo error'), { status: 502 });
  }
  return d.results.filter((t) => t.audio).map(jamendoTrack);
}

export async function jamendoTrackById(id) {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) throw Object.assign(new Error('Jamendo is not configured on this server (JAMENDO_CLIENT_ID)'), { status: 400 });
  const params = new URLSearchParams({ client_id: clientId, format: 'json', id: String(id), audioformat: 'mp32' });
  const d = await fetchJson(`https://api.jamendo.com/v3.0/tracks/?${params}`, { allowlist: STREAM_HOSTS });
  const t = d?.results?.[0];
  if (!t) throw Object.assign(new Error('Jamendo track not found'), { status: 404 });
  return jamendoTrack(t);
}
