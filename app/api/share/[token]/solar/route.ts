import { shareSpot } from '@/lib/shares';
import { solarJpeg } from '@/lib/solar';

export const dynamic = 'force-dynamic';

// The kept Google Solar API picture for a shared link. The site comes from the link, not from the request.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const spot = await shareSpot((await ctx.params).token);
  const jpeg = spot ? await solarJpeg(spot.lat, spot.lng) : null;
  if (!jpeg) return new Response('not available', { status: 404 });
  return new Response(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
}
