import { json, fail } from '@/lib/store';
import { openShare } from '@/lib/shares';

export const dynamic = 'force-dynamic';

// What a shared link shows. Open to anyone who has the link.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const s = await openShare((await ctx.params).token);
  if (!s) return fail('This link is not available. It may have been turned off, or the design was deleted.', 404);
  const { ownerId, ...shown } = s; // the owner's id is for the server only
  return json(shown);
}
