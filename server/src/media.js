// Turning an audio file on disk into a library track: validate the type, read
// tags + embedded cover art, move it into the media dir under a generated name.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFile } from 'music-metadata';
import { newId } from './db.js';

export const AUDIO_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
};

export const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const PICTURE_EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export function audioExt(filename, mime) {
  const ext = path.extname(filename || '').toLowerCase();
  if (AUDIO_TYPES[ext]) return ext;
  const fromMime = Object.entries(AUDIO_TYPES).find(([, m]) => m === (mime || '').split(';')[0]);
  return fromMime ? fromMime[0] : null;
}

// Strip a filename down to something presentable when there is no title tag.
function titleFromName(name) {
  return path.basename(name || 'Untitled', path.extname(name || '')).replace(/[_]+/g, ' ').trim() || 'Untitled';
}

const MAX_LYRICS = 20000;
const LRC_LINE = /^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m;

export function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

/** Normalises user/tag lyrics; returns null when empty. */
export function cleanLyrics(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_LYRICS);
  return s || null;
}

export const isSyncedLyrics = (text) => Boolean(text && LRC_LINE.test(text));

const lrcStamp = (ms) => {
  const m = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
  return `[${String(m).padStart(2, '0')}:${sec}]`;
};

// Tag lyrics → plain string; synced (SYLT, ms timestamps) become LRC lines.
function lyricsFromTags(tags = []) {
  for (const l of tags) {
    if (typeof l === 'string' && l.trim()) return cleanLyrics(l);
    if (l?.syncText?.length && l.timeStampFormat === 2) {
      return cleanLyrics(l.syncText.map((x) => `${lrcStamp(x.timestamp || 0)}${x.text}`).join('\n'));
    }
    if (l?.text?.trim()) return cleanLyrics(l.text);
  }
  return null;
}

/**
 * Parse + move `tmpPath` into the library. `hints` can supply title/artist/etc.
 * that win over missing tags (e.g. from a download source's metadata).
 * Throws (and deletes the tmp file) if the content isn't decodable audio.
 * If `findByHash` returns a track with identical bytes, that track is returned
 * as-is (callers detect this via store membership) and the tmp file is removed.
 */
export async function ingestAudio({ tmpPath, originalName, mime, ownerId, dirs, source = 'upload', hints = {}, findByHash = () => null }) {
  const ext = audioExt(originalName, mime);
  if (!ext) {
    await fs.rm(tmpPath, { force: true });
    throw Object.assign(new Error('Unsupported audio format'), { status: 415 });
  }
  // Identical bytes already in the library: reuse that track, drop the copy.
  const hash = await hashFile(tmpPath);
  const dup = findByHash(hash);
  if (dup) {
    await fs.rm(tmpPath, { force: true });
    return dup;
  }
  let meta;
  try {
    meta = await parseFile(tmpPath, { duration: true });
  } catch {
    await fs.rm(tmpPath, { force: true });
    throw Object.assign(new Error('File is not a readable audio file'), { status: 415 });
  }
  if (!meta.format?.container && !meta.format?.codec) {
    await fs.rm(tmpPath, { force: true });
    throw Object.assign(new Error('File is not a readable audio file'), { status: 415 });
  }

  const id = newId();
  const file = id + ext;
  await fs.rename(tmpPath, path.join(dirs.media, file));
  const stat = await fs.stat(path.join(dirs.media, file));

  let cover = hints.cover || null;
  const pic = meta.common.picture?.[0];
  if (pic && PICTURE_EXT[pic.format]) {
    const coverFile = id + PICTURE_EXT[pic.format];
    await fs.writeFile(path.join(dirs.covers, coverFile), pic.data);
    cover = `/covers/${coverFile}`;
  }

  const c = meta.common;
  return {
    id,
    type: 'local',
    source,
    ownerId,
    title: (c.title || hints.title || titleFromName(originalName)).slice(0, 200),
    artist: (c.artist || c.albumartist || hints.artist || 'Unknown artist').slice(0, 200),
    album: (c.album || hints.album || 'Unknown album').slice(0, 200),
    year: c.year || null,
    trackNo: c.track?.no || null,
    duration: Math.round(meta.format.duration || hints.duration || 0),
    file,
    mime: AUDIO_TYPES[ext],
    size: stat.size,
    hash,
    lyrics: lyricsFromTags(meta.common.lyrics),
    cover,
    createdAt: Date.now(),
  };
}
