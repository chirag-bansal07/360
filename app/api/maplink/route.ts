import { json, fail } from '@/lib/store';
import { parseLatLng, isGoogleMapsHost } from '@/lib/maplink';

export const dynamic = 'force-dynamic';

// Turns a pasted Google Maps link (long or short) or "lat, lng" text into coordinates.
export async function POST(req: Request) {
  const { text } = await req.json();
  const t = String(text || '').trim();
  if (!t) return fail('Paste a Google Maps link first.');
  const direct = parseLatLng(t);
  if (direct) return json(direct);
  if (!/^https?:\/\//i.test(t)) return fail('That does not look like a Google Maps link or coordinates. Example: 29.37816, 77.03216');
  if (!isGoogleMapsHost(t)) return fail('Only Google Maps links are supported here.');
  try {
    const res = await fetch(t, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' } });
    const fromUrl = parseLatLng(res.url);
    if (fromUrl) return json(fromUrl);
    const body = (await res.text()).slice(0, 400000);
    const m = body.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || body.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || body.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/);
    if (m) return json({ lat: parseFloat(m[1]), lng: parseFloat(m[2]) });
    return fail('Could not find a location in that link. Open it in Google Maps, right-click the roof, copy the coordinates and paste them here.');
  } catch {
    return fail('Could not open that link. Check the internet connection, or paste the coordinates instead.', 502);
  }
}
