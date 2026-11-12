import { json, fail } from '@/lib/store';
import { findPlace, GEO_UA } from '@/lib/geosearch';

export const dynamic = 'force-dynamic';

// Place search and address lookup through OpenStreetMap Nominatim (free, light use only).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim(), lat = u.searchParams.get('lat'), lng = u.searchParams.get('lng');
  try {
    if (q) return json(await findPlace(q));
    if (lat && lng) {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${Number(lat)}&lon=${Number(lng)}`, { headers: GEO_UA, signal: AbortSignal.timeout(15000) });
      const x = (await r.json()) as any;
      return json({ address: x?.display_name || '' });
    }
    return fail('Nothing to search for.');
  } catch {
    return fail('Place search is not reachable right now. You can still paste a Google Maps link or type the address by hand.', 502);
  }
}
