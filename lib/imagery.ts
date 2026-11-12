// Satellite pictures: which source and zoom to use at a spot, and the tiles themselves.
import fs from 'fs';
import path from 'path';
import { tileXY } from './mercator';
import { googleSession, googleTileUrl } from './google';
import { solarInfo, type SolarPic } from './solar';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Picks the imagery. With a Google key the site itself is shown from the Google Solar API aerial picture (the sharpest),
// laid over ordinary satellite tiles for the surroundings.
// solar = this login may use the aerial picture at all; without it only map tiles are used.
// mayFetch guards the paid first fetch of a site's aerial picture (see solarInfo).
export async function pickImagery(lat: number, lng: number, key: string, solar = false, mayFetch?: () => Promise<boolean>) {
  const base = await pickTiles(lat, lng, key);
  if (!solar) return { ...base, overlay: null, tilesCredit: base.credit };
  let overlay: SolarPic | null = null, warning = base.warning;
  try {
    overlay = await solarInfo(lat, lng, key, mayFetch);
  } catch (e: any) {
    if (!warning) warning = `Google Solar API imagery could not be used (${e?.message || 'no connection'}). Check that “Solar API” is enabled for the key in Google Cloud.`;
  }
  if (!overlay) return { ...base, warning, overlay: null, tilesCredit: base.credit };
  const [y, m] = overlay.date.split('-').map(Number);
  const credit = `Imagery © Google${y ? ` (Solar API, ${MONTHS[(m || 1) - 1]} ${y})` : ''}${base.provider === 'google' ? '' : ` · surroundings ${base.credit.replace('Imagery ', '')}`}`;
  return { ...base, credit, warning: base.provider === 'google' ? '' : warning, overlay, tilesCredit: base.credit };
}

// The tile source and the sharpest zoom level that really has pictures at this spot.
async function pickTiles(lat: number, lng: number, key: string) {
  let warning = '';
  if (key) {
    try {
      const session = await googleSession(key);
      for (let z = 20; z >= 17; z--) {
        const { x, y } = tileXY(lat, lng, z);
        const r = await fetch(googleTileUrl(key, session, z, Math.floor(x), Math.floor(y)), { signal: AbortSignal.timeout(10000) });
        if (r.ok) return { zoom: z, provider: 'google', credit: 'Imagery © Google', warning: '' };
      }
      warning = 'Google has no satellite tiles here, so standard imagery is shown.';
    } catch (e: any) {
      warning = `Google imagery could not be used (${e?.message || 'no connection'}). Check the key in Settings. Standard imagery is shown.`;
    }
  }
  const credit = 'Imagery © Esri, Maxar, Earthstar Geographics';
  for (let z = 21; z >= 16; z--) {
    const { x, y } = tileXY(lat, lng, z);
    try {
      const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tilemap/${z}/${Math.floor(y)}/${Math.floor(x)}/1/1`, { signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as any;
      if (j?.data?.[0] === 1) return { zoom: z, provider: 'esri', credit, warning };
    } catch {
      return { zoom: 18, provider: 'esri', credit, warning };
    }
  }
  return { zoom: 16, provider: 'esri', credit, warning };
}

// One satellite tile. Esri World Imagery is fetched once and kept in data/tiles.
// Google tiles come from Google Map Tiles with the saved key and are not stored.
export async function tileResponse(z: number, x: number, y: number, google: boolean, getKey: () => Promise<string>): Promise<Response> {
  if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0) || z > 22) return new Response('bad tile', { status: 400 });

  if (google) {
    const key = await getKey();
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
