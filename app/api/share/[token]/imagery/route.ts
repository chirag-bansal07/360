import { json, fail, getGoogleKeyOpen } from '@/lib/store';
import { shareSpot } from '@/lib/shares';
import { pickImagery } from '@/lib/imagery';
import { HOSTED } from '@/lib/session';
import { allow } from '@/lib/pg';
import { NEW_SITES_PER_DAY } from '@/lib/solar';

export const dynamic = 'force-dynamic';

// Imagery source for a shared link. The spot comes from the link, not from the request.
// The site is a real project of the link's owner, and its aerial picture is normally kept already. A paid fetch through
// a link counts against the owner's own daily limit (the same counter their screens use), so making many links buys nothing extra.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const spot = await shareSpot(token);
  if (!spot) return fail('Not available.', 404);
  const mayFetch = async () => (HOSTED ? allow(`solar:${spot.ownerId}`, NEW_SITES_PER_DAY, 86400) : true);
  return json({ ...(await pickImagery(spot.lat, spot.lng, await getGoogleKeyOpen(), mayFetch)), warning: '' });
}
