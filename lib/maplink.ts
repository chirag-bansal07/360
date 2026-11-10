// Read latitude / longitude out of a Google Maps link or plain "lat, lng" text.
export type LatLng = { lat: number; lng: number };

const ok = (lat: number, lng: number) => isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

export function parseLatLng(text: string): LatLng | null {
  if (!text) return null;
  let t = text.trim();
  try { t = decodeURIComponent(t); } catch { /* keep as typed */ }
  const patterns = [
    new RegExp(`!3d${NUM}!4d${NUM}`), // exact place pin
    new RegExp(`[?&](?:q|query|ll|destination|center)=(?:loc:)?${NUM},\\s*${NUM}`),
    new RegExp(`/(?:place|search|dir)/${NUM},\\s*\\+?${NUM}`),
    new RegExp(`@${NUM},${NUM}`), // map centre
    new RegExp(`^\\(?\\s*${NUM}\\s*[, ]\\s*${NUM}\\s*\\)?$`), // plain numbers
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (ok(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

export function isGoogleMapsHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co' || h === 'google.com' || h.endsWith('.google.com') || /^(www\.|maps\.)?google\.[a-z.]{2,6}$/.test(h);
  } catch { return false; }
}
