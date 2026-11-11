import { json, fail } from '@/lib/store';

export const dynamic = 'force-dynamic';
const UA = { 'User-Agent': 'solar-layout-planner/1.0 (local desktop app)', 'Accept-Language': 'en' };
type Hit = { label: string; lat: number; lng: number };

async function search(q: string, india: boolean): Promise<Hit[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6${india ? '&countrycodes=in' : ''}&q=${encodeURIComponent(q)}`, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`search answered ${r.status}`);
  const list = (await r.json()) as any[];
  return list.map((x) => ({ label: x.display_name, lat: Number(x.lat), lng: Number(x.lon) })).filter((x) => isFinite(x.lat) && isFinite(x.lng));
}

// Shorter versions of the text, most specific first: a factory name or plot number is rarely on the map,
// but the area or town at the end of the address usually is.
function shorter(q: string): string[] {
  const parts = q.split(',').map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  if (parts.length > 1) for (let i = 1; i < parts.length; i++) out.push(parts.slice(i).join(', '));
  else {
    const w = q.split(/\s+/).filter(Boolean);
    for (const n of [3, 2, 1]) if (n < w.length) out.push(w.slice(-n).join(' '));
  }
  return [...new Set(out)].slice(0, 4);
}

// Place search and address lookup through OpenStreetMap Nominatim (free, light use only).
// Search order: the full text inside India, then shorter versions of it inside India, and only then the rest of the world.
// "match" tells the screen how far to trust the result: exact = the typed place in India, near = only the area or town
// was found, abroad = nothing in India carries this name.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim(), lat = u.searchParams.get('lat'), lng = u.searchParams.get('lng');
  try {
    if (q) {
      let results = await search(q, true), match: 'exact' | 'near' | 'abroad' = 'exact';
      if (!results.length) {
        match = 'near';
        for (const s of shorter(q)) { results = await search(s, true); if (results.length) break; }
      }
      if (!results.length) { match = 'abroad'; results = await search(q, false); }
      return json({ results, match });
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
