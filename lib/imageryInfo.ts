// Which satellite picture a site uses (source and zoom). Finding it takes the server about a second, so the answer
// is asked for as early as possible and remembered in the browser. A remembered answer is used at once and
// checked again a little later for the next visit.
const asked = new Map<string, Promise<any>>();
const KEY = 'sc:img:';
const DAY = 86400000;

function load(base: string, lat: number, lng: number, k: string): Promise<any> {
  return fetch(`${base}/imagery?lat=${lat}&lng=${lng}`).then((r) => r.json()).then((info) => {
    try {
      // only the plain answer is remembered: an aerial picture or a warning is asked for again each time
      if (base === '/api' && info?.provider && !info.overlay && !info.warning) window.localStorage.setItem(KEY + k, JSON.stringify({ at: Date.now(), info }));
      else window.localStorage.removeItem(KEY + k);
    } catch { /* storage off */ }
    return info;
  });
}

export function imageryInfo(base: string, lat: number, lng: number): Promise<any> {
  const k = `${base}|${lat}|${lng}`;
  let p = asked.get(k);
  if (p) return p;
  let old: any = null;
  try { if (base === '/api') old = JSON.parse(window.localStorage.getItem(KEY + k) || 'null'); } catch { /* storage off */ }
  if (old?.info && Date.now() - old.at < DAY) {
    p = Promise.resolve(old.info);
    setTimeout(() => { load(base, lat, lng, k).catch(() => {}); }, 4000); // refreshed for next time, after the tiles have loaded
  } else p = load(base, lat, lng, k);
  asked.set(k, p);
  p.catch(() => asked.delete(k));
  return p;
}

// The remembered answer did not work (most tiles failed): ask again next time.
export function forgetImagery(base: string, lat: number, lng: number) {
  const k = `${base}|${lat}|${lng}`;
  asked.delete(k);
  try { window.localStorage.removeItem(KEY + k); } catch { /* storage off */ }
}
