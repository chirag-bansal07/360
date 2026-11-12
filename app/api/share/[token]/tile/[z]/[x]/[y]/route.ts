import { getGoogleKeyOpen } from '@/lib/store';
import { shareSpot } from '@/lib/shares';
import { tileResponse } from '@/lib/imagery';
import { tileXY } from '@/lib/mercator';

export const dynamic = 'force-dynamic';

// Satellite tiles for a shared link: only the tiles around that link's own site.
export async function GET(req: Request, ctx: { params: Promise<{ token: string; z: string; x: string; y: string }> }) {
  const p = await ctx.params;
  const z = parseInt(p.z), x = parseInt(p.x), y = parseInt(p.y);
  const spot = await shareSpot(p.token);
  if (!spot || !(z >= 15 && z <= 22)) return new Response('not available', { status: 404 });
  const c = tileXY(spot.lat, spot.lng, z);
  if (Math.abs(x - c.x) > 10 || Math.abs(y - c.y) > 10) return new Response('not available', { status: 404 });
  return tileResponse(z, x, y, new URL(req.url).searchParams.get('p') === 'google', getGoogleKeyOpen);
}
