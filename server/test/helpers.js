import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

/** Boots an isolated server on a random port with a temp data dir. */
export async function startServer(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-test-'));
  const ctx = createApp({ dataDir, ytdlpPath: '', ...opts });
  await new Promise((r) => ctx.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  return {
    ...ctx,
    base,
    async stop() {
      await ctx.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function api(base, method, url, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, json, text };
}

let n = 0;
export async function newUser(base, name) {
  const username = name || `user${process.pid}${++n}`;
  const r = await api(base, 'POST', '/api/auth/register', { body: { username, password: 'secret123' } });
  if (r.status !== 201) throw new Error(`register failed: ${r.text}`);
  return r.json;
}

/** 1s 8 kHz mono 16-bit sine WAV with RIFF INFO tags (title/artist/album). */
export function makeWav({ title = 'Test Tone', artist = 'Test Artist', album = 'Test Album', seconds = 1 } = {}) {
  const rate = 8000;
  const samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), i * 2);

  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * 2, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);

  const chunk = (id, body) => {
    const pad = body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
    const head = Buffer.alloc(8);
    head.write(id, 0, 'latin1');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, pad]);
  };
  const str = (s) => Buffer.from(s + '\0', 'latin1');
  const info = Buffer.concat([Buffer.from('INFO'), chunk('INAM', str(title)), chunk('IART', str(artist)), chunk('IPRD', str(album))]);
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('data', data), chunk('LIST', info)]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

export async function upload(base, token, files) {
  const fd = new FormData();
  for (const f of files) fd.append('files', new Blob([f.data], { type: f.type || 'audio/wav' }), f.name);
  return api(base, 'POST', '/api/tracks', { token, body: fd });
}
