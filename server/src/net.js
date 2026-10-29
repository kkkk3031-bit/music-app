// Outbound HTTP with SSRF guards. Every hop of a redirect chain is re-checked:
// either against a host allowlist (streaming proxy) or against private/loopback
// address ranges (user-supplied download URLs).
import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(new Error('That address is not allowed'), { status: 400 });
  }
}

export function hostAllowed(hostname, allowlist) {
  const h = hostname.toLowerCase();
  return allowlist.some((d) => h === d || h.endsWith('.' + d));
}

/**
 * fetch() that follows up to 5 redirects manually, validating each URL.
 * opts.allowlist: array of domains — if set, every hop must match it;
 * otherwise every hop must resolve to a public IP.
 */
export async function safeFetch(url, { allowlist, headers = {}, signal, method = 'GET' } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw Object.assign(new Error('Only http(s) URLs are supported'), { status: 400 });
    }
    if (allowlist) {
      if (!hostAllowed(u.hostname, allowlist)) {
        throw Object.assign(new Error('Host not allowed'), { status: 400 });
      }
    } else {
      await assertPublicHost(u.hostname);
    }
    const res = await fetch(u, {
      method,
      headers: { 'user-agent': 'CadenceMusic/0.1', ...headers },
      redirect: 'manual',
      signal,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      res.body?.cancel();
      current = new URL(res.headers.get('location'), u).toString();
      continue;
    }
    return res;
  }
  throw Object.assign(new Error('Too many redirects'), { status: 502 });
}

export async function fetchJson(url, opts = {}) {
  const res = await safeFetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(10000) });
  if (!res.ok) throw Object.assign(new Error(`Upstream returned ${res.status}`), { status: 502 });
  return res.json();
}
