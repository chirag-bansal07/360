// Share links.
//  - 'view'   : a live link to one design's 3D model. It always shows the design as it is now.
//  - 'report' : a report saved at one moment. It keeps its own copy of the layout and numbers, so it never changes.
// Anyone who has the link can open it without signing in. The link is a random id that cannot be guessed.
// Hosted: the "shares" table. On this computer: data/shares.json.
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Db, Design, Project, Settings } from './types';
import { HOSTED } from './session';
import { requireUserId } from './auth';
import { ensureSchema, sql } from './pg';
import { readDb, readDbOf, findDesign } from './store';
import { allModules, pictureFor } from './catalog';
import { designTotals } from './geometry';

export type ReportMeta = { designName: string; kwp: number; modules: number; annualAc: number; stamp: string };
export type ReportItem = { token: string; designId: string; createdAt: string } & ReportMeta;
type Row = { token: string; userId: string; kind: 'view' | 'report'; projectId: string; designId: string; meta: ReportMeta | null; data: any; createdAt: string };
export type Shared = { kind: 'view' | 'report'; createdAt: string; design: Design; project: Omit<Project, 'designs'>; settings: Settings };

const FILE = path.join(process.cwd(), 'data', 'shares.json');
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function localRows(): Row[] {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Row[]; } catch { return []; }
}
function localSave(rows: Row[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows));
  fs.renameSync(tmp, FILE);
}
const fromPg = (r: any): Row => ({ token: r.token, userId: r.user_id, kind: r.kind, projectId: r.project_id, designId: r.design_id, meta: r.meta, data: r.data, createdAt: new Date(r.created_at).toISOString() });

async function insert(row: Row) {
  if (HOSTED) {
    await sql()`insert into shares (token, user_id, kind, project_id, design_id, meta, data)
      values (${row.token}, ${row.userId}, ${row.kind}, ${row.projectId}, ${row.designId}, ${row.meta ? JSON.stringify(row.meta) : null}::jsonb, ${row.data ? JSON.stringify(row.data) : null}::jsonb)`;
  } else localSave([...localRows(), row]);
  cache.delete(row.token);
}

// What a visitor receives: no client phone or email, no weather table, no keys.
function publicCopy(project: Project | Omit<Project, 'designs'>, design: Design, settings: Settings, withClient: boolean) {
  const { designs, weather, phone, email, ...p } = project as Project;
  if (!p.imagery && designs) p.imagery = pictureFor({ imagery: undefined, designs });
  return {
    design: { ...design, thumb: undefined } as Design,
    project: { ...p, clientName: withClient ? p.clientName : '', phone: '', email: '', weather: null } as Omit<Project, 'designs'>,
    settings: { company: settings.company, customModules: settings.customModules, losses: settings.losses, googleMapsKey: '' } as Settings,
  };
}

// The 3D link of a design. Made on first use, then always the same link until it is turned off.
export async function viewLink(designId: string): Promise<string | null> {
  const userId = await requireUserId();
  const hit = findDesign(await readDb(), designId);
  if (!hit) return null;
  if (HOSTED) {
    await ensureSchema();
    const rows = (await sql()`select token from shares where user_id = ${userId} and kind = 'view' and design_id = ${designId} limit 1`) as any[];
    if (rows.length) return rows[0].token;
  } else {
    const old = localRows().find((r) => r.kind === 'view' && r.designId === designId);
    if (old) return old.token;
  }
  const token = randomUUID();
  await insert({ token, userId, kind: 'view', projectId: hit.project.id, designId, meta: null, data: null, createdAt: new Date().toISOString() });
  return token;
}

export async function removeViewLink(designId: string): Promise<void> {
  const userId = await requireUserId();
  if (HOSTED) {
    await ensureSchema();
    const rows = (await sql()`delete from shares where user_id = ${userId} and kind = 'view' and design_id = ${designId} returning token`) as any[];
    for (const r of rows) cache.delete(r.token);
  } else {
    const rows = localRows();
    for (const r of rows) if (r.kind === 'view' && r.designId === designId) cache.delete(r.token);
    localSave(rows.filter((r) => !(r.kind === 'view' && r.designId === designId)));
  }
}

