import { readDb, writeDb, findDesign, json, fail } from '@/lib/store';
import { removeViewLink } from '@/lib/shares';
import { pictureFor } from '@/lib/catalog';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = (await readDb());
  const hit = findDesign(db, id);
  if (!hit) return fail('Design not found.', 404);
  if (!hit.project.imagery) { hit.project.imagery = pictureFor(hit.project); await writeDb(db); } // decided once, so drawing the first shed does not change the picture
  const { designs, ...project } = hit.project;
  return json({ design: hit.design, project, settings: { ...db.settings, googleMapsKey: '' } });
}

// Saves the layout. Calculated results are kept; the screen shows them as out of date if the layout changed.
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await req.json();
  const db = (await readDb());
  const hit = findDesign(db, id);
  if (!hit) return fail('Design not found.', 404);
  const d = hit.design;
  if (typeof b.name === 'string' && b.name.trim()) d.name = b.name.trim();
  if (Array.isArray(b.sheds)) d.sheds = b.sheds;
  if (Array.isArray(b.keepouts)) d.keepouts = b.keepouts;
  if (Array.isArray(b.blocks)) d.blocks = b.blocks;
  if (Array.isArray(b.obstructions)) d.obstructions = b.obstructions;
  if (Array.isArray(b.walkways)) d.walkways = b.walkways;
  if (b.inverter) d.inverter = { name: String(b.inverter.name || ''), kw: Math.max(0, Number(b.inverter.kw) || 0), qty: Math.max(0, Math.round(Number(b.inverter.qty) || 0)) };
  if (typeof b.defaultModuleId === 'string') d.defaultModuleId = b.defaultModuleId;
  if (typeof b.structureName === 'string') d.structureName = b.structureName;
  if (['longrail', 'monorail', 'minirail', 'seam', 'reverse', 'reversep'].includes(b.defaultStructure)) d.defaultStructure = b.defaultStructure;
  if (typeof b.thumb === 'string') d.thumb = b.thumb;
  d.updatedAt = new Date().toISOString();
  await writeDb(db);
  return json({ ok: true, updatedAt: d.updatedAt });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = (await readDb());
  const hit = findDesign(db, id);
  if (!hit) return fail('Design not found.', 404);
  hit.project.designs.splice(hit.index, 1);
  await writeDb(db);
  await removeViewLink(id);
  return json({ ok: true, projectId: hit.project.id });
}
