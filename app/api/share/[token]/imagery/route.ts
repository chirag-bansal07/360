import { json, fail, getGoogleKeyOpen } from '@/lib/store';
import { shareSpot } from '@/lib/shares';
import { pickImagery } from '@/lib/imagery';

export const dynamic = 'force-dynamic';

// Imagery source for a shared link. The spot comes from the link, not from the request.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const spot = await shareSpot((await ctx.params).token);
  if (!spot) return fail('Not available.', 404);
  return json({ ...(await pickImagery(spot.lat, spot.lng, await getGoogleKeyOpen())), warning: '' });
}
