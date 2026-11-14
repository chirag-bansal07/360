// Small helpers shared by the screens.
export async function api<T = any>(url: string, method = 'GET', body?: any): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the SunCraft3D server. Check your connection, or that the app is still running.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined') { window.location.href = '/login'; throw new Error('Please sign in again.'); }
  if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status}).`);
  return data as T;
}

// The last answer to each GET, kept for this visit. A screen shows it straight away and then loads the fresh one.
const kept = new Map<string, any>();
export const peek = <T = any>(url: string): T | null => (kept.has(url) ? (kept.get(url) as T) : null);
export async function apiKeep<T = any>(url: string): Promise<T> {
  const r = await api<T>(url);
  kept.set(url, r);
  return r;
}
export const forget = (prefix = '') => { for (const k of [...kept.keys()]) if (k.startsWith(prefix)) kept.delete(k); };

export const fmt = (n: number, d = 2) => (isFinite(n) ? n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '-');
export const fmt0 = (n: number) => fmt(n, 0);
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} | ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
