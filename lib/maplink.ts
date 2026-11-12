// Read latitude / longitude out of a Google Maps link or plain "lat, lng" text.
// approx = the link only says where the map view was centred, not where the pin is.
export type LatLng = { lat: number; lng: number; approx?: boolean };

const ok = (lat: number, lng: number) => isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
const decode = (t: string) => { try { return decodeURIComponent(t); } catch { return t; } };

export function parseLatLng(text: string): LatLng | null {
  if (!text) return null;
  const t = decode(text.trim());
  const patterns: [RegExp, boolean][] = [
    [new RegExp(`!3d${NUM}!4d${NUM}`), false], // exact place pin
    [new RegExp(`[?&](?:q|query|ll|destination|daddr)=(?:loc:)?${NUM},\\s*\\+?${NUM}`), false],
    [new RegExp(`/(?:place|search|dir)/${NUM},\\s*\\+?${NUM}`), false],
    [new RegExp(`@${NUM},${NUM}`), true], // map centre
    [new RegExp(`[?&]center=${NUM},\\s*${NUM}`), true],
    [new RegExp(`^\\(?\\s*${NUM}\\s*[, ]\\s*${NUM}\\s*\\)?$`), false], // plain numbers
  ];
  for (const [p, approx] of patterns) {
    const m = t.match(p);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (ok(lat, lng)) return approx ? { lat, lng, approx } : { lat, lng };
    }
  }
  return null;
}

// The place name or address written in a Google Maps link, when the link carries no coordinates.
export function placeName(url: string): string {
  try {
    const u = new URL(url);
    const fromPath = u.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/)?.[1] || u.pathname.match(/\/maps\/dir\/[^/]*\/([^/@]+)/)?.[1] || '';
    const raw = fromPath || u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('destination') || u.searchParams.get('daddr') || '';
    const name = decode(raw.replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim();
    return /[a-zऀ-ॿ]/i.test(name) ? name.slice(0, 200) : '';
  } catch { return ''; }
}

export function isGoogleMapsHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co' || h === 'google.com' || h.endsWith('.google.com') || /^(www\.|maps\.)?google\.[a-z.]{2,6}$/.test(h);
  } catch { return false; }
}
