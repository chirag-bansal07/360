import fs from 'fs';
import path from 'path';
import { getGoogleKey } from '@/lib/store';
import { googleSession, googleTileUrl } from '@/lib/google';

export const dynamic = 'force-dynamic';

// Satellite tiles. Esri World Imagery is fetched once and kept in data/tiles.
// With ?p=google the tile comes from Google Map Tiles (the user's own key) and is not stored.
export async function GET(req: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) {
  const p = await ctx.params;
  const z = parseInt(p.z), x = parseInt(p.x), y = parseInt(p.y);
  if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0) || z > 22) return new Response('bad tile', { status: 400 });

  if (new URL(req.url).searchParams.get('p') === 'google') {
    const key = await getGoogleKey();
    if (!key) return new Response('no key', { status: 404 });
    try {
      const res = await fetch(googleTileUrl(key, await googleSession(key), z, x, y), { signal: AbortSignal.timeout(20000) });
      if (!res.ok) return new Response('tile not available', { status: 404 });
      return new Response(new Uint8Array(await res.arrayBuffer()), { headers: { 'Content-Type': res.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
    } catch {
      return new Response('imagery not reachable', { status: 502 });
    }
  }

  const file = path.join(process.cwd(), 'data', 'tiles', String(z), String(x), `${y}.jpg`);
  const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' };
  try {
    return new Response(new Uint8Array(fs.readFileSync(file)), { headers });
  } catch { /* not cached yet */ }
  try {
    const res = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return new Response('tile not available', { status: 404 });
    const buf = new Uint8Array(await res.arrayBuffer());
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); } catch { /* no writable disk: serve without keeping a copy */ }
    return new Response(buf, { headers });
  } catch {
    return new Response('imagery not reachable', { status: 502 });
  }
}
