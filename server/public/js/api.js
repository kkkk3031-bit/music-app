// REST client. The JWT lives in localStorage; audio/image URLs that need auth
// get it as ?t= because media elements can't send headers.
const TOKEN_KEY = 'cadence.token';
const USER_KEY = 'cadence.user';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  set(token, user) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function request(method, path, body) {
  const headers = {};
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

export const get = (p) => request('GET', p);
export const post = (p, b) => request('POST', p, b ?? {});
export const put = (p, b) => request('PUT', p, b ?? {});
export const patch = (p, b) => request('PATCH', p, b ?? {});
export const del = (p) => request('DELETE', p);

export function streamSrc(track) {
  return `${track.streamUrl}?t=${encodeURIComponent(session.token)}`;
}

/** Multipart upload with progress (fetch can't report upload progress). */
export function uploadFiles(files, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/tracks');
    xhr.setRequestHeader('authorization', `Bearer ${session.token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status === 401) onUnauthorized();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else if (data.errors?.length) resolve(data);
      else reject(new ApiError(xhr.status, data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(fd);
  });
}

export async function uploadImage(path, file) {
  const fd = new FormData();
  fd.append('image', file);
  return request('POST', path, fd);
}
