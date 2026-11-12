import { json, fail, getGoogleKeyOpen } from '@/lib/store';
import { shareSpot } from '@/lib/shares';
import { pickImagery } from '@/lib/imagery';
import { HOSTED } from '@/lib/session';
import { allow } from '@/lib/pg';
import { solarAllowed } from '@/lib/auth';
import { NEW_SITES_PER_DAY } from '@/lib/solar';

export const dynamic = 'force-dynamic';

// Imagery source for a shared link. The spot comes from the link, not from the request.
// The site is a real project of the link's owner, and its aerial picture is normally kept already. A paid fetch through
// a link counts against the owner's own daily limit (the same counter their screens use), so making many links buys nothing extra.
// Visitors of all of one owner's links together get a small share of that limit, so they cannot use up the owner's day.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const spot = await shareSpot(token);
  if (!spot) return fail('Not available.', 404);
  const mayFetch = async () => !HOSTED || ((await allow(`solar:share:${spot.ownerId}`, 5, 86400)) && (await allow(`solar:${spot.ownerId}`, NEW_SITES_PER_DAY, 86400)));
  return json({ ...(await pickImagery(spot.lat, spot.lng, await getGoogleKeyOpen(), await solarAllowed(spot.ownerId), mayFetch)), warning: '' });
}
