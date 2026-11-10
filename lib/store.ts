// Server-side storage: one JSON file in /data.
import fs from 'fs';
import path from 'path';
import type { Db, Design, Project } from './types';
import { DEFAULT_SETTINGS } from './catalog';

const DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DIR, 'db.json');

export function readDb(): Db {
  try {
    const db = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Db;
    db.settings = {
      ...DEFAULT_SETTINGS, ...db.settings,
      company: { ...DEFAULT_SETTINGS.company, ...db.settings?.company },
      losses: { ...DEFAULT_SETTINGS.losses, ...db.settings?.losses },
    };
    for (const pr of db.projects) for (const d of pr.designs) { d.sheds = d.sheds || []; d.keepouts = d.keepouts || []; }
    return db;
  } catch {
    return { nextNumber: 1001, projects: [], settings: DEFAULT_SETTINGS };
  }
}

export function writeDb(db: Db) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
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
