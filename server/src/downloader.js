// Download queue: turns a pasted link into library tracks, reporting progress
// through onUpdate(job) (wired to Socket.IO by the caller).
//
// Supported links, in order of preference:
//   archive.org/details/<id>          → every MP3 of the item (one job each)
//   archive.org/download/<id>/<file>  → that file
//   jamendo.com/track/<id>/...        → the track (needs JAMENDO_CLIENT_ID)
//   any URL that serves audio/*       → downloaded directly (public IPs only)
//   anything else                     → yt-dlp, if installed
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { newId } from './db.js';
import { safeFetch, assertPublicHost, hostAllowed } from './net.js';
import { archiveItemTracks, jamendoTrackById, STREAM_HOSTS } from './sources.js';
import { ingestAudio, audioExt } from './media.js';

const MAX_BYTES = 200 * 1024 * 1024;
const CONCURRENCY = 2;
const KEEP_JOBS = 50;

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export class Downloader {
  constructor({ store, dirs, onUpdate = () => {}, ytdlpPath = process.env.YTDLP_PATH || null, findByHash = () => null }) {
    this.findByHash = findByHash;
    this.store = store;
    this.dirs = dirs;
    this.onUpdate = onUpdate;
    this.ytdlpPath = ytdlpPath && fs.existsSync(ytdlpPath) ? ytdlpPath : null;
    this.jobs = [];
    this.running = 0;
  }

  list(userId) {
    return this.jobs.filter((j) => j.userId === userId).map(publicJob);
  }

  /** Validates + expands the URL into one or more queued jobs. */
  async enqueue(userId, rawUrl) {
    let u;
    try {
      u = new URL(String(rawUrl || '').trim());
    } catch {
      throw fail('That is not a valid link');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw fail('Only http(s) links are supported');

    const specs = await this.resolve(u);
    const jobs = specs.map((spec) => ({
      id: newId(),
      userId,
      url: u.toString(),
      status: 'queued',
      progress: 0,
      bytes: 0,
      total: 0,
      title: spec.hints?.title || u.hostname,
      error: null,
      trackId: null,
      createdAt: Date.now(),
      spec,
    }));
    this.jobs.unshift(...jobs);
    this.prune();
    jobs.forEach((j) => this.emit(j));
    this.pump();
    return jobs.map(publicJob);
  }

  find(userId, jobId) {
    const job = this.jobs.find((j) => j.id === jobId && j.userId === userId);
    if (!job) throw fail('Download not found', 404);
    return job;
  }

  /** Queued jobs stop immediately; running ones are aborted mid-transfer. */
  cancel(userId, jobId) {
    const job = this.find(userId, jobId);
    if (job.status === 'queued') {
      job.status = 'canceled';
      this.emit(job);
    } else if (job.status === 'downloading') {
      job.canceled = true;
      job.abort?.abort();
    } else {
      throw fail(`Cannot cancel a download that is ${job.status}`, 409);
    }
    return publicJob(job);
  }

  retry(userId, jobId) {
    const job = this.find(userId, jobId);
    if (job.status !== 'error' && job.status !== 'canceled') throw fail('Only failed or canceled downloads can be retried', 409);
    Object.assign(job, { status: 'queued', progress: 0, bytes: 0, total: 0, error: null, canceled: false });
    this.emit(job);
    this.pump();
    return publicJob(job);
  }

  async resolve(u) {
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (hostAllowed(host, ['archive.org'])) {
      if (parts[0] === 'details' && parts[1]) {
        const tracks = await archiveItemTracks(parts[1], 25);
        if (!tracks.length) throw fail('No MP3 files found in that archive.org item', 404);
        return tracks.map((t) => ({ kind: 'http', url: t.url, allowlist: STREAM_HOSTS, hints: t, source: 'archive' }));
      }
      if (parts[0] === 'download' && parts[2]) {
        return [{ kind: 'http', url: u.toString(), allowlist: STREAM_HOSTS, hints: { title: parts.at(-1) }, source: 'archive' }];
      }
    }

    if (hostAllowed(host, ['jamendo.com'])) {
      const i = parts.indexOf('track');
      if (i >= 0 && /^\d+$/.test(parts[i + 1] || '')) {
        const t = await jamendoTrackById(parts[i + 1]);
        return [{ kind: 'http', url: t.downloadUrl || t.url, allowlist: STREAM_HOSTS, hints: t, source: 'jamendo' }];
      }
    }

    await assertPublicHost(host);
    if (audioExt(u.pathname)) return [{ kind: 'http', url: u.toString(), hints: {}, source: 'link' }];

    // Unknown page: peek at the content type before deciding.
    let type = '';
    try {
      const res = await safeFetch(u.toString(), { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      type = (res.headers.get('content-type') || '').toLowerCase();
    } catch {
      // HEAD not supported / blocked — fall through to yt-dlp.
    }
    if (type.startsWith('audio/')) return [{ kind: 'http', url: u.toString(), hints: {}, source: 'link' }];

    if (!this.ytdlpPath) throw fail('That link is not a direct audio file, and yt-dlp is not installed on this server');
    return [{ kind: 'ytdlp', url: u.toString(), hints: {}, source: 'link' }];
  }

  pump() {
    while (this.running < CONCURRENCY) {
      const job = [...this.jobs].reverse().find((j) => j.status === 'queued');
      if (!job) return;
      this.running++;
      this.run(job).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  async run(job) {
    const tmpBase = path.join(this.dirs.tmp, `dl-${job.id}`);
    job.abort = new AbortController();
    try {
      job.status = 'downloading';
      this.emit(job);
      const { tmpPath, name, mime, hints } =
        job.spec.kind === 'ytdlp' ? await this.runYtdlp(job, tmpBase) : await this.runHttp(job, tmpBase);

      if (job.canceled) throw fail('Canceled');
      job.status = 'processing';
      this.emit(job);
      const track = await ingestAudio({
        tmpPath,
        originalName: name,
        mime,
        ownerId: job.userId,
        dirs: this.dirs,
        source: job.spec.source === 'link' ? 'download' : job.spec.source,
        hints,
        findByHash: this.findByHash,
      });
      if (!this.store.track(track.id)) this.store.tracks.push(track);
      this.store.save();
      job.trackId = track.id;
      job.title = track.title;
      job.progress = 1;
      job.status = 'done';
    } catch (err) {
      job.status = job.canceled ? 'canceled' : 'error';
      job.error = job.canceled ? null : err.message || 'Download failed';
      for (const f of await fsp.readdir(this.dirs.tmp).catch(() => [])) {
        if (f.startsWith(`dl-${job.id}`)) await fsp.rm(path.join(this.dirs.tmp, f), { force: true });
      }
    }
    job.abort = null;
    this.emit(job);
  }

  async runHttp(job, tmpBase) {
    const { url, allowlist, hints } = job.spec;
    const res = await safeFetch(url, { allowlist, signal: AbortSignal.any([job.abort.signal, AbortSignal.timeout(10 * 60 * 1000)]) });
    if (!res.ok || !res.body) throw fail(`Server returned ${res.status}`, 502);
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const finalName = decodeURIComponent(new URL(res.url || url).pathname.split('/').pop() || '');
    const name = audioExt(finalName) ? finalName : `${hints.title || 'download'}${audioExt('', mime) || ''}`;
    if (!audioExt(name, mime)) throw fail(`Link did not return audio (got ${mime || 'unknown type'})`, 415);

    job.total = Number(res.headers.get('content-length')) || 0;
    if (job.total > MAX_BYTES) throw fail('File is larger than 200 MB', 413);

    const tmpPath = `${tmpBase}${audioExt(name, mime)}`;
    let lastEmit = 0;
    const counter = async function* (source) {
      for await (const chunk of source) {
        job.bytes += chunk.length;
        if (job.bytes > MAX_BYTES) throw fail('File is larger than 200 MB', 413);
        if (job.total) job.progress = Math.min(0.99, job.bytes / job.total);
        if (Date.now() - lastEmit > 400) {
          lastEmit = Date.now();
          this.emit(job);
        }
        yield chunk;
      }
    }.bind(this);
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmpPath));
    return { tmpPath, name, mime, hints: hints || {} };
  }

  runYtdlp(job, tmpBase) {
    return new Promise((resolve, reject) => {
      const args = [
        '--no-playlist', '--no-warnings', '--newline', '--no-simulate',
        '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
        '--max-filesize', '200M',
        '-o', `${tmpBase}.%(ext)s`,
        '--print', 'after_move:%(filepath)s\t%(title)s\t%(uploader)s\t%(duration)s',
        '--', job.spec.url,
      ];
      const proc = spawn(this.ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      let lastEmit = 0;
      const killer = setTimeout(() => proc.kill('SIGKILL'), 15 * 60 * 1000);
      job.abort.signal.addEventListener('abort', () => proc.kill('SIGKILL'), { once: true });
      proc.stdout.on('data', (d) => {
        out += d;
        const m = String(d).match(/\[download\]\s+([\d.]+)%/);
        if (m && Date.now() - lastEmit > 400) {
          lastEmit = Date.now();
          job.progress = Math.min(0.99, Number(m[1]) / 100);
          this.emit(job);
        }
      });
      proc.stderr.on('data', (d) => (err += d));
      proc.on('error', (e) => {
        clearTimeout(killer);
        reject(fail(`Could not run yt-dlp: ${e.message}`, 500));
      });
      proc.on('close', (code) => {
        clearTimeout(killer);
        const line = out.split('\n').find((l) => l.startsWith(tmpBase));
        if (code !== 0 || !line) return reject(fail(ytdlpError(job.spec.url, err), 502));
        const [filePath, title, uploader, duration] = line.split('\t');
        resolve({
          tmpPath: filePath,
          name: path.basename(filePath),
          mime: '',
          hints: { title, artist: uploader !== 'NA' ? uploader : undefined, duration: Number(duration) || 0 },
        });
      });
    });
  }

  emit(job) {
    this.onUpdate(publicJob(job));
  }

  prune() {
    const byUser = new Map();
    this.jobs = this.jobs.filter((j) => {
      const n = (byUser.get(j.userId) || 0) + 1;
      byUser.set(j.userId, n);
      return n <= KEEP_JOBS || ['queued', 'downloading', 'processing'].includes(j.status);
    });
  }
}

function ytdlpError(url, stderr) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (/youtube\.com|youtu\.be/.test(host) && /sign in|bot|429|403|unavailable|blocked/i.test(stderr)) {
    return 'YouTube blocks downloads from this server\'s IP address. Use a direct audio link, archive.org or Jamendo instead.';
  }
  const last = stderr.trim().split('\n').filter((l) => l.startsWith('ERROR')).pop();
  return last ? last.replace(/^ERROR:\s*/, '').slice(0, 300) : 'yt-dlp could not download that link';
}

function publicJob(j) {
  const { spec, abort, canceled, ...rest } = j;
  return rest;
}
