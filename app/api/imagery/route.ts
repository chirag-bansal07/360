import { json, readDb } from '@/lib/store';
import { tileXY } from '@/lib/mercator';
import { googleSession, googleTileUrl } from '@/lib/google';

export const dynamic = 'force-dynamic';

// Picks the imagery source and the sharpest zoom level that really has pictures at this spot.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get('lat')), lng = Number(u.searchParams.get('lng'));
  const key = readDb().settings.googleMapsKey;
  let warning = '';
  if (key) {
    try {
      const session = await googleSession(key);
      for (let z = 20; z >= 17; z--) {
        const { x, y } = tileXY(lat, lng, z);
        const r = await fetch(googleTileUrl(key, session, z, Math.floor(x), Math.floor(y)), { signal: AbortSignal.timeout(10000) });
        if (r.ok) return json({ zoom: z, provider: 'google', credit: 'Imagery © Google' });
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
      if (j?.data?.[0] === 1) return json({ zoom: z, provider: 'esri', credit, warning });
    } catch {
      return json({ zoom: 18, provider: 'esri', credit, warning });
    }
  }
  return json({ zoom: 16, provider: 'esri', credit, warning });
}
