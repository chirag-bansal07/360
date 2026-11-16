import { json, fail } from '@/lib/store';
import { guard } from '@/lib/auth';
import { removeReport } from '@/lib/shares';

export const dynamic = 'force-dynamic';

export const DELETE = guard(async function DELETE(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  return (await removeReport((await ctx.params).token)) ? json({ ok: true }) : fail('Report not found.', 404);
});
