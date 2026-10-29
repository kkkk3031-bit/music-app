// Turning an audio file on disk into a library track: validate the type, read
// tags + embedded cover art, move it into the media dir under a generated name.
import fs from 'node:fs/promises';
import path from 'node:path';
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

/**
 * Parse + move `tmpPath` into the library. `hints` can supply title/artist/etc.
 * that win over missing tags (e.g. from a download source's metadata).
 * Throws (and deletes the tmp file) if the content isn't decodable audio.
 */
export async function ingestAudio({ tmpPath, originalName, mime, ownerId, dirs, source = 'upload', hints = {} }) {
  const ext = audioExt(originalName, mime);
  if (!ext) {
    await fs.rm(tmpPath, { force: true });
    throw Object.assign(new Error('Unsupported audio format'), { status: 415 });
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
    cover,
    createdAt: Date.now(),
  };
}
