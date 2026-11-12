import { json, fail } from '@/lib/store';
import { viewLink, removeViewLink } from '@/lib/shares';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// The 3D link of this design (made on first use).
export async function POST(_req: Request, ctx: Ctx) {
  const token = await viewLink((await ctx.params).id);
  return token ? json({ token }) : fail('Design not found.', 404);
}

// Turns the 3D link off. Sharing again makes a new, different link.
export async function DELETE(_req: Request, ctx: Ctx) {
  await removeViewLink((await ctx.params).id);
  return json({ ok: true });
}
