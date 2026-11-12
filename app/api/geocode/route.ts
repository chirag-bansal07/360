import { json, fail } from '@/lib/store';
import { findPlace, remembered, GEO_UA } from '@/lib/geosearch';
import { searchAllowed } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Place search and address lookup through OpenStreetMap Nominatim (free, light use only).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim(), lat = u.searchParams.get('lat'), lng = u.searchParams.get('lng');
  if (!(await searchAllowed())) return fail('Too many searches in a short time. Wait a few minutes and try again.', 429);
  try {
    if (q) return json(await findPlace(q));
    if (lat && lng) {
      const la = Number(lat).toFixed(5), ln = Number(lng).toFixed(5);
      return json(await remembered(`r:${la},${ln}`, async () => {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${Number(lat)}&lon=${Number(lng)}`, { headers: GEO_UA, signal: AbortSignal.timeout(15000) });
      const x = (await r.json()) as any;
      return { address: x?.display_name || '' };
      }));
    }
    return fail('Nothing to search for.');
  } catch {
    return fail('Place search is not reachable right now. You can still paste a Google Maps link or type the address by hand.', 502);
  }
}
