import { json, fail } from '@/lib/store';

export const dynamic = 'force-dynamic';
const UA = { 'User-Agent': 'solar-layout-planner/1.0 (local desktop app)', 'Accept-Language': 'en' };

// Place search and address lookup through OpenStreetMap Nominatim (free, light use only).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get('q'), lat = u.searchParams.get('lat'), lng = u.searchParams.get('lng');
  try {
    if (q) {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { headers: UA, signal: AbortSignal.timeout(15000) });
      const list = (await r.json()) as any[];
      return json({ results: list.map((x) => ({ label: x.display_name, lat: Number(x.lat), lng: Number(x.lon) })) });
    }
    if (lat && lng) {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${Number(lat)}&lon=${Number(lng)}`, { headers: UA, signal: AbortSignal.timeout(15000) });
      const x = (await r.json()) as any;
      return json({ address: x?.display_name || '' });
    }
    return fail('Nothing to search for.');
  } catch {
    return fail('Place search is not reachable right now. You can still paste a Google Maps link or type the address by hand.', 502);
  }
}
