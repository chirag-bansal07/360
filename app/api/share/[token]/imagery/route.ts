import { json, fail, getGoogleKeyOpen } from '@/lib/store';
import { shareSpot } from '@/lib/shares';
import { pickImagery } from '@/lib/imagery';
import { HOSTED } from '@/lib/session';
import { allow } from '@/lib/pg';

export const dynamic = 'force-dynamic';

// Imagery source for a shared link. The spot comes from the link, not from the request.
// The site is a real project of the link's owner. Its aerial picture is normally kept already; a visitor can cause at most a couple of paid fetches a day.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const spot = await shareSpot(token);
  if (!spot) return fail('Not available.', 404);
  const mayFetch = async () => (HOSTED ? allow(`solar:share:${token}`, 2, 86400) : true);
  return json({ ...(await pickImagery(spot.lat, spot.lng, await getGoogleKeyOpen(), mayFetch)), warning: '' });
}
