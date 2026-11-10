// Server-side storage.
//  - On this computer: one JSON file in /data, no login.
//  - Hosted on Vercel: one workspace per signed-in user in the Postgres database.
import fs from 'fs';
import path from 'path';
import type { Db, Design, Project } from './types';
import { DEFAULT_SETTINGS } from './catalog';
import { HOSTED } from './session';
import { requireUserId } from './auth';
import { ensureSchema, getAppSetting, setAppSetting, sql } from './pg';

const DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DIR, 'db.json');
const empty = (): Db => ({ nextNumber: 1001, projects: [], settings: DEFAULT_SETTINGS });

function normalise(db: Db): Db {
  db.projects = db.projects || [];
  db.nextNumber = db.nextNumber || 1001;
  db.settings = {
    ...DEFAULT_SETTINGS, ...db.settings,
    company: { ...DEFAULT_SETTINGS.company, ...db.settings?.company },
    losses: { ...DEFAULT_SETTINGS.losses, ...db.settings?.losses },
  };
  for (const pr of db.projects) for (const d of pr.designs) { d.sheds = d.sheds || []; d.keepouts = d.keepouts || []; }
  return db;
}

export async function readDb(): Promise<Db> {
  if (HOSTED) {
    const userId = await requireUserId();
    await ensureSchema();
    const rows = (await sql()`select data from workspaces where user_id = ${userId}`) as any[];
    return rows.length ? normalise(rows[0].data as Db) : empty();
  }
  try {
    return normalise(JSON.parse(fs.readFileSync(FILE, 'utf8')) as Db);
  } catch {
    return empty();
  }
}

export async function writeDb(db: Db): Promise<void> {
  if (HOSTED) {
    const userId = await requireUserId();
    await ensureSchema();
    const data = JSON.stringify({ ...db, settings: { ...db.settings, googleMapsKey: '' } }); // the key is app-wide, never kept per company
    await sql()`insert into workspaces (user_id, data) values (${userId}, ${data}::jsonb)
      on conflict (user_id) do update set data = excluded.data, updated_at = now()`;
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

// Google Maps key for sharper imagery. Hosted: one key for the whole app, set by the admin. Local: in the settings file.
export async function getGoogleKey(): Promise<string> {
  if (HOSTED) { await requireUserId(); return getAppSetting('googleMapsKey'); }
  return (await readDb()).settings.googleMapsKey || '';
}
export async function setGoogleKey(value: string): Promise<void> {
  if (HOSTED) { await setAppSetting('googleMapsKey', value); return; }
  const db = await readDb();
  db.settings.googleMapsKey = value;
  await writeDb(db);
}

export function findDesign(db: Db, designId: string): { project: Project; design: Design; index: number } | null {
  for (const project of db.projects) {
    const index = project.designs.findIndex((d) => d.id === designId);
    if (index >= 0) return { project, design: project.designs[index], index };
  }
  return null;
}

export const json = (data: any, status = 200) => Response.json(data, { status });
export const fail = (message: string, status = 400) => Response.json({ error: message }, { status });
