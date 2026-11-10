import { readDb, writeDb, json, fail } from '@/lib/store';
import { newDesign, uid } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  const db = readDb();
  const project = db.projects.find((p) => p.id === id);
  if (!project) return fail('Project not found.', 404);
  const name = String(b.name || '').trim() || `Design ${project.designs.length + 1}`;
  let design = newDesign(name);
  if (b.copyFrom) {
    const src = project.designs.find((d) => d.id === b.copyFrom);
    if (!src) return fail('Design to copy was not found.', 404);
    const now = new Date().toISOString();
    design = { ...JSON.parse(JSON.stringify(src)), id: uid(), name: String(b.name || '').trim() || `${src.name} (copy)`, createdAt: now, updatedAt: now };
  }
  project.designs.push(design);
  writeDb(db);
  return json({ design });
}
