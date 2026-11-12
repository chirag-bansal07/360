import { json, fail } from '@/lib/store';
import { saveReport } from '@/lib/shares';

export const dynamic = 'force-dynamic';

// Saves the report of this design as it is now and returns its link id.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await saveReport((await ctx.params).id);
  return 'error' in r ? fail(r.error, r.status) : json(r);
}
