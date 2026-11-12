import { getGoogleKey } from '@/lib/store';
import { tileResponse } from '@/lib/imagery';

export const dynamic = 'force-dynamic';

// Satellite tiles for signed-in screens. With ?p=google the tile comes from Google Map Tiles.
export async function GET(req: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) {
  const p = await ctx.params;
  return tileResponse(parseInt(p.z), parseInt(p.x), parseInt(p.y), new URL(req.url).searchParams.get('p') === 'google', getGoogleKey);
}
