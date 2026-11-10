import { readDb, writeDb, json, fail } from '@/lib/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const slim = (p: any) => ({ ...p, designs: p.designs.map((d: any) => ({ ...d, results: d.results ? { ...d.results, access: undefined } : null })) });

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = (await readDb());
  const project = db.projects.find((p) => p.id === id);
  if (!project) return fail('Project not found.', 404);
  return json({ project: slim(project), settings: { ...db.settings, googleMapsKey: '' } });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await req.json();
  const db = (await readDb());
  const project = db.projects.find((p) => p.id === id);
  if (!project) return fail('Project not found.', 404);
  for (const k of ['name', 'clientName', 'phone', 'email', 'address', 'displayAddress'] as const) {
    if (typeof b[k] === 'string') (project as any)[k] = b[k].trim();
  }
  if (b.type === 'residential' || b.type === 'commercial') project.type = b.type;
  if (!project.name || !project.clientName) return fail('Project name and client name cannot be empty.');
  await writeDb(db);
  return json({ project: slim(project) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = (await readDb());
  const before = db.projects.length;
  db.projects = db.projects.filter((p) => p.id !== id);
  if (db.projects.length === before) return fail('Project not found.', 404);
  await writeDb(db);
  return json({ ok: true });
}
