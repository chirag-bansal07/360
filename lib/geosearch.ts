// Place search through OpenStreetMap Nominatim (free, light use only).
export const GEO_UA = { 'User-Agent': 'solar-layout-planner/1.0 (local desktop app)', 'Accept-Language': 'en' };
export type Hit = { label: string; lat: number; lng: number };
export type Match = 'exact' | 'near' | 'abroad';

async function search(q: string, india: boolean): Promise<Hit[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6${india ? '&countrycodes=in' : ''}&q=${encodeURIComponent(q)}`, { headers: GEO_UA, signal: AbortSignal.timeout(15000) });
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

// Search order: the full text inside India, then shorter versions of it inside India, and only then the rest of the world.
// "match" tells the screen how far to trust the result: exact = the typed place in India, near = only the area or town
// was found, abroad = nothing in India carries this name.
export async function findPlace(q: string): Promise<{ results: Hit[]; match: Match }> {
  let results = await search(q, true), match: Match = 'exact';
  if (!results.length) {
    match = 'near';
    for (const s of shorter(q)) { results = await search(s, true); if (results.length) break; }
  }
  if (!results.length) { match = 'abroad'; results = await search(q, false); }
  return { results, match };
}
