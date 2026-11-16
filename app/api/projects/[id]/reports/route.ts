import { json } from '@/lib/store';
import { guard } from '@/lib/auth';
import { listReports } from '@/lib/shares';

export const dynamic = 'force-dynamic';

export const GET = guard(async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return json({ reports: await listReports((await ctx.params).id) });
});
