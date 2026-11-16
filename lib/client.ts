// Small helpers shared by the screens.
export async function api<T = any>(url: string, method = 'GET', body?: any): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the SunCraft3D server. Check your connection, or that the app is still running.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined') { forgetAll(); window.location.href = '/login'; throw new Error('Please sign in again.'); }
  if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status}).`);
  if (method !== 'GET') { flying.clear(); gotAt.clear(); } // something changed: what was loaded before may be out of date
  return data as T;
}

// The last answer to each GET is kept: in memory for this visit, and (lists and summaries) in the browser's storage
// for the next visit. A screen shows the kept answer straight away and then loads the fresh one behind it.
const kept = new Map<string, any>();
const gotAt = new Map<string, number>();
const flying = new Map<string, Promise<any>>();
const STORE = 'sc:kept:';
const storable = (url: string) => !url.startsWith('/api/designs/'); // a design is never shown from an old copy
// In memory only: safe to use while a page is first drawn.
export const peek = <T = any>(url: string): T | null => (kept.has(url) ? (kept.get(url) as T) : null);
// Memory, then the browser's storage. Call it after the page is on screen (in an effect), not while it is first drawn.
export function stored<T = any>(url: string): T | null {
  if (kept.has(url)) return kept.get(url) as T;
  try {
    const raw = storable(url) ? window.localStorage.getItem(STORE + url) : null;
    if (raw) { const v = JSON.parse(raw); kept.set(url, v); return v as T; }
  } catch { /* storage switched off: nothing kept */ }
  return null;
}
// Loads an address. Asking again while the answer is still on its way gives the same answer, not a second request.
export function apiKeep<T = any>(url: string): Promise<T> {
  const now = flying.get(url);
  if (now) return now as Promise<T>;
  const p = api<T>(url).then((r) => {
    kept.set(url, r); gotAt.set(url, Date.now());
    try { if (storable(url)) { const s = JSON.stringify(r); if (s.length < 300000) window.localStorage.setItem(STORE + url, s); } } catch { /* storage full or off */ }
    return r;
  }).finally(() => { if (flying.get(url) === p) flying.delete(url); });
  flying.set(url, p);
  return p;
}
// The answer loaded in the last few seconds (for example while the pointer was over the link), or a new one.
export function apiRecent<T = any>(url: string, ms = 15000): Promise<T> {
  const at = gotAt.get(url);
  return at && Date.now() - at < ms && kept.has(url) ? Promise.resolve(kept.get(url) as T) : apiKeep<T>(url);
}
// Starts loading an address before it is needed.
export const preload = (url: string) => { if (!flying.has(url) && !(Date.now() - (gotAt.get(url) || 0) < 15000)) apiKeep(url).catch(() => {}); };
export const forget = (prefix = '') => { for (const k of [...kept.keys()]) if (k.startsWith(prefix)) { kept.delete(k); gotAt.delete(k); } };
// Signing out, or a session that ended: nothing of this login stays in the browser.
export function forgetAll() {
  kept.clear(); gotAt.clear(); flying.clear();
  try { for (const k of Object.keys(window.localStorage)) if (k.startsWith('sc:')) window.localStorage.removeItem(k); } catch { /* storage off */ }
}

export const fmt = (n: number, d = 2) => (isFinite(n) ? n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '-');
export const fmt0 = (n: number) => fmt(n, 0);
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} | ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
