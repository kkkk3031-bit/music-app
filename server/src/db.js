// Tiny JSON-file store. Everything lives in memory and is flushed to
// data/db.json with an atomic write (tmp file + rename), debounced so bursts of
// changes become one write.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = () => ({ users: [], tracks: [], playlists: [], messages: [] });

export function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

export class Store {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'db.json');
    this.timer = null;
    try {
      this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = EMPTY();
    }
  }

  get users() { return this.data.users; }
  get tracks() { return this.data.tracks; }
  get playlists() { return this.data.playlists; }
  get messages() { return this.data.messages; }

  user(id) { return this.data.users.find((u) => u.id === id); }
  track(id) { return this.data.tracks.find((t) => t.id === id); }
  playlist(id) { return this.data.playlists.find((p) => p.id === id); }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
