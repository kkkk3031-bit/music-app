// DOM helpers. h() builds elements with text set via textContent, so user
// data (titles, chat) never goes through innerHTML. Only the static icon SVGs
// below are injected as markup.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  library: '<path d="M4 4v16M9 4v16M14 4l6 16"/>',
  rooms: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.9.3 5 2.7 5 5.8"/>',
  upload: '<path d="M12 16V4m0 0-5 5m5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12m0 0-5-5m5 5 5-5"/><path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  heart: '<path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z"/>',
  queue: '<path d="M4 6h12M4 12h12M4 18h8"/><path d="m16 15 5 3-5 3z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  message: '<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.1A8.5 8.5 0 1 1 21 12z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  lyrics: '<path d="M4 6h16M4 10h16M4 14h11M4 18h7"/><circle cx="18" cy="18" r="2.2"/><path d="M20.2 18V11"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8"/><path d="M21 4v5h-5M3 20v-5h5"/>',
};
const FILLED = {
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
  pause: '<rect x="6" y="4" width="4.5" height="16" rx="1.2"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2"/>',
  next: '<path d="M5 5.2v13.6a1 1 0 0 0 1.5.86L17 13v6h2V5h-2v6L6.5 4.34A1 1 0 0 0 5 5.2z"/>',
  prev: '<path d="M19 5.2v13.6a1 1 0 0 1-1.5.86L7 13v6H5V5h2v6l10.5-6.66A1 1 0 0 1 19 5.2z"/>',
  heartFill: '<path d="M12 21s-7.5-4.7-9.8-9.6A5.4 5.4 0 0 1 12 5.6a5.4 5.4 0 0 1 9.8 5.8C19.5 16.3 12 21 12 21z"/>',
};

export function icon(name, extraClass = '') {
  const filled = name in FILLED;
  const span = document.createElement('span');
  span.innerHTML = `<svg class="i${filled ? ' fill' : ''} ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${filled ? FILLED[name] : P[name] || ''}</svg>`;
  return span.firstChild;
}

export function iconBtn(name, label, onClick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`, title: label, 'aria-label': label, onclick: onClick }, icon(name));
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function fmtTotal(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}

/** Stable hue (0-359) from a string, for generated artwork. */
export function hueOf(seed) {
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.codePointAt(0)) >>> 0;
  return x % 360;
}

// With a seed, a missing cover becomes a colored gradient instead of a gray box.
export function coverEl(url, cls = '', fallbackIcon = 'music', seed = null) {
  const el = h('div', { class: `cover ${cls}` });
  const fallback = () => {
    if (seed == null) return icon(fallbackIcon);
    const hue = hueOf(seed);
    el.classList.add('gen');
    el.style.background = `linear-gradient(135deg, hsl(${hue} 65% 52%), hsl(${(hue + 50) % 360} 60% 24%))`;
    return icon(fallbackIcon);
  };
  if (url) {
    const img = h('img', { src: url, alt: '', loading: 'lazy' });
    img.onerror = () => img.replaceWith(fallback());
    el.append(img);
  } else el.append(fallback());
  return el;
}

export function avatarEl(user, cls = '') {
  if (user?.avatar) return h('img', { class: `avatar ${cls}`, src: user.avatar, alt: '' });
  return h('div', { class: `avatar ${cls}` }, (user?.username || '?')[0].toUpperCase());
}

export function toast(message, type = 'info') {
  const el = h('div', { class: `toast ${type}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3200);
}

export const toastError = (err) => toast(err?.message || String(err), 'error');

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Modal with content + optional action buttons; returns { close }. */
export function modal(title, body, actions = []) {
  const root = document.getElementById('overlay-root');
  const close = () => backdrop.remove();
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => e.target === backdrop && close() },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
      h('h3', {}, title),
      body,
      actions.length ? h('div', { class: 'actions' }, actions.map((a) => h('button', { class: `btn ${a.cls || ''}`, onclick: () => a.onClick(close) }, a.label))) : null));
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  root.append(backdrop);
  backdrop.querySelector('input, textarea, button')?.focus();
  return { close };
}

export function prompt(title, { value = '', placeholder = '', okLabel = 'Save' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value, placeholder, maxlength: 100 });
    let done = false;
    const finish = (v, close) => { done = true; close(); resolve(v); };
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); finish(input.value.trim(), m.close); } }, input);
    const m = modal(title, form, [
      { label: 'Cancel', cls: 'ghost', onClick: (close) => finish(null, close) },
      { label: okLabel, cls: 'primary', onClick: (close) => finish(input.value.trim(), close) },
    ]);
    const obs = new MutationObserver(() => { if (!form.isConnected) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(document.getElementById('overlay-root'), { childList: true });
    input.select();
  });
}

export function confirmDialog(title, message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    modal(title, h('p', { class: 'muted' }, message), [
      { label: 'Cancel', cls: 'ghost', onClick: (close) => { close(); resolve(false); } },
      { label: okLabel, cls: 'primary', onClick: (close) => { close(); resolve(true); } },
    ]);
  });
}

/** Context menu at the anchor element or mouse event. items: {label, icon, onClick, danger} | 'sep' */
export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const el = h('div', { class: 'menu', role: 'menu' },
    items.filter(Boolean).map((it) => it === 'sep' ? h('hr') : h('button', {
      class: it.danger ? 'danger' : '',
      role: 'menuitem',
      onclick: (e) => { e.stopPropagation(); el.remove(); it.onClick(); },
    }, it.icon ? icon(it.icon) : null, it.label)));
  document.body.append(el);
  const r = anchor instanceof Event ? { left: anchor.clientX, right: anchor.clientX, top: anchor.clientY, bottom: anchor.clientY } : anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let left = Math.min(r.right - w, window.innerWidth - w - 8);
  if (left < 8) left = Math.min(r.left, window.innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${top}px`;
  setTimeout(() => {
    const off = (e) => { if (!el.contains(e.target)) { el.remove(); document.removeEventListener('pointerdown', off); } };
    document.addEventListener('pointerdown', off);
  });
  return el;
}

export function setRangeFill(input) {
  const max = Number(input.max) || 1;
  input.style.setProperty('--pct', `${(Number(input.value) / max) * 100}%`);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
