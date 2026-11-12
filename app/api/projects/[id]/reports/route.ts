import { json } from '@/lib/store';
import { listReports } from '@/lib/shares';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return json({ reports: await listReports((await ctx.params).id) });
}
