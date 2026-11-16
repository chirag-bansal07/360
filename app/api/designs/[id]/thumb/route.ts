import { readDb, findDesign, pictureResponse } from '@/lib/store';
import { guard } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// The small top-view picture of a design, for lists. The address carries the time of the last save, so it is kept by the browser.
export const GET = guard(async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return pictureResponse(findDesign(await readDb(), id)?.design.thumb);
});