// Saves the report of a design as it is now. Saving again without any change gives back the same report.
export async function saveReport(designId: string): Promise<{ token: string } | { error: string; status: number }> {
  const userId = await requireUserId();
  const db = await readDb();
  const hit = findDesign(db, designId);
  if (!hit) return { error: 'Design not found.', status: 404 };
  const { design, project } = hit;
  if (!design.results) return { error: 'Calculate generation first. A report needs the yearly production figures.', status: 400 };
  const t = designTotals(design, allModules(db.settings));
  const meta: ReportMeta = { designName: design.name, kwp: t.kwp, modules: t.modules, annualAc: design.results.annualAc, stamp: `${design.updatedAt}|${design.results.calculatedAt}` };
  if (HOSTED) {
    await ensureSchema();
    const rows = (await sql()`select token from shares where user_id = ${userId} and kind = 'report' and design_id = ${designId} and meta->>'stamp' = ${meta.stamp} limit 1`) as any[];
    if (rows.length) return { token: rows[0].token };
  } else {
    const old = localRows().find((r) => r.kind === 'report' && r.designId === designId && r.meta?.stamp === meta.stamp);
    if (old) return { token: old.token };
  }
  const token = randomUUID();
  await insert({ token, userId, kind: 'report', projectId: project.id, designId, meta, data: publicCopy(project, design, db.settings, true), createdAt: new Date().toISOString() });
  return { token };
}

export async function listReports(projectId: string): Promise<ReportItem[]> {
  const userId = await requireUserId();
  let rows: Row[];
  if (HOSTED) {
    await ensureSchema();
    rows = ((await sql()`select token, user_id, kind, project_id, design_id, meta, null as data, created_at from shares
      where user_id = ${userId} and kind = 'report' and project_id = ${projectId} order by created_at desc`) as any[]).map(fromPg);
  } else {
    rows = localRows().filter((r) => r.kind === 'report' && r.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return rows.map((r) => ({ token: r.token, designId: r.designId, createdAt: r.createdAt, ...(r.meta as ReportMeta) }));
}

export async function removeReport(token: string): Promise<boolean> {
  const userId = await requireUserId();
  if (!TOKEN.test(token)) return false;
  cache.delete(token);
  if (HOSTED) {
    await ensureSchema();
    return ((await sql()`delete from shares where token = ${token} and user_id = ${userId} and kind = 'report' returning token`) as any[]).length > 0;
  }
  const rows = localRows(), left = rows.filter((r) => !(r.token === token && r.kind === 'report'));
  if (left.length !== rows.length) localSave(left);
  return left.length !== rows.length;
}

// A deleted project takes its links and saved reports with it.
export async function removeProjectShares(projectId: string): Promise<void> {
  const userId = await requireUserId();
  cache.clear();
  if (HOSTED) {
    await ensureSchema();
    await sql()`delete from shares where user_id = ${userId} and project_id = ${projectId}`;
  } else {
    const rows = localRows(), left = rows.filter((r) => r.projectId !== projectId);
    if (left.length !== rows.length) localSave(left);
  }
}

async function findRow(token: string): Promise<Row | null> {
  if (!TOKEN.test(token)) return null;
  if (HOSTED) {
    await ensureSchema();
    const rows = (await sql()`select token, user_id, kind, project_id, design_id, meta, data, created_at from shares where token = ${token}`) as any[];
    return rows.length ? fromPg(rows[0]) : null;
  }
  return localRows().find((r) => r.token === token) || null;
}

// Opens a link for a visitor. No sign-in: the link itself is the permission.
export async function openShare(token: string): Promise<Shared | null> {
  const row = await findRow(token);
  if (!row) return null;
  if (row.kind === 'report') return { kind: 'report', createdAt: row.createdAt, ...row.data };
  const db: Db = await readDbOf(row.userId);
  const hit = findDesign(db, row.designId);
  if (!hit) return null; // the design was deleted
  return { kind: 'view', createdAt: row.createdAt, ...publicCopy(hit.project, hit.design, db.settings, false) };
}

// Where a link's site is, for the map pictures. Remembered for a minute so a page of tiles is one lookup.
const cache = new Map<string, { at: number; spot: { lat: number; lng: number } | null }>();
export async function shareSpot(token: string): Promise<{ lat: number; lng: number } | null> {
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < 60000) return hit.spot;
  const s = await openShare(token);
  const spot = s && !s.project.noMap ? { lat: s.project.lat, lng: s.project.lng } : null;
  if (cache.size > 2000) cache.clear();
  cache.set(token, { at: Date.now(), spot });
  return spot;
}
