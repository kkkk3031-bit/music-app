import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { newId } from './db.js';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;

// JWT_SECRET from the environment wins; otherwise a random secret is generated
// once and persisted so tokens survive restarts.
export function loadSecret(dataDir) {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, 'secret.key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

export function publicUser(u) {
  return { id: u.id, username: u.username, avatar: u.avatar || null, createdAt: u.createdAt };
}

export function createAuth({ store, secret }) {
  const sign = (u) => jwt.sign({ sub: u.id }, secret, { expiresIn: '30d' });

  function verify(token) {
    try {
      const { sub } = jwt.verify(token, secret);
      return store.user(sub) || null;
    } catch {
      return null;
    }
  }

  // Bearer header for API calls; ?t= for <audio>/<img> src URLs, which can't
  // carry headers.
  function requireUser(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.t;
    const user = token && verify(token);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    req.user = user;
    next();
  }

  async function register(username, password) {
    username = String(username || '').trim();
    password = String(password || '');
    if (!USERNAME_RE.test(username)) {
      throw Object.assign(new Error('Username must be 3-24 letters, numbers, _ . or -'), { status: 400 });
    }
    if (password.length < 6 || password.length > 128) {
      throw Object.assign(new Error('Password must be 6-128 characters'), { status: 400 });
    }
    const lower = username.toLowerCase();
    if (store.users.some((u) => u.username.toLowerCase() === lower)) {
      throw Object.assign(new Error('Username is taken'), { status: 409 });
    }
    const user = {
      id: newId(),
      username,
      passHash: await bcrypt.hash(password, 10),
      avatar: null,
      likes: [],
      recent: [],
      recentPlaylists: [],
      createdAt: Date.now(),
    };
    store.users.push(user);
    store.save();
    return { token: sign(user), user: publicUser(user) };
  }

  async function login(username, password) {
    const lower = String(username || '').trim().toLowerCase();
    const user = store.users.find((u) => u.username.toLowerCase() === lower);
    const ok = user && (await bcrypt.compare(String(password || ''), user.passHash));
    if (!ok) throw Object.assign(new Error('Wrong username or password'), { status: 401 });
    return { token: sign(user), user: publicUser(user) };
  }

  return { requireUser, verify, register, login };
}

// Fixed-window limiter keyed by IP, for the auth endpoints.
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    if (++entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many attempts, try again later' });
    }
    if (hits.size > 10000) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    next();
  };
}
